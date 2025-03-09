from machine import Pin, I2C
import time
import struct
import urequests
import network
import json

# Wi-Fi configuration
SSID = "yo"
PASSWORD = "pleasestophacking"

# Server configuration
# SERVER_IP = "192.168.1.8"  # Change to your server's IP address
# SERVER_PORT = 3000
# API_URL = f"http://{SERVER_IP}:{SERVER_PORT}/sensors"
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "Sensirion-SCD41"

# Status LED
led = Pin("LED", Pin.OUT)

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
        
        print(f"Sending data to server: {data}")
        
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

# SCD41 I2C address
SCD41_ADDR = 0x62

# SCD41 Commands
CMD_START_PERIODIC_MEASUREMENT = b'\x21\xB1'
CMD_READ_MEASUREMENT = b'\xEC\x05'
CMD_STOP_PERIODIC_MEASUREMENT = b'\x3F\x86'

# Initialize I2C
i2c = I2C(0, scl=Pin(1), sda=Pin(0), freq=100000)  # Use GPIO 0 and 1 for I2C

def write_command(cmd):
    """Write a command to the SCD41 without data."""
    i2c.writeto(SCD41_ADDR, cmd)

def read_data(cmd, length=9):
    """Read data from the SCD41 after sending a command."""
    write_command(cmd)
    time.sleep(0.1)  # Give the sensor time to process
    return i2c.readfrom(SCD41_ADDR, length)

def start_periodic_measurement():
    """Start periodic measurement."""
    write_command(CMD_START_PERIODIC_MEASUREMENT)
    time.sleep(5)  # Wait for the first measurement to be ready

def stop_periodic_measurement():
    """Stop periodic measurement."""
    write_command(CMD_STOP_PERIODIC_MEASUREMENT)
    time.sleep(0.5)  # Give the sensor time to stop

def read_measurement():
    """Read CO2, temperature, and humidity from SCD41."""
    data = read_data(CMD_READ_MEASUREMENT)
    
    # Parse the results (CO2, temperature, humidity)
    co2 = data[0] << 8 | data[1]
    temp = -45 + 175 * ((data[3] << 8 | data[4]) / 65535.0)
    humidity = 100 * ((data[6] << 8 | data[7]) / 65535.0)
    
    return co2, temp, humidity

def format_sensor_data(co2, temperature, humidity):
    """Format sensor data for API submission"""
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

def main():
    print("\n========================================")
    print("Starting Pico W Sensor Data Simulator")
    print("Sending data to server every 1 second")
    print("========================================\n")

    # Blink LED to indicate program start
    for _ in range(3):
        led.on()
        time.sleep(0.2)
        led.off()
        time.sleep(0.2)

    if not connect_wifi():
        print("Failed to connect to Wi-Fi. Exiting...")
        # Error indication - 3 slow blinks
        for _ in range(3):
            led.on()
            time.sleep(0.5)
            led.off()
            time.sleep(0.5)
        return
    
    print("\nSetup complete. Starting data transmission loop...")

    # Scan I2C bus to verify SCD41 is connected
    devices = i2c.scan()
    if SCD41_ADDR not in devices:
        print(f"SCD41 not found! Devices found: {[hex(d) for d in devices]}")
        return
    
    print("SCD41 detected, starting measurements...")
    
    try:
        # Start periodic measurement
        start_periodic_measurement()
        
        print("\nSetup complete. Starting data transmission loop...")
        
        # Main loop - read and send data every 5 seconds
        while True:
            try:
                # Read sensor data
                co2, temp, humidity = read_measurement()
                print(f"CO2: {co2} ppm, Temperature: {temp:.2f} °C, Humidity: {humidity:.2f} %")
                
                # Format sensor data
                sensor_data = format_sensor_data(co2, temp, humidity)
                
                # Send data to server
                send_data_to_server(sensor_data)
                
                # Wait before next reading
                time.sleep(5)
                
            except Exception as e:
                print(f"Error in measurement loop: {e}")
                time.sleep(2)  # Short delay before retrying
                
    except KeyboardInterrupt:
        # Stop measurement when user interrupts
        stop_periodic_measurement()
        print("Measurements stopped.")
    
if __name__ == "__main__":
    main()