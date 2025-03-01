import network
import urequests
import time
import struct
from machine import Pin, I2C, reset

# Wi-Fi configuration
SSID = "Nin"
PASSWORD = "Lexin_114"
API_URL = "http://192.168.228.147:3000/sensors"  # Updated endpoint for all sensor data
DEVICE_ID = "pico_with_naughty_sensor"

# I2C setup for sensors
I2C_SDA_PIN = 4  # GP4 on the Pico W
I2C_SCL_PIN = 5  # GP5 on the Pico W
FS3000_I2C_ADDR = 0x28  # Default I2C address for FS3000
SCD41_I2C_ADDR = 0x62   # Default I2C address for SCD41

# Status LED
led = Pin("LED", Pin.OUT)

# Initialize I2C with lower frequency for better compatibility with both sensors
i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)

# Debug mode - set to True for more verbose output
DEBUG = True

# Initialize global variables for tracking sensor readings
previous_data = None
same_data_count = 0

# SCD41 Commands
SCD41_CMD_START_PERIODIC_MEASUREMENT = 0x21B1
SCD41_CMD_READ_MEASUREMENT = 0xEC05
SCD41_CMD_STOP_PERIODIC_MEASUREMENT = 0x3F86
SCD41_CMD_GET_DATA_READY_STATUS = 0xE4B8
SCD41_CMD_FORCE_CALIBRATION = 0x362F  # Force calibration with known CO2 reference
SCD41_CMD_SET_AUTOMATIC_CALIBRATION = 0x2416  # Enable/disable automatic self-calibration
SCD41_CMD_REINIT = 0x3646  # Reinitialize the sensor
SCD41_CMD_FACTORY_RESET = 0x3632  # Reset to factory settings

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

def reset_i2c_bus():
    """Attempt to reset the I2C bus if communication issues occur"""
    global i2c
    try:
        # Close existing I2C
        i2c = None
        time.sleep(0.5)
        
        # Re-initialize I2C
        i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)
        print("I2C bus reset successfully")
        return True
    except Exception as e:
        print(f"Error resetting I2C bus: {e}")
        return False

def read_fs3000():
    """Read from FS3000 sensor with improved error handling"""
    try:
        # Check if sensor is present
        devices = i2c.scan()
        if FS3000_I2C_ADDR not in devices:
            print(f"FS3000 sensor not found on I2C bus. Devices found: {[hex(d) for d in devices]}")
            return None
        
        # Try to reset the I2C communication by sending an empty message
        try:
            i2c.writeto(FS3000_I2C_ADDR, bytes([]))
            time.sleep(0.1)
        except:
            pass
        
        # Write 0x00 to select the DATA register and try multiple times if needed
        retry_count = 0
        success = False
        
        while not success and retry_count < 3:
            try:
                # Send register selection command
                i2c.writeto(FS3000_I2C_ADDR, bytes([0x00]))
                time.sleep(0.1)  # Longer delay for stability
                success = True
            except Exception as e:
                print(f"Retry {retry_count+1}: Error selecting register: {e}")
                retry_count += 1
                time.sleep(0.2)
        
        if not success:
            print("Failed to communicate with FS3000 sensor after retries")
            return None
        
        # Read 2 bytes for the velocity data
        data = i2c.readfrom(FS3000_I2C_ADDR, 2)
        
        if DEBUG:
            print(f"FS3000 raw data bytes: {[hex(b) for b in data]}")
        
        # Use reversed byte order, which seems more reasonable based on the log
        raw_count = (data[1] << 8) | data[0]
        
        if DEBUG:
            print(f"FS3000 raw count (reversed byte order): {raw_count}")
        
        # Enhanced data validation - check if reading is same as previous
        global previous_data, same_data_count
        if previous_data is not None and previous_data == data:
            same_data_count += 1
            if same_data_count >= 10:
                print("WARNING: FS3000 sensor returning identical raw data for 10 consecutive readings!")
                print("Attempting I2C bus reset...")
                reset_i2c_bus()
                same_data_count = 0
        else:
            previous_data = data
            same_data_count = 0
        
        # Convert to velocity using adjusted formula for reversed byte order
        velocity = convert_fs3000_raw_to_velocity(raw_count)
        
        return velocity
        
    except Exception as e:
        print(f"Error reading from FS3000 sensor: {e}")
        return None

