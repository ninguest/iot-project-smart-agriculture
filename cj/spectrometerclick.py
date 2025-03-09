import network
import urequests
import time
import json
from machine import Pin, I2C

# Wi-Fi configuration
SSID = "yo"
PASSWORD = "pleasestophacking"

# Server configuration
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "spectrometerclick_sensor"

# Status LED
led = Pin("LED", Pin.OUT)

# AS7341 I2C address
AS7341_ADDR = 0x39

# AS7341 Registers
REG_ENABLE = 0x80
REG_ATIME = 0x81
REG_WTIME = 0x83
REG_CONTROL = 0xAA
REG_ID = 0x92
REG_STATUS = 0x93
REG_CH0_DATA_L = 0x95
REG_CH0_DATA_H = 0x96
REG_CH1_DATA_L = 0x97
REG_CH1_DATA_H = 0x98
REG_CH2_DATA_L = 0x99
REG_CH2_DATA_H = 0x9A
REG_CH3_DATA_L = 0x9B
REG_CH3_DATA_H = 0x9C
REG_CH4_DATA_L = 0x9D
REG_CH4_DATA_H = 0x9E
REG_CH5_DATA_L = 0x9F
REG_CH5_DATA_H = 0xA0
REG_CONFIG = 0xA9
REG_LED = 0xB3

# Initialize I2C
i2c = I2C(1, scl=Pin(27), sda=Pin(26), freq=100000)

def write_reg(reg, value):
    """Write a value to a register"""
    i2c.writeto(AS7341_ADDR, bytes([reg, value]))

def read_reg(reg):
    """Read a value from a register"""
    i2c.writeto(AS7341_ADDR, bytes([reg]))
    return i2c.readfrom(AS7341_ADDR, 1)[0]

def read_reg_word(reg):
    """Read a 16-bit value from two registers"""
    i2c.writeto(AS7341_ADDR, bytes([reg]))
    data = i2c.readfrom(AS7341_ADDR, 2)
    return data[0] | (data[1] << 8)

def setup_sensor():
    """Initialize the AS7341 sensor"""
    # Check if sensor is connected
    try:
        device_id = read_reg(REG_ID)
        print(f"Device ID: 0x{device_id:02X}")
        
        # Accept any device ID - your sensor reports 0x24 instead of 0x09
        if device_id != 0x09:
            print("Non-standard device ID detected. Proceeding anyway...")
    except Exception as e:
        print(f"Error connecting to AS7341: {e}")
        return False
    
    # Power on and enable ADC
    write_reg(REG_ENABLE, 0x01)  # Power on
    time.sleep(0.01)
    write_reg(REG_ENABLE, 0x03)  # Power on + ADC enable
    
    # Configure integration time (ATIME)
    write_reg(REG_ATIME, 0x3C)  # 100ms integration time
    
    # Configure gain (higher gain for better sensitivity)
    write_reg(REG_CONTROL, 0x06)  # Gain = 64x
    
    return True

def enable_led(enable=True, current=50):
    """Control the built-in white LED
    enable: True to turn on, False to turn off
    current: 0-255, controls LED brightness
    """
    if enable:
        # Set current limit (0-255)
        current = max(0, min(255, current))
        write_reg(REG_LED, current)
        
        # Enable LED drive
        ctrl_reg = read_reg(REG_CONFIG)
        write_reg(REG_CONFIG, ctrl_reg | 0x08)
    else:
        # Disable LED drive
        ctrl_reg = read_reg(REG_CONFIG)
        write_reg(REG_CONFIG, ctrl_reg & ~0x08)

def select_bank(bank):
    """Select which set of channels to read
    bank 0: F1, F2, F3, F4, CL, NIR 
    bank 1: F5, F6, F7, F8, CL, NIR
    """
    # Write to the control register to enable SMUX confguration
    write_reg(REG_CONFIG, 0x01)
    
    # Wait for SMUX to be ready
    time.sleep(0.01)
    
    if bank == 0:
        # Configure SMUX for F1-F4 + CL + NIR
        write_reg(0xAF, 0x10)
        write_reg(0xAF, 0x11)
        time.sleep(0.05)
    else:
        # Configure SMUX for F5-F8 + CL + NIR
        write_reg(0xAF, 0x20)
        write_reg(0xAF, 0x21)
        time.sleep(0.05)
    
    # Close SMUX configuration
    write_reg(REG_CONFIG, 0x00)
    time.sleep(0.05)

def start_measurement():
    """Start a one-shot measurement"""
    # Enable spectral measurement
    enable_reg = read_reg(REG_ENABLE)
    write_reg(REG_ENABLE, enable_reg | 0x02)
    
    # Wait for measurement to complete
    time.sleep(0.1)  # Allow at least the integration time to elapse
    while (read_reg(REG_STATUS) & 0x08) == 0:
        time.sleep(0.01)

