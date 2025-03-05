import network
import time
from simple import MQTTClient  # MicroPython-compatible MQTT library

# Wi-Fi Credentials
SSID = "Galaxy"
PASSWORD = "gwla69542"

# MQTT Broker
MQTT_BROKER = "192.168.193.167"
MQTT_PORT = 1883
MQTT_CLIENT_ID = "pico_client"

# WLED Topics
MQTT_TOPIC_COLOR = "wled/508610/col"  # Color control
MQTT_TOPIC_EFFECT = "wled/508610/api"  # Effect control
MQTT_TOPIC_BRIGHTNESS = "wled/508610"  # Brightness control
MQTT_TOPIC_ON = "wled/508610"  # ON/OFF control

client = None  # Define the MQTT client globally

def connect_wifi():
    """Ensure Wi-Fi stays connected."""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("📶 Reconnecting to Wi-Fi...")
        wlan.connect(SSID, PASSWORD)
        while not wlan.isconnected():
            time.sleep(1)
    print(f"✅ Wi-Fi Connected! Pico IP: {wlan.ifconfig()[0]}")

def connect_mqtt():
    """Ensure MQTT stays connected."""
    global client
    try:
        if client:
            client.disconnect()  # Ensure any previous connection is properly closed
            time.sleep(2)  # Allow some delay before reconnecting
        client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, MQTT_PORT)
        client.connect()
        print("✅ Connected to MQTT Broker")
    except Exception as e:
        print(f"❌ MQTT Connection Failed: {e}")
        time.sleep(5)
        connect_mqtt()  # Retry MQTT connection

def disconnect_mqtt():
    """Gracefully disconnect from MQTT broker."""
    global client
    if client:
        print("🔌 Disconnecting from MQTT Broker...")
        try:
            client.disconnect()
            print("✅ Disconnected successfully.")
        except Exception as e:
            print(f"⚠️ Error disconnecting: {e}")

def change_color():
    """Prompt user for color and send it via MQTT."""
    color = input("🎨 Enter HEX Color (e.g., #FF0000 for RED): ").strip()
    if color.startswith("#") and len(color) in (7, 9):  # Ensure valid HEX format
        client.publish(MQTT_TOPIC_COLOR, color)
        print(f"✅ WLED Color changed to {color}")
    else:
        print("⚠️ Invalid color format! Use #RRGGBB or #WWRRGGBB.")

def change_effect():
    """Prompt user for effect number and send it via MQTT."""
    try:
        effect = int(input("✨ Enter Effect Number (0-73): ").strip())
        if 0 <= effect <= 73:
            client.publish(MQTT_TOPIC_EFFECT, f"FX={effect}")
            print(f"✅ WLED Effect set to {effect}")
        else:
            print("⚠️ Invalid effect number! Must be between 0 and 73.")
    except ValueError:
        print("⚠️ Please enter a valid number.")

def change_brightness():
    """Prompt user for brightness level (0-255) and send it via MQTT."""
    try:
        brightness = int(input("💡 Enter Brightness (0-255): ").strip())
        if 0 <= brightness <= 255:
            client.publish(MQTT_TOPIC_BRIGHTNESS, str(brightness))  # Using main topic
            print(f"✅ WLED Brightness set to {brightness}")
        else:
            print("⚠️ Invalid brightness value! Must be between 0 and 255.")
    except ValueError:
        print("⚠️ Please enter a valid number.")

def main():
    """Main interactive menu loop."""
    connect_wifi()
    connect_mqtt()

    while True:
        print("\n WLED Controller Menu:")
        print("1 Change Color")
        print("2 Select Effect")
        print("3 Adjust Brightness")
        print("4 Exit")
        choice = input(" Enter choice: ").strip()

        if choice == "1":
            change_color()
        elif choice == "2":
            change_effect()
        elif choice == "3":
            change_brightness()
        elif choice == "4":
            disconnect_mqtt()
            print("👋 Exiting WLED Controller...")
            break
        else:
            print("⚠️ Invalid choice! Please enter 1, 2, 3, or 4.")

# Run the script
main()
