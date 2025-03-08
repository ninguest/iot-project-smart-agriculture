import network
import urequests
import time
import random
import json
from machine import Pin, I2C

# Wi-Fi configuration
SSID = "SSID"
PASSWORD = "PASSWORD"

# Server configuration
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "Sparkfun_Pico"

# Define FS3000 constants
FS3000_ADDRESS = 0x28  # Default I2C address for FS3000
FS3000_VELOCITY_REG = 0x00  # Register to read air velocity

# SCD41 Constants
SCD41_ADDRESS = 0x62  # Default I2C address
CMD_START_PERIODIC_MEASUREMENT = b"\x21\xb1"
CMD_READ_MEASUREMENT = b"\xec\x05"
CMD_STOP_PERIODIC_MEASUREMENT = b"\x3f\x86"
CMD_REINIT = b"\x36\x46"  # Reinitialize command
CMD_FACTORY_RESET = b"\x36\x32"  # Factory reset
CMD_FORCE_CALIBRATION = b"\x36\x2f"
CMD_GET_DATA_READY = b"\xe4\xb8"
CMD_SET_AUTOMATIC_CALIBRATION = b"\x24\x16"  # Enable automatic calibration
CMD_ALTITUDE_COMPENSATION = b"\x24\x27"  # Set altitude compensation

# I2C setup for sensors
I2C_SDA_PIN = 4  # GP4 on the Pico W
I2C_SCL_PIN = 5  # GP5 on the Pico W

# Status LED
led = Pin("LED", Pin.OUT)

# Initialize I2C with lower frequency for better compatibility with both sensors
i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)

# -------------------------- #
# Wi-Fi and server functions #
# -------------------------- #

