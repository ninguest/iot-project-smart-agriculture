from machine import Pin, I2C
import time

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

# Initialize I2C with lower frequency for better compatibility
i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)

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

def send_command(command):
    """Send command to SCD41"""
    i2c.writeto(SCD41_ADDRESS, command)

def send_command_with_args(command, arguments):
    """Send command with arguments to SCD41"""
    buffer = bytearray(command)
    buffer.extend(arguments)
    buffer.append(calculate_crc(arguments))
    i2c.writeto(SCD41_ADDRESS, buffer)

def read_data(command, length=3):
    """Read data from SCD41 with proper CRC checking"""
    send_command(command)
    # SCD41 needs time to process the read command
    time.sleep(0.001)
    data = i2c.readfrom(SCD41_ADDRESS, length)
    return data

def start_periodic_measurement():
    """Start periodic measurement"""
    send_command(CMD_START_PERIODIC_MEASUREMENT)
    # Wait for the first measurement (5 seconds)
    time.sleep(5)

def stop_periodic_measurement():
    """Stop periodic measurement"""
    send_command(CMD_STOP_PERIODIC_MEASUREMENT)
    time.sleep(0.5)  # Give it time to process the stop command

def read_measurement():
    """Read and process measurement data"""
    try:
        data = read_data(CMD_READ_MEASUREMENT, 9)
        
        # Check if data is valid (should be 9 bytes)
        if len(data) != 9:
            print(f"Invalid data length: {len(data)}")
            return None, None, None
        
        # Parse CO2 (first 2 bytes + CRC)
        co2 = (data[0] << 8) | data[1]
        # Verify CRC for CO2
        if calculate_crc(data[0:2]) != data[2]:
            # Instead of printing error, we'll just continue
            pass
        
        # Parse temperature (next 2 bytes + CRC)
        temp_raw = (data[3] << 8) | data[4]
        temperature = -45 + 175 * temp_raw / 65535
        # Verify CRC for temperature
        if calculate_crc(data[3:5]) != data[5]:
            # Instead of printing error, we'll just continue
            pass
        
        # Parse humidity (next 2 bytes + CRC)
        hum_raw = (data[6] << 8) | data[7]
        humidity = 100 * hum_raw / 65535
        # Verify CRC for humidity
        if calculate_crc(data[6:8]) != data[8]:
            # Instead of printing error, we'll just continue
            pass
        
        return co2, temperature, humidity
    except Exception as e:
        # Don't print the error, we'll handle it in the main loop
        return None, None, None

def force_calibration(target_co2=400):
    """Force calibration with known CO2 value (typically 400ppm for fresh air)"""
    # Convert target CO2 value to bytes (MSB first)
    target_bytes = bytearray([(target_co2 >> 8) & 0xFF, target_co2 & 0xFF])
    send_command_with_args(CMD_FORCE_CALIBRATION, target_bytes)
    time.sleep(1)

def enable_automatic_calibration(enable=True):
    """Enable or disable automatic self-calibration"""
    value = 1 if enable else 0
    send_command_with_args(CMD_SET_AUTOMATIC_CALIBRATION, bytearray([0, value]))
    time.sleep(0.5)

def set_altitude_compensation(altitude_meters=0):
    """Set altitude compensation in meters above sea level"""
    # Convert altitude to bytes (MSB first)
    altitude_bytes = bytearray([(altitude_meters >> 8) & 0xFF, altitude_meters & 0xFF])
    send_command_with_args(CMD_ALTITUDE_COMPENSATION, altitude_bytes)
    time.sleep(0.5)

# Main program
try:
    # Check if SCD41 is connected
    devices = i2c.scan()
    if SCD41_ADDRESS not in devices:
        print(f"SCD41 not found at address 0x{SCD41_ADDRESS:02X}")
        print(f"Devices found: {[hex(x) for x in devices]}")
    else:
        print(f"SCD41 found at address 0x{SCD41_ADDRESS:02X}")
        
        print("Performing factory reset...")
        send_command(CMD_FACTORY_RESET)
        time.sleep(1)  # Wait for reset to complete

        print("Reinitializing sensor...")
        send_command(CMD_REINIT)
        time.sleep(0.5)
        
        print("Enabling automatic calibration...")
        enable_automatic_calibration(True)

        print("Setting altitude compensation...")
        set_altitude_compensation(0)  # Set to your approximate altitude above sea level

        # First stop any previous measurements
        stop_periodic_measurement()
        
        print("Warming up CO2 sensor (30 seconds)...")
        start_periodic_measurement()
        for i in range(6):  # 6 x 5 seconds = 30 seconds
            print(f"Warm-up: {(i+1)*5} seconds")
            time.sleep(5)
        
        print("Performing forced calibration (assuming clean air ~400ppm)...")
        stop_periodic_measurement()
        time.sleep(0.5)
        force_calibration(400)  # Assumes you're in fresh air at ~400ppm
        time.sleep(1)
        
        # Start periodic measurement
        start_periodic_measurement()
        
        # Variables to track last reading and update time
        last_co2 = 0
        last_temp = 0
        last_humidity = 0
        last_update = time.time()
        update_count = 0
        
        # Read measurements in a loop
        while True:
            current_time = time.time()
            
            # Try to get a new reading
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
            
            # Wait before next reading - shorter interval to create smoother output
            time.sleep(1)
            
except KeyboardInterrupt:
    # Stop measurement when program exits
    try:
        stop_periodic_measurement()
        print("Stopped measurements")
    except:
        pass