def read_spectral_data():
    """Read all spectral channels"""
    # First bank: F1-F4, Clear, NIR
    select_bank(0)
    start_measurement()
    
    f1 = read_reg_word(REG_CH0_DATA_L)
    f2 = read_reg_word(REG_CH1_DATA_L)
    f3 = read_reg_word(REG_CH2_DATA_L)
    f4 = read_reg_word(REG_CH3_DATA_L)
    clear1 = read_reg_word(REG_CH4_DATA_L)
    nir1 = read_reg_word(REG_CH5_DATA_L)
    
    # Second bank: F5-F8, Clear, NIR
    select_bank(1)
    start_measurement()
    
    f5 = read_reg_word(REG_CH0_DATA_L)
    f6 = read_reg_word(REG_CH1_DATA_L)
    f7 = read_reg_word(REG_CH2_DATA_L)
    f8 = read_reg_word(REG_CH3_DATA_L)
    clear2 = read_reg_word(REG_CH4_DATA_L)
    nir2 = read_reg_word(REG_CH5_DATA_L)
    
    # Return combined results with wavelength information
    return {
        "F1 (415nm/Violet)": f1,
        "F2 (445nm/Indigo)": f2,
        "F3 (480nm/Blue)": f3,
        "F4 (515nm/Cyan)": f4,
        "F5 (555nm/Green)": f5,
        "F6 (590nm/Yellow)": f6,
        "F7 (630nm/Orange)": f7,
        "F8 (680nm/Red)": f8,
        "Clear": (clear1 + clear2) // 2,  # Average of both readings
        "NIR": (nir1 + nir2) // 2         # Average of both readings
    }

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

def format_sensor_data(spectral_data):
    """Format spectral data for API submission"""
    sensors = {}
    
    # Map channels to wavelengths for better readability
    wavelengths = {
        "F1 (415nm/Violet)": "violet",
        "F2 (445nm/Indigo)": "indigo",
        "F3 (480nm/Blue)": "blue",
        "F4 (515nm/Cyan)": "cyan",
        "F5 (555nm/Green)": "green",
        "F6 (590nm/Yellow)": "yellow",
        "F7 (630nm/Orange)": "orange",
        "F8 (680nm/Red)": "red",
        "Clear": "clear",
        "NIR": "nir"
    }
    
    # Add spectral channels with wavelength in nm
    for channel, value in spectral_data.items():
        if channel in wavelengths:
            sensors[f"spectral_{wavelengths[channel]}"] = {
                "value": value,
                "unit": "counts"
            }
        else:
            # For Clear and NIR channels
            sensors[f"spectral_{channel.lower()}"] = {
                "value": value,
                "unit": "counts"
            }
    
    return sensors

def send_data_to_server(sensor_data):
    """Send sensor data to the server"""
    try:
        # Create data object
        data = {
            "device_id": DEVICE_ID,
            "sensors": sensor_data
        }
        
        print("Sending data to server...")
        
        # Convert to JSON string
        json_data = json.dumps(data)
        
        # Send HTTP POST request
        response = urequests.post(
            API_URL,
            data=json_data,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Server response: {response.status_code}")
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

def main():
    print("\n========================================")
    print("Starting AS7341 Spectrometer with REST API")
    print("Sending data to server every 5 seconds")
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
    
    # Initialize AS7341
    print("Initializing AS7341 spectrometer...")
    if not setup_sensor():
        print("Failed to initialize sensor. Check connections.")
        # Error indication - 5 quick blinks
        for _ in range(5):
            led.on()
            time.sleep(0.1)
            led.off()
            time.sleep(0.1)
        return
    
    print("Sensor initialized successfully!")
    
    # Optional: Turn on the white LED for reflective measurements
    # Uncomment the following line to enable the LED
    # enable_led(True, 50)  # Enable at 50/255 brightness
    
    try:
        print("\nSetup complete. Starting data transmission loop...")
        
        # Main loop - read and send data every 5 seconds
        while True:
            try:
                # Read spectral data
                print("\nReading spectral data...")
                spectral_data = read_spectral_data()
                
                # Print a simple version of the readings
                print("\nSpectral Readings Summary:")
                print(f"Violet: {spectral_data['F1 (415nm/Violet)']} | Blue: {spectral_data['F3 (480nm/Blue)']} | Green: {spectral_data['F5 (555nm/Green)']}")
                print(f"Yellow: {spectral_data['F6 (590nm/Yellow)']} | Orange: {spectral_data['F7 (630nm/Orange)']} | Red: {spectral_data['F8 (680nm/Red)']}")
                print(f"Clear: {spectral_data['Clear']} | NIR: {spectral_data['NIR']}")
                
                # Format sensor data
                sensor_data = format_sensor_data(spectral_data)
                
                # Send data to server
                send_data_to_server(sensor_data)
                
                # Wait before next reading
                time.sleep(5)
                
            except Exception as e:
                print(f"Error in measurement loop: {e}")
                time.sleep(2)  # Short delay before retrying
                
    except KeyboardInterrupt:
        print("\nMeasurement stopped.")
        # Turn off LED if it was enabled
        enable_led(False)

if __name__ == "__main__":
    main()