def convert_fs3000_raw_to_velocity(raw_count):
    """Convert raw sensor count to velocity in m/s using calibration for REVERSED byte order"""
    # For FS3000 with reversed byte order, the calibration values are different
    
    # If no airflow or very low reading
    if raw_count < 10:
        return 0.0
    
    # Cap unrealistic values
    if raw_count > 1000:  # Adjusted for reversed byte order
        print(f"Warning: High raw count: {raw_count}, might be invalid")
        raw_count = min(raw_count, 1000)  # More conservative cap
    
    # Adjusted calibration curve for reversed byte order
    # These values may need further fine-tuning based on your specific sensor
    if raw_count < 100:
        velocity = raw_count * 0.05  # Linear scale for low values
    elif raw_count < 300:
        velocity = 5.0 + (raw_count - 100) * 0.025  # Mid range
    else:
        velocity = 10.0 + (raw_count - 300) * 0.02  # High range
    
    # Reasonableness check - cap at 15 m/s which is the max for this sensor
    if velocity > 15:
        print(f"Warning: Calculated velocity ({velocity:.2f} m/s) exceeds sensor maximum, capping at 15 m/s")
        velocity = 15.0
    
    if DEBUG:
        print(f"FS3000 raw count: {raw_count} -> Velocity: {velocity:.2f} m/s")
    
    return velocity

def scd41_send_command(cmd):
    """Send command to SCD41 sensor"""
    try:
        # Commands are sent as 2 bytes
        high_byte = (cmd >> 8) & 0xFF
        low_byte = cmd & 0xFF
        i2c.writeto(SCD41_I2C_ADDR, bytes([high_byte, low_byte]))
        return True
    except Exception as e:
        print(f"Error sending command to SCD41: {e}")
        return False

def scd41_read_data(length):
    """Read data from SCD41 sensor"""
    try:
        return i2c.readfrom(SCD41_I2C_ADDR, length)
    except Exception as e:
        print(f"Error reading data from SCD41: {e}")
        return None

def scd41_initialize():
    """Initialize the SCD41 sensor with improved sequence"""
    try:
        # Check if SCD41 is on I2C bus
        devices = i2c.scan()
        if SCD41_I2C_ADDR not in devices:
            print("SCD41 sensor not found on I2C bus")
            return False
        
        print("SCD41 found, initializing...")
        
        # Stop any existing measurements
        scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
        time.sleep(0.5)
        
        # Optional: Factory reset the sensor if it's behaving strangely
        # Uncomment this section if you want to try a factory reset
        """
        print("Performing factory reset on SCD41...")
        scd41_send_command(SCD41_CMD_FACTORY_RESET)
        time.sleep(1.2)  # Wait for factory reset to complete (>1.2 sec)
        """
        
        # Enable automatic self-calibration (ASC)
        # 1 for enable, 0 for disable
        enable_asc = bytes([0x00, 0x01])  # Enable ASC
        i2c.writeto(SCD41_I2C_ADDR, bytes([SCD41_CMD_SET_AUTOMATIC_CALIBRATION >> 8, 
                                          SCD41_CMD_SET_AUTOMATIC_CALIBRATION & 0xFF]) + enable_asc)
        time.sleep(0.1)
        
        # Start periodic measurements
        scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
        print("SCD41 initialized and started measurements")
        
        # Wait longer for first measurement (SCD41 needs time to warm up)
        print("Waiting for SCD41 warm-up (10 seconds)...")
        time.sleep(10)
        
        return True
    except Exception as e:
        print(f"Error initializing SCD41: {e}")
        return False

