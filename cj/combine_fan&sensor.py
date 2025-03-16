import network
import time
import json
import random
from umqtt.simple import MQTTClient
import machine
from machine import Pin, I2C
import urequests

# Wi-Fi configuration
WIFI_SSID = "yo"
WIFI_PASSWORD = "pleasestophacking"

# GPIO Pin for Fan Control
Fan = Pin(15, Pin.OUT)

# Onboard LED
led = machine.Pin("LED", machine.Pin.OUT)

#######################################################
# MQTT Configuration
#######################################################
MQTT_BROKER = "broker.emqx.io"
MQTT_PORT = 1883
MQTT_CLIENT_ID = f"pico_w_{random.randint(0, 1000000)}"
DEVICE_ID = "pico_fan_control"  # A unique ID for your device
MQTT_TOPIC_PREFIX = "ycstation/devices/"  # Same as in your server

# Commands topic (to receive commands)
COMMANDS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/commands"
# Broadcast topic (to receive broadcast commands)
BROADCAST_TOPIC = f"{MQTT_TOPIC_PREFIX}all/commands"
# Status topic (to publish device status)
STATUS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/status"
# Acknowledgment topic (to confirm commands)
ACK_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/ack"

#######################################################
# Sensor Server Configuration
#######################################################
API_URL = "https://iot.ycstation.work/sensors"

# Device IDs for sensors
DEVICE_ID_CO2 = "Sensirion-SCD41(CO2)"
DEVICE_ID_SPECTROMETER = "spectrometerclick_sensor"

#######################################################
# I2C configuration for sensors
#######################################################
i2c_co2 = I2C(0, scl=Pin(1), sda=Pin(0), freq=100000)  # Use GPIO 0 and 1 for CO2 sensor
i2c_spectro = I2C(1, scl=Pin(27), sda=Pin(26), freq=100000)  # Use GPIO 26 and 27 for spectrometer

