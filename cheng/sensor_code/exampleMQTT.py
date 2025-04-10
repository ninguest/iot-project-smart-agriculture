import network
import time
import json
import random
from umqtt.simple import MQTTClient
import machine
from machine import Pin

# Configure your WiFi credentials
WIFI_SSID = "yo"
WIFI_PASSWORD = "pleasestophacking"

gp15 = Pin(15, Pin.OUT)

# MQTT Configuration
MQTT_BROKER = "broker.emqx.io"
MQTT_PORT = 1883
MQTT_CLIENT_ID = f"pico_w_{random.randint(0, 1000000)}"
DEVICE_ID = "pico_test_device"  # A unique ID for your device
MQTT_TOPIC_PREFIX = "ycstation/devices/"  # Same as in your server

# Commands topic (to receive commands)
COMMANDS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/commands"
# Broadcast topic (to receive broadcast commands)
BROADCAST_TOPIC = f"{MQTT_TOPIC_PREFIX}all/commands"
# Status topic (to publish device status)
STATUS_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/status"
# Acknowledgment topic (to confirm commands)
ACK_TOPIC = f"{MQTT_TOPIC_PREFIX}{DEVICE_ID}/ack"

# Onboard LED
led = machine.Pin("LED", machine.Pin.OUT)

# Initialize WiFi
def connect_wifi():
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
    
    # Handle LED commands (we'll use 'led' as the component name)
    if component == 'led':
        if action == 'power':
            if value == 'on':
                gp15.value(1)
                success = True
                message = "LED turned on"
            elif value == 'off':
                gp15.value(0)
                success = True
                message = "LED turned off"
    
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
        client.publish(ACK_TOPIC, json.dumps(ack))
        print(f"Acknowledgment sent: {success}, {message}")
    except Exception as e:
        print(f"Error sending acknowledgment: {e}")

# Send device status update
def send_status():
    status = {
        'device_id': DEVICE_ID,
        'status': 'online',
        'capabilities': ['led'],
        'components': {
            'led': {
                'power': 'on' if led.value() else 'off'
            }
        },
        'timestamp': time.time()
    }
    try:
        client.publish(STATUS_TOPIC, json.dumps(status))
        print("Status update sent")
    except Exception as e:
        print(f"Error sending status: {e}")

# Main function
def main():
    global client
    
    # Connect to WiFi
    if not connect_wifi():
        return
    
    # Set up MQTT client
    try:
        client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
        client.set_callback(mqtt_callback)
        client.connect()
        print(f"Connected to MQTT broker: {MQTT_BROKER}")
        
        # Subscribe to device-specific commands topic
        client.subscribe(COMMANDS_TOPIC)
        print(f"Subscribed to device commands: {COMMANDS_TOPIC}")
        
        # Subscribe to broadcast commands topic
        client.subscribe(BROADCAST_TOPIC)
        print(f"Subscribed to broadcast commands: {BROADCAST_TOPIC}")
        
        # Send initial status
        send_status()
        
        # Main loop
        last_status_time = time.time()
        
        while True:
            # Check for new messages
            client.check_msg()
            
            # Send status update every 30 seconds
            current_time = time.time()
            if current_time - last_status_time > 30:
                send_status()
                last_status_time = current_time
            
            # Small delay to prevent CPU overload
            time.sleep(0.1)
            
    except Exception as e:
        print(f"MQTT error: {e}")
        machine.reset()  # Reset the Pico W on error

# Run the main function
if __name__ == "__main__":
    main()