def scd41_is_data_ready():
    """Check if SCD41 has new data ready with improved debugging"""
    try:
        scd41_send_command(SCD41_CMD_GET_DATA_READY_STATUS)
        time.sleep(0.01)
        data = scd41_read_data(3)
        
        if data is None or len(data) < 3:
            print("Failed to read data ready status")
            return False
        
        # The data ready status is in the LSB of the first byte
        status = (data[0] << 8) | data[1]
        is_ready = (status & 0x07FF) > 0
        
        if DEBUG:
            print(f"SCD41 data ready status: {is_ready} (raw: {hex(status)})")
        
        return is_ready
    except Exception as e:
        print(f"Error checking SCD41 data ready status: {e}")
        return False

def factory_reset_scd41():
    """Perform a factory reset on the SCD41 sensor"""
    print("\n====== PERFORMING SCD41 FACTORY RESET ======")
    try:
        # First stop any measurements
        print("Stopping measurements...")
        scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
        time.sleep(0.5)
        
        # Send factory reset command
        print("Sending factory reset command...")
        scd41_send_command(SCD41_CMD_FACTORY_RESET)
        
        # Factory reset needs at least 1.2 seconds to complete
        print("Waiting for reset to complete (2 seconds)...")
        time.sleep(2)
        
        print("Factory reset completed")
        
        # Wait a bit longer before restarting
        time.sleep(1)
        
        # Restart measurements
        print("Restarting periodic measurements...")
        scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
        
        # Wait for sensor to stabilize
        print("Waiting for sensor to stabilize (20 seconds)...")
        for i in range(20):
            led.on() if i % 2 == 0 else led.off()  # Blink LED during wait
            time.sleep(1)
        led.off()
        
        print("Factory reset and initialization completed")
        print("====== FACTORY RESET COMPLETE ======\n")
        return True
    except Exception as e:
        print(f"Error during factory reset: {e}")
        print("====== FACTORY RESET FAILED ======\n")
        return False

def try_different_i2c_frequency():
    """Try a different I2C frequency to see if it helps communication"""
    global i2c
    
    print("\n====== TRYING DIFFERENT I2C FREQUENCY ======")
    try:
        # Current frequency is 10kHz, let's try even lower: 5kHz
        print("Current I2C frequency: 10kHz")
        print("Trying lower frequency: 5kHz...")
        
        # Close existing I2C
        i2c = None
        time.sleep(0.5)
        
        # Re-initialize I2C with lower frequency
        i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=5000)  # 5kHz
        
        # Scan for devices
        devices = i2c.scan()
        if SCD41_I2C_ADDR in devices:
            print(f"SCD41 found at new frequency. All devices: {[hex(d) for d in devices]}")
            
            # Try stopping and starting measurements
            scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
            time.sleep(0.5)
            scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
            
            print("Waiting for 10 seconds to stabilize...")
            time.sleep(10)
            
            # Try reading
            print("Testing reading...")
            if scd41_is_data_ready():
                scd41_send_command(SCD41_CMD_READ_MEASUREMENT)
                time.sleep(0.01)
                data = scd41_read_data(9)
                
                if data is not None and len(data) >= 9:
                    co2 = (data[0] << 8) | data[1]
                    temp_raw = (data[3] << 8) | data[4]
                    temperature = -45 + (175 * temp_raw / 65535)
                    humidity_raw = (data[6] << 8) | data[7]
                    humidity = 100 * humidity_raw / 65535
                    
                    print(f"Test reading at 5kHz: CO2: {co2} ppm, Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%")
                    print("Frequency change " + ("SUCCESSFUL" if co2 > 0 else "UNSUCCESSFUL"))
                    
                    return co2 > 0
                else:
                    print("Could not read complete data")
            else:
                print("Data not ready")
        else:
            print(f"SCD41 not found at new frequency. Devices found: {[hex(d) for d in devices]}")
            # Revert to original frequency
            i2c = None
            time.sleep(0.5)
            i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)
            return False
            
        print("====== I2C FREQUENCY TEST COMPLETE ======\n")
        return False
    except Exception as e:
        print(f"Error adjusting I2C frequency: {e}")
        # Revert to original frequency
        try:
            i2c = None
            time.sleep(0.5)
            i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)
        except:
            pass
        print("====== I2C FREQUENCY TEST FAILED ======\n")
        return False

