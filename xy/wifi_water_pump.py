import network
import urequests
import time
import json
from machine import Pin, PWM, ADC

# Wi-Fi Configuration
SSID = "YourSSID"
PASSWORD = "YourPassword"

# Server Configuration
API_URL = "https://iot.ycstation.work/sensors"
DEVICE_ID = "pico_irrigation_system"

# Define Pins
moisture_sensor = ADC(28)  # Soil moisture sensor connected to GP28
in1 = Pin(3, Pin.OUT)      # Motor driver IN1
in2 = Pin(4, Pin.OUT)      # Motor driver IN2
pwm = PWM(Pin(2))          # PWM for motor control
pwm.freq(1000)             # Set PWM frequency

# Moisture Threshold
MOISTURE_THRESHOLD = 40  # Adjust based on your soil and sensor readings

def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    print(f"Connecting to {SSID}...")
    wlan.connect(SSID, PASSWORD)
    
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
        return True

def get_moisture_level():
    raw_value = moisture_sensor.read_u16()
    moisture_percentage = round(100 - ((raw_value / 65535) * 100), 2)
    return moisture_percentage

def pump_on():
    in1.value(1)
    in2.value(0)
    pwm.duty_u16(65535)
    print("Pump ON")

def pump_off():
    in1.value(0)
    in2.value(0)
    pwm.duty_u16(0)
    print("Pump OFF")

def send_data_to_server(moisture, pump_status):
    try:
        data = {
            "device_id": DEVICE_ID,
            "sensors": {
                "moisture": {
                    "value": moisture,
                    "unit": "%"
                },
                "pump_status": pump_status
            }
        }
        
        print(f"Sending data to server: {data}")
        response = urequests.post(
            API_URL,
            data=json.dumps(data),
            headers={"Content-Type": "application/json"}
        )
        print(f"Server response: {response.status_code}")
        response.close()
    except Exception as e:
        print(f"Error sending data: {e}")

def check_moisture_and_control_pump():
    moisture = get_moisture_level()
    print(f"Moisture Level: {moisture}%")
    
    if moisture < MOISTURE_THRESHOLD:
        print("Soil is dry, activating pump...")
        pump_on()
        send_data_to_server(moisture, "ON")
        while get_moisture_level() < MOISTURE_THRESHOLD:
            time.sleep(10)
        print("Soil is sufficiently moist, turning pump off.")
        pump_off()
        send_data_to_server(get_moisture_level(), "OFF")
    else:
        print("Soil is moist, no need to water.")
        send_data_to_server(moisture, "OFF")

# Main Program
if connect_wifi():
    while True:
        check_moisture_and_control_pump()
        print("Waiting 30 minutes before next check...\n")
        time.sleep(1800)  # Wait 30 minutes