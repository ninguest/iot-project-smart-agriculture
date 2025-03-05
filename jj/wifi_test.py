import network
import time

SSID = "Galaxy"  # Your hotspot SSID
PASSWORD = "gwla69542"  # Your hotspot password

# Initialize Wi-Fi
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(SSID, PASSWORD)

print("📡 Connecting to Wi-Fi...")

timeout = 10  # 10-second timeout
while not wlan.isconnected() and timeout > 0:
    time.sleep(1)
    timeout -= 1
    print(f"⏳ Waiting for Wi-Fi... {timeout}s left")

if wlan.isconnected():
    print(f"✅ Connected to {SSID} | IP: {wlan.ifconfig()[0]}")
else:
    print("❌ Wi-Fi Connection Failed! Check SSID/PASSWORD or Hotspot Settings.")