def perform_manual_calibration(reference_co2=400):
    """Perform manual calibration with known CO2 reference value (typically 400ppm for outdoor air)"""
    try:
        print(f"Starting manual calibration with reference value of {reference_co2} ppm")
        
        # Stop periodic measurement first
        scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
        time.sleep(0.5)
        
        # Prepare the calibration value (reference CO2 value)
        # Need to convert to big-endian 2-byte format
        msb = (reference_co2 >> 8) & 0xFF
        lsb = reference_co2 & 0xFF
        
        # Send the force calibration command with the reference value
        high_byte = (SCD41_CMD_FORCE_CALIBRATION >> 8) & 0xFF
        low_byte = SCD41_CMD_FORCE_CALIBRATION & 0xFF
        i2c.writeto(SCD41_I2C_ADDR, bytes([high_byte, low_byte, msb, lsb]))
        
        # Wait for calibration to complete
        time.sleep(0.5)
        
        # Restart periodic measurement
        scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
        time.sleep(0.1)
        
        print("Manual calibration completed")
        return True
    except Exception as e:
        print(f"Error performing manual calibration: {e}")
        return False
    
def validate_scd41_readings(data):
    """Validate SCD41 readings to detect potential issues"""
    if data is None:
        return False
    
    # Check CO2 readings
    if "co2" in data:
        co2 = data["co2"]
        if co2 == 0:
            print("WARNING: CO2 reading is 0 ppm - this is physically impossible")
            return False
        if co2 < 350:
            print(f"WARNING: CO2 reading ({co2} ppm) is abnormally low")
            return False
        if co2 > 5000:
            print(f"WARNING: CO2 reading ({co2} ppm) is abnormally high")
            return False
    
    # Check temperature readings
    if "temperature" in data:
        temp = data["temperature"]
        if temp < -10 or temp > 60:
            print(f"WARNING: Temperature reading ({temp}°C) is out of expected range")
            return False
    
    # Check humidity readings
    if "humidity" in data:
        humidity = data["humidity"]
        if humidity < 0 or humidity > 100:
            print(f"WARNING: Humidity reading ({humidity}%) is out of expected range")
            return False
    
    return True

