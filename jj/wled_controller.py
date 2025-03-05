import network
import socket
import time
import json  # Added JSON parsing
from simple import MQTTClient

# Wi-Fi Credentials
SSID = "Galaxy"
PASSWORD = "gwla69542"

# MQTT Broker Info
MQTT_BROKER = "192.168.193.167"
MQTT_PORT = 1883
MQTT_CLIENT_ID = "pico_client"

# WLED Topics
MQTT_TOPIC_ON = "wled/508610"
MQTT_TOPIC_COLOR = "wled/508610/col"
MQTT_TOPIC_EFFECT = "wled/508610/api"
MQTT_TOPIC_BRIGHTNESS = "wled/508610/g"

# 🛜 Connect to Wi-Fi
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    while not wlan.isconnected():
        time.sleep(1)
    print(f"✅ Wi-Fi Connected! Pico IP: {wlan.ifconfig()[0]}")

# 🔌 Connect to MQTT Broker
def connect_mqtt():
    global client
    try:
        client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
        client.connect()
        print("✅ Connected to MQTT Broker")
    except Exception as e:
        print(f"❌ MQTT Connection Failed: {e}")
        time.sleep(5)
        connect_mqtt()

# 🚀 Start HTTP REST API Server
def start_http_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('0.0.0.0', 5000))  # Bind to port 5000
    server_socket.listen(5)
    print("✅ REST API Server Running...")

    while True:
        conn, addr = server_socket.accept()
        request = conn.recv(1024).decode('utf-8')
        print(f"📩 Received Request: {request}")

        # Extract JSON body (if available)
        try:
            request_body = request.split("\r\n\r\n", 1)[-1].strip()
            request_json = json.loads(request_body)
        except:
            request_json = {}

        # Parse HTTP Request
        if "POST /wled/on" in request:
            client.publish(MQTT_TOPIC_ON, "ON")
            response = "HTTP/1.1 200 OK\n\nWLED Turned ON"

        elif "POST /wled/off" in request:
            client.publish(MQTT_TOPIC_ON, "OFF")
            response = "HTTP/1.1 200 OK\n\nWLED Turned OFF"

        elif "POST /wled/color" in request:
            hex_color = request_json.get("color", "").strip()
            if hex_color.startswith("#") and len(hex_color) == 7:
                client.publish(MQTT_TOPIC_COLOR, hex_color)
                response = f"HTTP/1.1 200 OK\n\nWLED Color Set to {hex_color}"
            else:
                response = "HTTP/1.1 400 Bad Request\n\nInvalid Color Format"

        elif "POST /wled/effect" in request:
            effect_id = request_json.get("effect", "").strip()
            if effect_id.isdigit() and 0 <= int(effect_id) <= 73:
                client.publish(MQTT_TOPIC_EFFECT, f"FX={effect_id}")
                response = f"HTTP/1.1 200 OK\n\nEffect Set to {effect_id}"
            else:
                response = "HTTP/1.1 400 Bad Request\n\nInvalid Effect"

        elif "POST /wled/brightness" in request:
            brightness = request_json.get("brightness", "").strip()
            if brightness.isdigit() and 0 <= int(brightness) <= 255:
                client.publish(MQTT_TOPIC_ON, brightness)  # ✅ Send to the correct topic
                response = f"HTTP/1.1 200 OK\n\nBrightness Set to {brightness}"
            else:
                response = "HTTP/1.1 400 Bad Request\n\nInvalid Brightness"



        else:
            response = "HTTP/1.1 404 Not Found\n\nInvalid Endpoint"

        # Send HTTP Response
        conn.send(response.encode())
        conn.close()

# 🔥 Run Everything
connect_wifi()
connect_mqtt()
start_http_server()
