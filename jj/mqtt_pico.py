import network
import time
from simple import MQTTClient

# Wi-Fi Credentials
SSID = "Galaxy"
PASSWORD = "gwla69542"

# MQTT Broker
MQTT_BROKER = "192.168.193.167"
MQTT_PORT = 1883
MQTT_CLIENT_ID = "pico_client"

# WLED Topics (Updated)
MQTT_TOPIC_ON = "wled/508610"
MQTT_TOPIC_COLOR = "wled/508610/col"
MQTT_TOPIC_EFFECT = "wled/508610/api"

# Connect to Wi-Fi
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(SSID, PASSWORD)

print("Connecting to Wi-Fi...")
while not wlan.isconnected():
    time.sleep(1)

print("✅ Connected to Wi-Fi!")
print("🌍 Pico IP Address:", wlan.ifconfig()[0])

# Connect to MQTT Broker
client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
client.connect()
print("✅ Connected to MQTT Broker")

# Turn ON WLED
print("💡 Turning WLED ON...")
client.publish(MQTT_TOPIC_ON, "ON")
time.sleep(1)

# Change Color to BLUE (#0000FF)
print("🎨 Changing WLED Color to #0000FF...")
client.publish(MQTT_TOPIC_COLOR, "#0000FF")
time.sleep(1)

# Set WLED Effect to 3
print("✨ Setting WLED Effect to 3...")
client.publish(MQTT_TOPIC_EFFECT, "FX=3")
time.sleep(1)

print("✅ Commands Sent Successfully!")