def diagnose_scd41():
    """Run a comprehensive diagnostic check on the SCD41 sensor"""
    print("\n====== SCD41 DIAGNOSTIC TEST ======")
    
    # Check I2C bus for the device
    devices = i2c.scan()
    if SCD41_I2C_ADDR not in devices:
        print(f"ERROR: SCD41 not found on I2C bus. Devices found: {[hex(d) for d in devices]}")
        print("Check your wiring and power connections")
        return False
    
    print("SCD41 found on I2C bus at address 0x62")
    
    # Try stopping any measurement
    print("Testing basic communication...")
    try:
        scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
        time.sleep(0.5)
        print("Successfully sent stop command")
    except Exception as e:
        print(f"ERROR: Failed to send stop command: {e}")
        return False
    
    # Try getting data ready status
    try:
        scd41_send_command(SCD41_CMD_GET_DATA_READY_STATUS)
        time.sleep(0.01)
        data = scd41_read_data(3)
        if data is None or len(data) < 3:
            print("ERROR: Failed to read data ready status")
        else:
            status = (data[0] << 8) | data[1]
            print(f"Data ready status raw value: {hex(status)}")
    except Exception as e:
        print(f"ERROR: Failed to read data ready status: {e}")
    
    # Run manual calibration with ambient level
    print("\nAttempting manual calibration with standard ambient CO2 level (400ppm)...")
    success = perform_manual_calibration(400)
    if not success:
        print("Manual calibration failed")
    
    # Restart measurements and try to read values
    print("\nRestarting measurements and attempting to read values...")
    scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
    
    # Wait for first measurement
    print("Waiting 10 seconds for sensor warm-up...")
    time.sleep(10)
    
    # Try reading 3 consecutive measurements
    valid_readings = 0
    for i in range(3):
        print(f"\nReading attempt {i+1}:")
        # Check if data is ready
        if not scd41_is_data_ready():
            print("Data not ready yet")
            time.sleep(2)
            continue
            
        # Read measurement
        scd41_send_command(SCD41_CMD_READ_MEASUREMENT)
        time.sleep(0.01)
        data = scd41_read_data(9)
        
        if data is None or len(data) < 9:
            print("Failed to read complete data")
            continue
            
        print(f"Raw data: {[hex(b) for b in data]}")
        
        # Process data
        co2 = (data[0] << 8) | data[1]
        temp_raw = (data[3] << 8) | data[4]
        temperature = -45 + (175 * temp_raw / 65535)
        humidity_raw = (data[6] << 8) | data[7]
        humidity = 100 * humidity_raw / 65535
        
        print(f"Parsed values - CO2: {co2} ppm, Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%")
        
        if co2 > 0:
            valid_readings += 1
        
        time.sleep(5)  # Wait for next measurement
    
    print(f"\nDiagnostic summary: {valid_readings} out of 3 readings had valid CO2 values")
    
    if valid_readings == 0:
        print("DIAGNOSIS: Sensor is not providing valid CO2 readings")
        print("Recommendations:")
        print("1. Try a factory reset")
        print("2. Ensure sensor has been powered for at least 1 minute before taking readings")
        print("3. Check for proper voltage (3.3V required)")
        print("4. Try lowering the I2C frequency (currently 10kHz)")
    elif valid_readings < 3:
        print("DIAGNOSIS: Sensor is intermittently providing valid readings")
        print("Recommendations:")
        print("1. Try manual calibration again")
        print("2. Check for I2C bus stability")
    else:
        print("DIAGNOSIS: Sensor appears to be working correctly now")
    
    print("====== DIAGNOSTIC TEST COMPLETE ======\n")
    return valid_readings > 0

def read_scd41():
    """Read measurements from SCD41 sensor"""
    try:
        # Check if data is ready
        if not scd41_is_data_ready():
            if DEBUG:
                print("SCD41 data not yet ready")
            return None
        
        # Read measurement data
        scd41_send_command(SCD41_CMD_READ_MEASUREMENT)
        time.sleep(0.01)
        data = scd41_read_data(9)  # 9 bytes: 2 for CO2, 2 for temp, 2 for humidity, 2 for CRC
        
        if data is None or len(data) < 9:
            print("Failed to read complete data from SCD41")
            return None
        
        if DEBUG:
            print(f"SCD41 raw data: {[hex(b) for b in data]}")
        
        # Process data (CO2: bytes 0-1, Temp: bytes 3-4, Humidity: bytes 6-7)
        co2 = (data[0] << 8) | data[1]
        
        # Temperature is in celsius * 175 / 2^16 - 45
        temp_raw = (data[3] << 8) | data[4]
        temperature = -45 + (175 * temp_raw / 65535)
        
        # Humidity is in %RH * 100 / 2^16
        humidity_raw = (data[6] << 8) | data[7]
        humidity = 100 * humidity_raw / 65535
        
        if DEBUG:
            print(f"SCD41 readings - CO2: {co2} ppm, Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%")
        
        return {
            "co2": co2,
            "temperature": round(temperature, 1),
            "humidity": round(humidity, 1)
        }
    except Exception as e:
        print(f"Error reading from SCD41 sensor: {e}")
        return None

