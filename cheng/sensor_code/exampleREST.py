import network
import urequests
import time
import random
import json
from machine import Pin

# Wi-Fi configuration
SSID = "WifiSSID"
PASSWORD = "WifiPassword"

# Server configuration
# SERVER_IP = "192.168.1.8"  # Change to your server's IP address
# SERVER_PORT = 3000
# API_URL = f"http://{SERVER_IP}:{SERVER_PORT}/sensors"
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "test_pico_simulator"

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

def generate_sensor_data():
    """Generate simulated sensor data"""
    # Base values
    temperature_base = 22.0
    humidity_base = 45.0
    air_velocity_base = 1.5
    pressure_base = 1013.25
    light_base = 500
    
    # Add some random variations
    temperature = temperature_base + (random.random() * 4 - 2)  # +/- 2 degrees
    humidity = humidity_base + (random.random() * 10 - 5)  # +/- 5%
    air_velocity = air_velocity_base + (random.random() * 1 - 0.5)  # +/- 0.5 m/s
    pressure = pressure_base + (random.random() * 10 - 5)  # +/- 5 hPa
    light = light_base + (random.random() * 200 - 100)  # +/- 100 lux
    
    # Ensure values are within reasonable ranges
    humidity = max(0, min(100, humidity))
    air_velocity = max(0, air_velocity)
    light = max(0, light)
    
    return {
        "temperature": {
            "value": round(temperature, 1),
            "unit": "C"
        },
        "humidity": {
            "value": round(humidity, 1),
            "unit": "%"
        },
        "air_velocity": {
            "value": round(air_velocity, 2),
            "unit": "m/s"
        },
        "pressure": {
            "value": round(pressure, 2),
            "unit": "hPa"
        },
        "light": {
            "value": round(light),
            "unit": "lux"
        }
    }

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
    
    print("\nSetup complete. Starting data transmission loop...")
    
    # Main loop - send data every second
    while True:
        try:
            # Generate simulated sensor data
            sensor_data = generate_sensor_data()
            
            # Send data to server
            send_data_to_server(sensor_data)
            
            # Wait for next transmission
            time.sleep(1)
            
        except Exception as e:
            print(f"Error in main loop: {e}")
            time.sleep(5)  # Wait before retrying

if __name__ == "__main__":
    main()
