WLED Controller for Raspberry Pi Pico (MicroPython)

This project allows you to control a **WLED** LED strip via an **MQTT Broker** using a **Raspberry Pi Pico W**.  
You can adjust:
- ✅ **Color** (HEX format `#RRGGBB`)
- ✅ **Effects** (0-73)
- ✅ **Brightness** (0-255)
- ✅ **Turn ON/OFF WLED**

---

##**Requirements**
### **Hardware**
- ✅ **Raspberry Pi Pico W**
- ✅ **WS2812 LED Strip (WLED)**
- ✅ **A PC/Laptop with Python installed**
- ✅ **A Wi-Fi Router/Mobile Hotspot** (2.4GHz)

### **📦 Software**

- ✅ **Python 3.x** (for your PC)
- ✅ **MicroPython & `mpremote`** (for Raspberry Pi Pico W)
- ✅ **Mosquitto MQTT Broker** (running on your PC)
- ✅ **Putty** (for Raspberry Pi interaction)

---

## ⚙ **Setup & Installation**
### **1️⃣ Install Required Python Packages on Your PC**
Ensure your PC has Python installed and install `mpremote` for Pico communication:
```bash

pip install mpremote paho-mqtt
Example:

mosquitto -c C:\Users\junji\Desktop\IOT\iot-project-smart-agriculture\mosquitto.conf -v

To Put Wled_controller.py into Pico
### COM10 Is JJ port

python -m mpremote connect COM10 fs cp wled_controller.py :

### Check MQTT Messages
mosquitto_sub -h 192.168.193.167 -t "wled/508610/#" -v
### Turn On Wled
mosquitto_pub -h 192.168.193.167 -t "wled/508610" -m "ON"

### Go to CMD Prompt
python -m mpremote connect COM10
>>> import wled_controller