def read_scd41_partial():
    """Read only temperature and humidity from SCD41, ignoring the broken CO2 sensor"""
    try:
        # Check if data is ready
        if not scd41_is_data_ready():
            if DEBUG:
                print("SCD41 data not yet ready")
            return None
        
        # Read measurement data
        scd41_send_command(SCD41_CMD_READ_MEASUREMENT)
        time.sleep(0.01)
        data = scd41_read_data(9)
        
        if data is None or len(data) < 9:
            print("Failed to read complete data from SCD41")
            return None
        
        if DEBUG:
            print(f"SCD41 raw data: {[hex(b) for b in data]}")
        
        # Skip CO2 processing since that element is broken
        # Process temperature and humidity which are working
        temp_raw = (data[3] << 8) | data[4]
        temperature = -45 + (175 * temp_raw / 65535)
        
        humidity_raw = (data[6] << 8) | data[7]
        humidity = 100 * humidity_raw / 65535
        
        if DEBUG:
            print(f"SCD41 readings - Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%")
        
        return {
            # Omit CO2 since it's broken
            "temperature": round(temperature, 1),
            "humidity": round(humidity, 1)
        }
    except Exception as e:
        print(f"Error reading from SCD41 sensor: {e}")
        return None

# Then modify your send_combined_data function call:
def send_combined_data(velocity, environmental_data):
    """Send all sensor data to REST API"""
    try:
        # Create combined data object
        data = {
            "device_id": DEVICE_ID,
            "sensors": {}
        }
        
        # Add air velocity data if available
        if velocity is not None:
            data["sensors"]["air_velocity"] = {
                "value": round(velocity, 2),
                "unit": "m/s"
            }
        
        # Add environmental data if available
        if environmental_data is not None:
            # Skip CO2 since we know it's broken
            # if "co2" in environmental_data:
            #     data["sensors"]["co2"] = {
            #         "value": environmental_data["co2"],
            #         "unit": "ppm"
            #     }
            
            if "temperature" in environmental_data:
                data["sensors"]["temperature"] = {
                    "value": environmental_data["temperature"],
                    "unit": "C"
                }
            
            if "humidity" in environmental_data:
                data["sensors"]["humidity"] = {
                    "value": environmental_data["humidity"],
                    "unit": "%"
                }
        
        print(f"Sending data to API: {data}")
        
        response = urequests.post(
            API_URL,
            json=data,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"API Response: {response.status_code}")
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
    
def test_sensors():
    """Test function to diagnose sensor issues"""
    print("\n====== RUNNING SENSOR DIAGNOSTIC TEST ======")
    
    # Check I2C bus
    devices = i2c.scan()
    print(f"Devices found on I2C bus: {[hex(d) for d in devices]}")
    
    # Test FS3000
    if FS3000_I2C_ADDR in devices:
        print("FS3000 sensor found on I2C bus.")
        
        try:
            # Try reading the data register
            i2c.writeto(FS3000_I2C_ADDR, bytes([0x00]))
            time.sleep(0.2)
            
            data = i2c.readfrom(FS3000_I2C_ADDR, 2)
            raw_count = (data[1] << 8) | data[0]
            print(f"FS3000 reading: {[hex(b) for b in data]} - Value: {raw_count}")
        except Exception as e:
            print(f"Error testing FS3000: {e}")
    else:
        print("FS3000 sensor NOT found!")
    
    # Test SCD41
    if SCD41_I2C_ADDR in devices:
        print("SCD41 sensor found on I2C bus.")
        
        try:
            # Test stop command
            print("Testing SCD41 stop command...")
            scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
            time.sleep(0.5)
            
            # Test start command
            print("Testing SCD41 start command...")
            scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
            time.sleep(0.1)
            
            print("SCD41 commands sent successfully")
        except Exception as e:
            print(f"Error testing SCD41: {e}")
    else:
        print("SCD41 sensor NOT found!")
    
    print("====== SENSOR TEST COMPLETE ======\n")
    return FS3000_I2C_ADDR in devices or SCD41_I2C_ADDR in devices