# wifi connection setup
def connect_wifi():
    """Connect to Wi-Fi network"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    
    print(f"Connecting to WiFi: {WIFI_SSID}")
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        # Wait for connection with timeout
        max_wait = 20
        while max_wait > 0:
            if wlan.isconnected():
                break
            max_wait -= 1
            print("Waiting for connection...")
            time.sleep(1)
    
    if wlan.isconnected():
        print("WiFi connected!")
        print(f"IP address: {wlan.ifconfig()[0]}")
        return True
    else:
        print("WiFi connection failed!")
        return False

#######################################################
# MQTT Functions
#######################################################

# MQTT callback function for incoming messages
def mqtt_callback(topic, msg):
    print(f"Received message on {topic}: {msg}")
    
    try:
        # Decode topic and message
        topic_str = topic.decode('utf-8')
        msg_str = msg.decode('utf-8')
        
        # Process commands from either direct or broadcast topics
        if topic_str == COMMANDS_TOPIC or topic_str == BROADCAST_TOPIC:
            command = json.loads(msg_str)
            process_command(command)
    except Exception as e:
        print(f"Error processing message: {e}")

# Process command messages
def process_command(command):
    command_id = command.get('id', 'unknown')
    component = command.get('component', '')
    action = command.get('action', '')
    value = command.get('value', '')
    
    print(f"Processing command: {component}.{action}={value}")
    success = False
    message = "Unknown command"
    
    # Handle Fan commands (we'll use 'Fan' as the component name)
    if component == 'fan':
        if action == 'power':
            if value == 'on':
                Fan.value(1)
                success = True
                message = "Fan turned on"
            elif value == 'off':
                Fan.value(0)
                success = True
                message = "Fan turned off"
    
    # Send acknowledgment
    send_ack(command_id, success, message)

# Send command acknowledgment
def send_ack(command_id, success, message):
    ack = {
        'command_id': command_id,
        'success': success,
        'message': message,
        'timestamp': time.time()
    }
    try:
        mqtt_client.publish(ACK_TOPIC, json.dumps(ack))
        print(f"Acknowledgment sent: {success}, {message}")
    except Exception as e:
        print(f"Error sending acknowledgment: {e}")

# Send device status update
def send_status():
    status = {
        'device_id': DEVICE_ID,
        'status': 'online',
        'capabilities': ['Fan'],
        'components': {
            'Fan': {
                'power': 'on' if Fan.value() else 'off'
            }
        },
        'timestamp': time.time()
    }
    try:
        mqtt_client.publish(STATUS_TOPIC, json.dumps(status))
        print("Status update sent")
    except Exception as e:
        print(f"Error sending status: {e}")

# Initialize MQTT client
def init_mqtt():
    global mqtt_client
    try:
        mqtt_client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
        mqtt_client.set_callback(mqtt_callback)
        mqtt_client.connect()
        print(f"Connected to MQTT broker: {MQTT_BROKER}")
        
        # Subscribe to device-specific commands topic
        mqtt_client.subscribe(COMMANDS_TOPIC)
        print(f"Subscribed to device commands: {COMMANDS_TOPIC}")
        
        # Subscribe to broadcast commands topic
        mqtt_client.subscribe(BROADCAST_TOPIC)
        print(f"Subscribed to broadcast commands: {BROADCAST_TOPIC}")
        
        # Send initial status
        send_status()
        return True
    except Exception as e:
        print(f"MQTT initialization error: {e}")
        return False

#######################################################
# Sensor Data API Function
#######################################################
def send_data_to_server(device_id, sensor_data):
    """Send sensor data to the server"""
    try:
        # Create data object
        data = {
            "device_id": device_id,
            "sensors": sensor_data
        }
        
        print(f"Sending {device_id} data to server")
        
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

#######################################################
# SCD41 CO2 Sensor Functions
#######################################################

# SCD41 I2C address
SCD41_ADDR = 0x62

# SCD41 Commands
CMD_START_PERIODIC_MEASUREMENT = b'\x21\xB1'
CMD_READ_MEASUREMENT = b'\xEC\x05'
CMD_STOP_PERIODIC_MEASUREMENT = b'\x3F\x86'

def write_command_co2(cmd):
    """Write a command to the SCD41 without data."""
    i2c_co2.writeto(SCD41_ADDR, cmd)

def read_data_co2(cmd, length=9):
    """Read data from the SCD41 after sending a command."""
    write_command_co2(cmd)
    time.sleep(0.1)  # Give the sensor time to process
    return i2c_co2.readfrom(SCD41_ADDR, length)

def start_periodic_measurement_co2():
    """Start periodic measurement for CO2 sensor."""
    write_command_co2(CMD_START_PERIODIC_MEASUREMENT)
    time.sleep(5)  # Wait for the first measurement to be ready

def stop_periodic_measurement_co2():
    """Stop periodic measurement for CO2 sensor."""
    write_command_co2(CMD_STOP_PERIODIC_MEASUREMENT)
    time.sleep(0.5)  # Give the sensor time to stop

def read_measurement_co2():
    """Read CO2, temperature, and humidity from SCD41."""
    data = read_data_co2(CMD_READ_MEASUREMENT)
    
    # Parse the results (CO2, temperature, humidity)
    co2 = data[0] << 8 | data[1]
    temp = -45 + 175 * ((data[3] << 8 | data[4]) / 65535.0)
    humidity = 100 * ((data[6] << 8 | data[7]) / 65535.0)
    
    return co2, temp, humidity

def format_co2_data(co2, temperature, humidity):
    """Format CO2 sensor data for API submission"""
    return {
        "co2": {
            "value": co2,
            "unit": "ppm"
        },
        "temperature": {
            "value": round(temperature, 1),
            "unit": "C"
        },
        "humidity": {
            "value": round(humidity, 1),
            "unit": "%"
        }
    }

def init_co2_sensor():
    """Initialize the CO2 sensor"""
    # Scan I2C bus to verify SCD41 is connected
    devices = i2c_co2.scan()
    if SCD41_ADDR not in devices:
        print(f"SCD41 not found! Devices found: {[hex(d) for d in devices]}")
        return False
    
    print("SCD41 detected, starting measurements...")
    start_periodic_measurement_co2()
    return True

#######################################################
# AS7341 Spectrometer Functions
#######################################################

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

def write_reg_spectro(reg, value):
    """Write a value to a register in the spectrometer"""
    i2c_spectro.writeto(AS7341_ADDR, bytes([reg, value]))

def read_reg_spectro(reg):
    """Read a value from a register in the spectrometer"""
    i2c_spectro.writeto(AS7341_ADDR, bytes([reg]))
    return i2c_spectro.readfrom(AS7341_ADDR, 1)[0]

def read_reg_word_spectro(reg):
    """Read a 16-bit value from two registers in the spectrometer"""
    i2c_spectro.writeto(AS7341_ADDR, bytes([reg]))
    data = i2c_spectro.readfrom(AS7341_ADDR, 2)
    return data[0] | (data[1] << 8)

def setup_spectro_sensor():
    """Initialize the AS7341 sensor"""
    # Check if sensor is connected
    try:
        device_id = read_reg_spectro(REG_ID)
        print(f"Spectrometer Device ID: 0x{device_id:02X}")
        
        # Accept any device ID - your sensor reports 0x24 instead of 0x09
        if device_id != 0x09:
            print("Non-standard device ID detected. Proceeding anyway...")
    except Exception as e:
        print(f"Error connecting to AS7341: {e}")
        return False
    
    # Power on and enable ADC
    write_reg_spectro(REG_ENABLE, 0x01)  # Power on
    time.sleep(0.01)
    write_reg_spectro(REG_ENABLE, 0x03)  # Power on + ADC enable
    
    # Configure integration time (ATIME)
    write_reg_spectro(REG_ATIME, 0x3C)  # 100ms integration time
    
    # Configure gain (higher gain for better sensitivity)
    write_reg_spectro(REG_CONTROL, 0x06)  # Gain = 64x
    
    return True

def enable_led_spectro(enable=True, current=50):
    """Control the built-in white LED
    enable: True to turn on, False to turn off
    current: 0-255, controls LED brightness
    """
    if enable:
        # Set current limit (0-255)
        current = max(0, min(255, current))
        write_reg_spectro(REG_LED, current)
        
        # Enable LED drive
        ctrl_reg = read_reg_spectro(REG_CONFIG)
        write_reg_spectro(REG_CONFIG, ctrl_reg | 0x08)
    else:
        # Disable LED drive
        ctrl_reg = read_reg_spectro(REG_CONFIG)
        write_reg_spectro(REG_CONFIG, ctrl_reg & ~0x08)

def select_bank_spectro(bank):
    """Select which set of channels to read
    bank 0: F1, F2, F3, F4, CL, NIR 
    bank 1: F5, F6, F7, F8, CL, NIR
    """
    # Write to the control register to enable SMUX confguration
    write_reg_spectro(REG_CONFIG, 0x01)
    
    # Wait for SMUX to be ready
    time.sleep(0.01)
    
    if bank == 0:
        # Configure SMUX for F1-F4 + CL + NIR
        write_reg_spectro(0xAF, 0x10)
        write_reg_spectro(0xAF, 0x11)
        time.sleep(0.05)
    else:
        # Configure SMUX for F5-F8 + CL + NIR
        write_reg_spectro(0xAF, 0x20)
        write_reg_spectro(0xAF, 0x21)
        time.sleep(0.05)
    
    # Close SMUX configuration
    write_reg_spectro(REG_CONFIG, 0x00)
    time.sleep(0.05)

def start_measurement_spectro():
    """Start a one-shot measurement on the spectrometer"""
    # Enable spectral measurement
    enable_reg = read_reg_spectro(REG_ENABLE)
    write_reg_spectro(REG_ENABLE, enable_reg | 0x02)
    
    # Wait for measurement to complete
    time.sleep(0.1)  # Allow at least the integration time to elapse
    while (read_reg_spectro(REG_STATUS) & 0x08) == 0:
        time.sleep(0.01)

def read_spectral_data():
    """Read all spectral channels from the spectrometer"""
    # First bank: F1-F4, Clear, NIR
    select_bank_spectro(0)
    start_measurement_spectro()
    
    f1 = read_reg_word_spectro(REG_CH0_DATA_L)
    f2 = read_reg_word_spectro(REG_CH1_DATA_L)
    f3 = read_reg_word_spectro(REG_CH2_DATA_L)
    f4 = read_reg_word_spectro(REG_CH3_DATA_L)
    clear1 = read_reg_word_spectro(REG_CH4_DATA_L)
    nir1 = read_reg_word_spectro(REG_CH5_DATA_L)
    
    # Second bank: F5-F8, Clear, NIR
    select_bank_spectro(1)
    start_measurement_spectro()
    
    f5 = read_reg_word_spectro(REG_CH0_DATA_L)
    f6 = read_reg_word_spectro(REG_CH1_DATA_L)
    f7 = read_reg_word_spectro(REG_CH2_DATA_L)
    f8 = read_reg_word_spectro(REG_CH3_DATA_L)
    clear2 = read_reg_word_spectro(REG_CH4_DATA_L)
    nir2 = read_reg_word_spectro(REG_CH5_DATA_L)
    
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

def format_spectral_data(spectral_data):
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

#######################################################
# Main Program
#######################################################
def main():
    global mqtt_client
    
    print("\n========================================")
    print("Unified IoT Control and Sensing System")
    print("Fan Control via MQTT + Sensor Data Collection")
    print("========================================\n")

    # Variables to track component status
    mqtt_working = False
    co2_sensor_working = False
    spectro_working = False

    # Blink LED to indicate program start
    for _ in range(3):
        led.on()
        time.sleep(0.2)
        led.off()
        time.sleep(0.2)

    # Connect to Wi-Fi first
    if not connect_wifi():
        print("Failed to connect to Wi-Fi. Exiting...")
        # Error indication - 3 slow blinks
        for _ in range(3):
            led.on()
            time.sleep(0.5)
            led.off()
            time.sleep(0.5)
        return
    
    # Initialize MQTT
    print("\nInitializing MQTT client...")
    mqtt_working = init_mqtt()
    if not mqtt_working:
        print("Warning: MQTT initialization failed. Fan control will not be available.")
    else:
        print("MQTT client initialized successfully!")
        
    # Initialize CO2 sensor
    print("\nInitializing SCD41 CO2 sensor...")
    co2_sensor_working = init_co2_sensor()
    if not co2_sensor_working:
        print("Warning: CO2 sensor initialization failed. Will continue without CO2 data.")
    else:
        print("CO2 sensor initialized successfully!")
    
    # Initialize Spectrometer
    print("\nInitializing AS7341 spectrometer...")
    spectro_working = setup_spectro_sensor()
    if not spectro_working:
        print("Warning: Spectrometer initialization failed. Will continue without spectral data.")
    else:
        print("Spectrometer initialized successfully!")
    
    # Check if at least one component is working
    if not mqtt_working and not co2_sensor_working and not spectro_working:
        print("ERROR: All system components failed to initialize. Exiting program.")
        for _ in range(5):
            led.on()
            time.sleep(0.2)
            led.off()
            time.sleep(0.2)
        return
    
    try:
        print("\nSetup complete. Starting main system loop...")
        
        # Timing variables
        last_status_time = time.time()
        last_sensor_time = time.time()
        
        # Main loop
        while True:
            current_time = time.time()
            
            # Handle MQTT if working
            if mqtt_working:
                # Check for new MQTT messages
                mqtt_client.check_msg()
                
                # Send status update every 30 seconds
                if current_time - last_status_time > 30:
                    send_status()
                    last_status_time = current_time
            
            # Handle sensors every 5 seconds
            if current_time - last_sensor_time > 5:
                last_sensor_time = current_time
                
                # Handle CO2 sensor if working
                if co2_sensor_working:
                    try:
                        # Read CO2 sensor data
                        co2, temp, humidity = read_measurement_co2()
                        print(f"\nCO2 Sensor: CO2: {co2} ppm, Temperature: {temp:.2f} °C, Humidity: {humidity:.2f} %")
                        
                        # Format and send CO2 data
                        co2_data = format_co2_data(co2, temp, humidity)
                        send_data_to_server(DEVICE_ID_CO2, co2_data)
                    except Exception as e:
                        print(f"Error reading CO2 sensor: {e}")
                
                # Short delay between sensor readings
                time.sleep(0.5)
                
                # Handle Spectrometer if working
                if spectro_working:
                    try:
                        # Read spectral data
                        print("\nReading spectral data...")
                        spectral_data = read_spectral_data()
                        
                        # Print a simple version of the spectral readings
                        print("Spectral Readings Summary:")
                        print(f"Violet: {spectral_data['F1 (415nm/Violet)']} | Blue: {spectral_data['F3 (480nm/Blue)']} | Green: {spectral_data['F5 (555nm/Green)']}")
                        print(f"Yellow: {spectral_data['F6 (590nm/Yellow)']} | Orange: {spectral_data['F7 (630nm/Orange)']} | Red: {spectral_data['F8 (680nm/Red)']}")
                        print(f"Clear: {spectral_data['Clear']} | NIR: {spectral_data['NIR']}")
                        
                        # Format and send spectral data
                        spectro_data = format_spectral_data(spectral_data)
                        send_data_to_server(DEVICE_ID_SPECTROMETER, spectro_data)
                    except Exception as e:
                        print(f"Error reading spectrometer: {e}")
            
            # Small delay to prevent CPU overload
            time.sleep(0.1)
                
    except KeyboardInterrupt:
        print("\nProgram stopped by user.")
        # Cleanup
        if co2_sensor_working:
            stop_periodic_measurement_co2()
            print("CO2 sensor measurements stopped.")
        if spectro_working:
            # Turn off LED if it was enabled
            enable_led_spectro(False)
            print("Spectrometer shut down.")
    except Exception as e:
        print(f"Unexpected error: {e}")
        machine.reset()  # Reset the Pico W on error

# Run the main function
if __name__ == "__main__":
    main()
