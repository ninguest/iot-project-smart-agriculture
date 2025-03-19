import network
import urequests
import time
import json
from machine import Pin, ADC

# Wi-Fi configuration
SSID = "yo"
PASSWORD = "pleasestophacking"

# Server configuration
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "moisture_sensor_pico"

# Status LED
led = Pin("LED", Pin.OUT)

# Set up moisture sensor on ADC pin (GPIO26/ADC0)
moisture_sensor = ADC(26)

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

def read_moisture():
    """Read moisture sensor data"""
    # Read analog value (0-65535)
    raw_value = moisture_sensor.read_u16()
    
    # Convert to percentage (adjust min/max as needed for your sensor)
    # Most soil moisture sensors read lower values when soil is wet
    # You may need to calibrate these values for your specific sensor
    moisture_min = 0      # Adjust based on your sensor's dry reading
    moisture_max = 65535  # Adjust based on your sensor's wet reading
    
    # Invert the percentage calculation if needed
    # Some sensors give high readings when wet, others when dry
    moisture_percentage = 100 - (((raw_value - moisture_min) / (moisture_max - moisture_min)) * 100)
    
    # Ensure value is within 0-100 range
    moisture_percentage = max(0, min(100, moisture_percentage))
    
    return {
        "moisture_raw": {
            "value": raw_value,
            "unit": "raw"
        },
        "moisture": {
            "value": round(moisture_percentage, 1),
            "unit": "%"
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
    print("Starting Pico W Moisture Sensor Monitor")
    print("Sending data to server every 1 seconds")
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
    
    # Main loop - send data every 5 seconds
    while True:
        try:
            # Read moisture sensor data
            sensor_data = read_moisture()
            
            # Print data to console
            raw = sensor_data["moisture_raw"]["value"]
            percentage = sensor_data["moisture"]["value"]
            print(f"Raw Value: {raw}, Moisture: {percentage}%")
            
            # Send data to server
            send_data_to_server(sensor_data)
            
            # Wait for next transmission
            time.sleep(1)
            
        except Exception as e:
            print(f"Error in main loop: {e}")
            time.sleep(5)  # Wait before retrying

if __name__ == "__main__":
    main()