def main():
    """Main program loop - Using SCD41 for temperature and humidity only"""
    print("\n========================================")
    print("Starting Multi-Sensor Setup with Pico W")
    print("FS3000 Air Velocity + SCD41 Temp/Humidity")
    print("Note: CO2 readings disabled (sensor issue)")
    print("========================================\n")
    
    # Blink LED to indicate program start
    for _ in range(2):
        led.on()
        time.sleep(0.2)
        led.off()
        time.sleep(0.2)
    
    # Connect to Wi-Fi
    wifi_connected = False
    retry_count = 0
    
    while not wifi_connected and retry_count < 3:
        wifi_connected = connect_wifi()
        if not wifi_connected:
            print(f"Wi-Fi connection attempt {retry_count+1} failed. Retrying...")
            retry_count += 1
            time.sleep(2)
    
    if not wifi_connected:
        print("Failed to connect to Wi-Fi after multiple attempts.")
        # Error indication - 3 slow blinks
        for _ in range(3):
            led.on()
            time.sleep(0.5)
            led.off()
            time.sleep(0.5)
        return
    
    # Scan for devices
    devices = i2c.scan()
    print(f"Devices found on I2C bus: {[hex(d) for d in devices]}")
    
    # Check for SCD41
    scd41_present = SCD41_I2C_ADDR in devices
    if scd41_present:
        print("SCD41 sensor found - initializing for temperature and humidity only")
        # Initialize SCD41 for temp/humidity (CO2 is broken but we'll still initialize)
        scd41_send_command(SCD41_CMD_STOP_PERIODIC_MEASUREMENT)
        time.sleep(0.5)
        scd41_send_command(SCD41_CMD_START_PERIODIC_MEASUREMENT)
        time.sleep(5)  # Wait for first measurement cycle
    else:
        print("SCD41 sensor not found on I2C bus.")
    
    # Check for FS3000
    fs3000_present = FS3000_I2C_ADDR in devices
    if fs3000_present:
        print("FS3000 air velocity sensor found.")
    else:
        print("FS3000 sensor not found on I2C bus.")
    
    if not (scd41_present or fs3000_present):
        print("No sensors detected. Check connections and retry.")
        # Flash LED code for sensor failure
        for _ in range(10):
            led.on()
            time.sleep(0.1)
            led.off() 
            time.sleep(0.1)
        return
    
    print("\nSetup complete. Starting measurement loop...")
    
    # Main measurement loop
    measurement_interval = 2  # 2 second interval - adjust as needed
    failure_count = 0  # Track consecutive failures
    
    # SCD41 measurement timing
    scd41_interval = 5  # SCD41 updates every 5 seconds
    last_scd41_read = time.time()
    environmental_data = None
    
    while True:
        try:
            # Read air velocity from FS3000
            velocity = None
            if fs3000_present:
                velocity = read_fs3000()
            
            # Read environmental data from SCD41 (less frequently)
            current_time = time.time()
            if scd41_present and (current_time - last_scd41_read >= scd41_interval):
                # Use regular read function, but we'll process the data to ignore CO2
                raw_data = read_scd41()
                if raw_data is not None:
                    # Create a new dict with only temperature and humidity
                    environmental_data = {
                        "temperature": raw_data["temperature"],
                        "humidity": raw_data["humidity"]
                        # We're intentionally not including CO2 here
                    }
                last_scd41_read = current_time
            
            # Send the combined data
            if velocity is not None or environmental_data is not None:
                # Create combined data object
                data = {
                    "device_id": DEVICE_ID,
                    "sensors": {}
                }
                
                # Add air velocity data if available
                if velocity is not None:
                    data["sensors"]["air_velocity"] = {
                        "value": round(velocity, 2),
                        "unit": "m/s"
                    }
                
                # Add environmental data if available
                if environmental_data is not None:
                    # Skip CO2 - it's not in our environmental_data anymore
                    
                    if "temperature" in environmental_data:
                        data["sensors"]["temperature"] = {
                            "value": environmental_data["temperature"],
                            "unit": "C"
                        }
                    
                    if "humidity" in environmental_data:
                        data["sensors"]["humidity"] = {
                            "value": environmental_data["humidity"],
                            "unit": "%"
                        }
                
                print(f"Sending data to API: {data}")
                
                response = urequests.post(
                    API_URL,
                    json=data,
                    headers={"Content-Type": "application/json"}
                )
                
                print(f"API Response: {response.status_code}")
                response.close()
                
                # Blink LED to indicate successful transmission
                led.on()
                time.sleep(0.1)
                led.off()
                
                failure_count = 0  # Reset failure counter on success
            else:
                print("Failed to read from any sensors")
                failure_count += 1
                
                # If multiple consecutive failures, try to reset I2C
                if failure_count >= 3:
                    print("Multiple consecutive read failures. Attempting I2C reset...")
                    reset_i2c_bus()
                    failure_count = 0
                
                # Signal error - 2 blinks
                for _ in range(2):
                    led.on()
                    time.sleep(0.3)
                    led.off()
                    time.sleep(0.3)
            
            # Wait before next reading
            time.sleep(measurement_interval)
            
        except Exception as e:
            print(f"Error in main loop: {e}")
            failure_count += 1
            
            # If many failures, try a full reset
            if failure_count > 10:
                print("Too many consecutive failures. Performing system reset...")
                time.sleep(1)
                reset()  # Full system reset
            
            time.sleep(5)  # Wait before retrying