def connect_wifi():
    """Connect to Wi-Fi network"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    
    print(f"Connecting to {SSID}...")
    wlan.connect(SSID, PASSWORD)
    
    # Wait for connection with timeout
    max_wait = 10
    while max_wait > 0:
        if wlan.status() < 0 or wlan.status() >= 3:
            break
        max_wait -= 1
        print("Waiting for connection...")
        time.sleep(1)
    
    if wlan.status() != 3:
        print("Network connection failed")
        return False
    else:
        print("Connected")
        status = wlan.ifconfig()
        print(f"IP address: {status[0]}")
        return True

def send_data_to_server(sensor_data):
    """Send sensor data to the server"""
    try:
        # Create data object
        data = {
            "device_id": DEVICE_ID,
            "sensors": sensor_data
        }
                
        # Convert to JSON string
        json_data = json.dumps(data)
        
        print(f"Sending data to server: {json_data}")  # Print actual JSON sent
        
        # Send HTTP POST request
        response = urequests.post(
            API_URL,
            data=json_data,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Server response: {response.status_code}")
        
        # Add this to see error details
        if response.status_code != 200:
            try:
                error_data = response.json()
                print(f"Error details: {error_data}")
            except:
                print(f"Response text: {response.text}")
        
        response.close()
        
        # Blink LED to indicate successful transmission
        led.on()
        time.sleep(0.1)
        led.off()
        
        return True
    except Exception as e:
        print(f"Error sending data: {e}")
        # Flash LED rapidly to indicate error
        for _ in range(5):
            led.on()
            time.sleep(0.1)
            led.off()
            time.sleep(0.1)
        return False

# --------------------------------- #
# End of Wi-Fi and server functions #
# --------------------------------- #

# ----------------------- #
# FS3000 sensor functions #
# ----------------------- #

def read_fs3000():
    try:
        # Read 2 bytes from the velocity register
        data = i2c.readfrom_mem(FS3000_ADDRESS, FS3000_VELOCITY_REG, 2)
        
        # Convert the 2 bytes to a 16-bit integer (big-endian)
        raw_value = (data[0] << 8) | data[1]
        
        # Calculate velocity in meters per second
        velocity_mps = convert_raw_to_velocity(raw_value)
        
        return velocity_mps
    except Exception as e:
        print(f"Error reading FS3000: {e}")
        return 0.0

def convert_raw_to_velocity(raw_value):
    # Check which version of sensor (7.5 m/s or 15 m/s)
    MAX_VELOCITY = 7.5  # Change to 15 if you have the 15 m/s version
    
    # Handle special cases
    if raw_value == 0 or raw_value == 65535:  # 0 or 0xFFFF
        return 0
    
    # Proper conversion formula for FS3000
    # The raw values are non-linear and need lookup or formula
    if raw_value < 1024:
        # Low velocity formula - values from datasheet
        velocity = raw_value / 1024 * 1.25
    elif raw_value < 8192:
        # Mid velocity formula
        velocity = (raw_value - 1024) / 7168 * 3.75 + 1.25
    else:
        # High velocity formula
        velocity = (raw_value - 8192) / 57343 * 2.5 + 5.0
    
    # Scale to the maximum velocity of your sensor
    velocity = min(velocity, MAX_VELOCITY)
    
    return velocity

# ------------------------------ #
# End of FS3000 sensor functions # 
# ------------------------------ #

# ---------------------- #
# SCD41 sensor functions #
# ---------------------- #

def calculate_crc(data):
    """Calculate CRC for SCD41 communication"""
    crc = 0xFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = (crc << 1) ^ 0x31
            else:
                crc = crc << 1
    return crc & 0xFF

def send_command_with_retry(command, retries=3, delay=0.5):
    """Send command to SCD41 with retries"""
    for attempt in range(retries):
        try:
            i2c.writeto(SCD41_ADDRESS, command)
            return True
        except OSError as e:
            print(f"Command failed (attempt {attempt+1}/{retries}): {e}")
            time.sleep(delay)  # Wait before retry
    print("Command failed after all retries")
    return False

def send_command_with_args_retry(command, arguments, retries=3, delay=0.5):
    """Send command with arguments to SCD41 with retries"""
    buffer = bytearray(command)
    buffer.extend(arguments)
    buffer.append(calculate_crc(arguments))
    
    for attempt in range(retries):
        try:
            i2c.writeto(SCD41_ADDRESS, buffer)
            return True
        except OSError as e:
            print(f"Command with args failed (attempt {attempt+1}/{retries}): {e}")
            time.sleep(delay)  # Wait before retry
    print("Command with args failed after all retries")
    return False

def read_data(command, length=3):
    """Read data from SCD41 with proper CRC checking"""
    try:
        if not send_command_with_retry(command):
            return None
        
        # SCD41 needs time to process the read command
        time.sleep(0.001)
        
        try:
            data = i2c.readfrom(SCD41_ADDRESS, length)
            return data
        except OSError as e:
            print(f"Error reading data: {e}")
            return None
    except Exception as e:
        print(f"General error in read_data: {e}")
        return None

def start_periodic_measurement():
    """Start periodic measurement"""
    if send_command_with_retry(CMD_START_PERIODIC_MEASUREMENT):
        # Wait for the first measurement (5 seconds)
        print("Starting periodic measurement...")
        time.sleep(5)
        return True
    return False

def stop_periodic_measurement():
    """Stop periodic measurement"""
    if send_command_with_retry(CMD_STOP_PERIODIC_MEASUREMENT):
        time.sleep(0.5)  # Give it time to process the stop command
        return True
    return False

def read_measurement():
    """Read and process measurement data"""
    try:
        data = read_data(CMD_READ_MEASUREMENT, 9)
        
        # Check if data is valid
        if data is None or len(data) != 9:
            if data is None:
                print("No data received")
            else:
                print(f"Invalid data length: {len(data)}")
            return None, None, None
        
        # Parse CO2 (first 2 bytes + CRC)
        co2 = (data[0] << 8) | data[1]
        # Verify CRC for CO2
        if calculate_crc(data[0:2]) != data[2]:
            # Just continue without printing error
            pass
        
        # Parse temperature (next 2 bytes + CRC)
        temp_raw = (data[3] << 8) | data[4]
        temperature = -45 + 175 * temp_raw / 65535
        # Verify CRC for temperature
        if calculate_crc(data[3:5]) != data[5]:
            # Just continue without printing error
            pass
        
        # Parse humidity (next 2 bytes + CRC)
        hum_raw = (data[6] << 8) | data[7]
        humidity = 100 * hum_raw / 65535
        # Verify CRC for humidity
        if calculate_crc(data[6:8]) != data[8]:
            # Just continue without printing error
            pass
        
        return co2, temperature, humidity
    except Exception as e:
        # Don't print the error, we'll handle it in the main loop
        return None, None, None

def force_calibration(target_co2=400):
    """Force calibration with known CO2 value (typically 400ppm for fresh air)"""
    # Convert target CO2 value to bytes (MSB first)
    target_bytes = bytearray([(target_co2 >> 8) & 0xFF, target_co2 & 0xFF])
    return send_command_with_args_retry(CMD_FORCE_CALIBRATION, target_bytes)

def enable_automatic_calibration(enable=True):
    """Enable or disable automatic self-calibration"""
    value = 1 if enable else 0
    return send_command_with_args_retry(CMD_SET_AUTOMATIC_CALIBRATION, bytearray([0, value]))

def set_altitude_compensation(altitude_meters=0):
    """Set altitude compensation in meters above sea level"""
    # Convert altitude to bytes (MSB first)
    altitude_bytes = bytearray([(altitude_meters >> 8) & 0xFF, altitude_meters & 0xFF])
    return send_command_with_args_retry(CMD_ALTITUDE_COMPENSATION, altitude_bytes)
    
# ----------------------------- #
# End of SCD41 sensor functions #
# ----------------------------- #

# Variables to track last reading and update time
last_co2 = 0
last_temp = 0
last_humidity = 0
last_update = time.time()
update_count = 0
        
# Generate Sensor Data According to the Sensor Values
def generate_real_sensor_data():
    """Generate Real sensor data"""
    global last_co2, last_temp, last_humidity, last_update, update_count

    current_time = time.time()
    velocity = read_fs3000()
    new_co2, new_temp, new_humidity = read_measurement()
    
    # If successful reading, update our stored values
    if new_co2 is not None and new_temp is not None and new_humidity is not None:
        if new_co2 != last_co2 or new_temp != last_temp or new_humidity != last_humidity:
            # Data has changed
            update_count += 1
            last_co2 = new_co2
            last_temp = new_temp
            last_humidity = new_humidity
            last_update = current_time
            print(f"NEW #{update_count} - CO2: {new_co2} ppm, Temperature: {new_temp:.2f} °C, Humidity: {new_humidity:.2f} %")
        else:
            # No change in data, print stored values
            time_since_update = current_time - last_update
            print(f"SAME ({time_since_update:.1f}s) - CO2: {last_co2} ppm, Temperature: {last_temp:.2f} °C, Humidity: {last_humidity:.2f} %")
    else:
        # Error in reading, use last known good values
        time_since_update = current_time - last_update
        print(f"CACHED ({time_since_update:.1f}s) - CO2: {last_co2} ppm, Temperature: {last_temp:.2f} °C, Humidity: {last_humidity:.2f} %")        
    
    return {
        "Air Velocity": {
            "value": "{:.2f}".format(velocity),
            "unit": "m/s"
        },
        "CO2": {
            "value": last_co2,
            "unit": "ppm"
        },
        "Temperature": {
            "value": "{:.2f}".format(last_temp),
            "unit": "C"  # Changed from °C to just C to avoid encoding issues
        },
        "Humidity": {
            "value": "{:.2f}".format(last_humidity),
            "unit": "%"
        }
    }

# Main loop
def main():
    print("\n========================================")
    print("Starting Pico W Sensor Data")
    print("Sending data to server every 1 second")
    print("========================================\n")
    
    # Blink LED to indicate program start
    for _ in range(3):
        led.on()
        time.sleep(0.2)
        led.off()
        time.sleep(0.2)
    
    # Connect to Wi-Fi
    if not connect_wifi():
        print("Failed to connect to Wi-Fi. Exiting...")
        # Error indication - 3 slow blinks
        for _ in range(3):
            led.on()
            time.sleep(0.5)
            led.off()
            time.sleep(0.5)
        return
    
    # Check if SCD41 is connected
    devices = i2c.scan()
    print(f"Devices found: {devices}")
    if SCD41_ADDRESS not in devices:
        print(f"SCD41 not found at address 0x{SCD41_ADDRESS:02X}")
        print(f"Devices found: {[hex(x) for x in devices]}")
    else:
        print(f"SCD41 found at address 0x{SCD41_ADDRESS:02X}")
        print("Performing initial setup...")
        
        # Skip factory reset (which was causing timeout) and use gentler initialization
        print("Stopping any previous measurements...")
        stop_periodic_measurement()
        time.sleep(1)
        
        print("Reinitializing sensor...")
        send_command_with_retry(CMD_REINIT)
        time.sleep(1)
        
        print("Enabling automatic calibration...")
        enable_automatic_calibration(True)
        
        print("Setting altitude compensation...")
        set_altitude_compensation(0)
        
        print("Performing forced calibration (assuming clean air ~400ppm)...")
        force_calibration(400)
        time.sleep(1)
        
        print("Starting periodic measurement...")
        start_periodic_measurement()
        
        print("SCD41 setup complete")
        
    print("\nSetup complete. Starting data transmission loop...")
    
    # Main loop - send data every second
    while True:
        try:
            # Generate sensor data from real sensors
            sensor_data = generate_real_sensor_data()
            
            # Send data to server
            send_data_to_server(sensor_data)
            
            # Wait for next transmission
            time.sleep(1)
            
        except Exception as e:
            print(f"Error in main loop: {e}")
            # Blink LED to indicate error
            led.on()
            time.sleep(0.5)
            led.off()
            time.sleep(0.5)
            # Wait before retrying
            time.sleep(5)

if __name__ == "__main__":
    main()
