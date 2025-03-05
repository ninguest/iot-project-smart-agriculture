import network
import time
from microdot import Microdot, Response  # Import Microdot for REST API


# Replace with your actual Wi-Fi SSID and password
SSID = "Lim Family"
PASSWORD = "Cgack4d5qq"

# Connect to Wi-Fi
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(SSID, PASSWORD)

print("Connecting to Wi-Fi...")
while not wlan.isconnected():
    time.sleep(1)

print("✅ Connected to Wi-Fi!")
print("🌍 Pico IP Address:", wlan.ifconfig()[0])  # Print Pico's IP

# Create a REST API Server
app = Microdot()

@app.post('/control')
def control_command(req):
    req_data = req.json  # Read JSON data from the request
    command = req_data.get("command", "UNKNOWN")  # Handle missing command gracefully

    print(f"🔹 Received Command: {command}")  # Debugging output

    response = {"status": "OK", "message": f"Received command: {command}"}
    return response

# Start REST API Server
app.run(host="0.0.0.0", port=8080, debug=True)