def troubleshooting_main():
    """Main function focused on troubleshooting the SCD41 sensor"""
    print("\n========================================")
    print("SCD41 TROUBLESHOOTING MODE")
    print("========================================\n")
    
    # Blink LED to indicate special mode
    for _ in range(5):
        led.on()
        time.sleep(0.1)
        led.off()
        time.sleep(0.1)
    
    # Scan I2C bus
    devices = i2c.scan()
    print(f"Devices found on I2C bus: {[hex(d) for d in devices]}")
    
    if SCD41_I2C_ADDR not in devices:
        print("ERROR: SCD41 not found on I2C bus!")
        return
    
    print("SCD41 found on I2C bus. Starting troubleshooting sequence...")
    
    # Step 1: Run initial diagnostic
    print("\nSTEP 1: Initial diagnostic")
    diagnose_scd41()
    
    # Step 2: Factory reset
    print("\nSTEP 2: Performing factory reset")
    factory_reset_scd41()
    
    # Step 3: Run diagnostic again after factory reset
    print("\nSTEP 3: Diagnostic after factory reset")
    diagnose_scd41()
    
    # Step 4: Try different I2C frequency
    print("\nSTEP 4: Trying different I2C frequency")
    try_different_i2c_frequency()
    
    # Step 5: Final diagnostic
    print("\nSTEP 5: Final diagnostic")
    success = diagnose_scd41()
    
    if success:
        print("\n✅ TROUBLESHOOTING SUCCESSFUL: SCD41 now working correctly!")
    else:
        print("\n❌ TROUBLESHOOTING UNSUCCESSFUL: SCD41 still not providing valid readings.")
        print("Recommendations:")
        print("1. Check power supply - verify 3.3V with multimeter if possible")
        print("2. Try disconnecting and reconnecting the sensor")
        print("3. Contact supplier for replacement if issue persists")
    
    print("\nReturning to normal operation...")
    time.sleep(2)

if __name__ == "__main__":
    main()
    # troubleshooting_main()

