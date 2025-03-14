import network
import time
import json
import random
from umqtt.simple import MQTTClient
import machine
from machine import Pin

# Configure your WiFi credentials
WIFI_SSID = "Galaxy"
WIFI_PASSWORD = "gwla69542"

# MQTT Configuration
MQTT_BROKER = "broker.emqx.io"
MQTT_PORT = 1883
MQTT_CLIENT_ID = f"pico_w_{random.randint(0, 1000000)}"
DEVICE_ID = "pico_test_device"
MQTT_TOPIC_PREFIX = "ycstation/devices/"

# Commands topic (to receive commands)
COMMANDS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/commands"
BROADCAST_TOPIC = f"{MQTT_TOPIC_PREFIX}all/commands"
STATUS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/status"
ACK_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/ack"

# WLED Topics
WLED_TOPIC_ON = "wled/508610"
WLED_TOPIC_COLOR = "wled/508610/col"
WLED_TOPIC_EFFECT = "wled/508610/api"
WLED_TOPIC_BRIGHTNESS = "wled/508610/g"

# Onboard LED
led = machine.Pin("LED", machine.Pin.OUT)

# 🌐 Connect to Wi-Fi
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    print(f"🔗 Connecting to WiFi: {WIFI_SSID}")
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)

        # Wait for connection with timeout
        max_wait = 20
        while max_wait > 0:
            if wlan.isconnected():
                break
            max_wait -= 1
            print("⌛ Waiting for connection...")
            time.sleep(1)

    if wlan.isconnected():
        print("✅ WiFi Connected! IP:", wlan.ifconfig()[0])
        return True
    else:
        print("❌ WiFi connection failed!")
        return False

# 📩 MQTT Callback (Handles Incoming Messages)
def mqtt_callback(topic, msg):
    print(f"📨 Received message on {topic}: {msg}")

    try:
        topic_str = topic.decode('utf-8')
        msg_str = msg.decode('utf-8')
        command = json.loads(msg_str)

        if topic_str in [COMMANDS_TOPIC, BROADCAST_TOPIC]:
            process_command(command)
    except Exception as e:
        print(f"⚠️ Error processing message: {e}")

# 🛠 Process Commands
def process_command(command):
    command_id = command.get('id', 'unknown')
    component = command.get('component', '')
    action = command.get('action', '')
    value = command.get('value', '')

    print(f"🔧 Processing command: {component}.{action}={value}")
    success = False
    message = "Unknown command"

    

    if component == "led":
        success, message = process_wled_command(action, value)

    send_ack(command_id, success, message)

# 🎨 Process WLED Commands (Power, Color, Brightness, Effects)
def process_wled_command(action, value):
    global client  # Ensure MQTT client is accessible

    try:
        if action == "power":
            payload = "ON" if value == "on" else "OFF"
            print(f"🟢 Sending WLED Power: {payload} → {WLED_TOPIC_ON}")
            client.publish(WLED_TOPIC_ON, payload)
            return True, f"WLED Turned {value.upper()}"

        elif action == "color":
            if isinstance(value, str) and value.startswith("#"):
                print(f"🎨 Sending WLED Color: {value} → {WLED_TOPIC_COLOR}")
                client.publish(WLED_TOPIC_COLOR, value)
                return True, f"WLED Color Set: {value}"
            return False, "Invalid color format. Use HEX like #FF0000."

        elif action == "brightness":
            brightness = int(value)
            if 0 <= brightness <= 255:
                payload = json.dumps({"bri": brightness})  # JSON format required!
                print(f"💡 Sending WLED Brightness: {payload} → {WLED_TOPIC_EFFECT}")
                client.publish(WLED_TOPIC_EFFECT, payload)  # Use `wled/508610/api`
                return True, f"WLED Brightness Set: {brightness}"
            return False, "Brightness must be between 0-255."


    except Exception as e:
        print(f"⚠️ WLED Command Error: {e}")
        return False, "Error processing WLED command"

    return False, "Invalid WLED command"

# ✅ Send Acknowledgment
def send_ack(command_id, success, message):
    ack = {
        'command_id': command_id,
        'success': success,
        'message': message,
        'timestamp': time.time()
    }
    try:
        client.publish(ACK_TOPIC, json.dumps(ack))
        print(f"📩 Acknowledgment sent: {success}, {message}")
    except Exception as e:
        print(f"⚠️ Error sending acknowledgment: {e}")

# 📡 Send Device Status Update
def send_status():
    status = {
        'device_id': DEVICE_ID,
        'status': 'online',
        'capabilities': ['led', 'wled'],
        'components': {
            'led': {'power': 'on' if led.value() else 'off'},
            'wled': {'status': 'connected'}
        },
        'timestamp': time.time()
    }
    try:
        client.publish(STATUS_TOPIC, json.dumps(status))
        print("📡 Status update sent")
    except Exception as e:
        print(f"⚠️ Error sending status: {e}")

# 🚀 Main Function
def main():
    global client

    if not connect_wifi():
        return

    try:
        client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
        client.set_callback(mqtt_callback)
        client.connect()
        print(f"✅ Connected to MQTT broker: {MQTT_BROKER}")

        client.subscribe(COMMANDS_TOPIC)
        client.subscribe(BROADCAST_TOPIC)

        send_status()

        while True:
            client.check_msg()
            time.sleep(0.1)

    except Exception as e:
        print(f"⚠️ MQTT error: {e}")
        machine.reset()

# 🔥 Run the Main Function
if __name__ == "__main__":
    main()

