# Pico W Multi-Sensor Monitoring System

A complete system for monitoring and visualizing environmental data using a Raspberry Pi Pico W with FS3000 air velocity sensor and SCD41 temperature/humidity sensor.

## Overview

This project consists of two main components:

1. **Pico W Firmware**: MicroPython code running on a Raspberry Pi Pico W that reads data from connected sensors and sends it to a server.
2. **Web Server**: Node.js Express server that receives, stores, and visualizes the sensor data.

The system provides real-time monitoring of:
- Air velocity (m/s) from the FS3000 sensor
- Temperature (°C) and humidity (%) from the SCD41 sensor

## Hardware Requirements

- Raspberry Pi Pico W
- FS3000 Air Velocity Sensor
- SCD41 Environmental Sensor (Temperature/Humidity/CO2)
- Breadboard and jumper wires
- USB power supply or battery pack for Pico W

## Hardware Setup

### Connection Diagram

Connect the sensors to the Pico W using I2C:

**I2C Pins:**
- SDA: GP4 (Pin 6)
- SCL: GP5 (Pin 7)

**FS3000 Connections:**
- VCC → 3.3V
- GND → GND
- SDA → GP4
- SCL → GP5

**SCD41 Connections:**
- VCC → 3.3V
- GND → GND
- SDA → GP4
- SCL → GP5

## Pico W Firmware

### Features
- Reads from FS3000 air velocity sensor
- Reads temperature and humidity from SCD41 sensor
- Sends data to a web server via HTTP POST requests
- Automatic error recovery and reconnection
- Diagnostic tools for sensor troubleshooting

### Setup

1. Install Thonny IDE and MicroPython on your Pico W
2. Copy the `main.py` file to your Pico W
3. Update the Wi-Fi credentials and server address in the code:

```python
# Wi-Fi configuration
SSID = "YourWiFiName"
PASSWORD = "YourWiFiPassword"
API_URL = "http://your-server-ip:3000/sensors"
```

### Automatic Startup

The Pico W will automatically run the code when powered on since it's saved as `main.py`.

## Server Setup

### Requirements
- Node.js (v12 or higher)
- npm (Node Package Manager)

### Installation

1. Create a project directory and navigate to it:
```
mkdir sensor-server
cd sensor-server
```

2. Initialize the Node.js project:
```
npm init -y
npm install express body-parser
```

3. Create the directory structure:
```
mkdir public
```

4. Create the server file (`server.js`) with the provided server code
5. Create the dashboard file (`public/index.html`) with the provided HTML code

### Running the Server

```
node server.js
```

The server will start on port 3000. Access the dashboard by navigating to:
```
http://your-server-ip:3000
```

### Data Storage

Sensor data is stored in memory and periodically saved to a file (`sensor_data.json`).

## Troubleshooting

### Sensor Issues

If the SCD41 sensor shows problematic readings:

1. Check physical connections
2. Use the diagnostic functions provided in the code
3. Try resetting the sensor using the factory reset function
4. If CO2 readings are consistently 0, the CO2 sensing element may be defective, but temperature and humidity can still be used

### Server Issues

If you encounter the error `sensorData.push is not a function`:

1. Delete the existing `sensor_data.json` file
2. Restart the server

## Known Limitations

- The SCD41 CO2 sensor might report 0 ppm if the CO2 sensing element is defective
- Web dashboard requires manual page refresh in some browsers if left open for extended periods

## Future Improvements

- Add alert notifications for extreme values
- Implement user authentication for the dashboard
- Add support for more sensor types
- Create mobile app for monitoring

## License

This project is open source and available under the MIT License.