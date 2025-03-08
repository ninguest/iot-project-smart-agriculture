# Sensor Dashboard

A real-time dashboard for monitoring sensor data from Raspberry Pi Pico W devices.

## Features

- Real-time sensor data visualization via Socket.IO
- Responsive UI design that works on desktop and mobile devices
- Historical data display with customizable time ranges
- Automatic detection of different sensor types
- Status tracking of connected devices
- Expandable to handle any number and type of sensors

## Project Structure

```
sensor-dashboard/
├── server.js                # Express server and API endpoints
├── package.json             # Project dependencies
├── public/                  # Client-side files
│   ├── index.html           # Main dashboard HTML
│   ├── styles.css           # Dashboard styling
│   └── app.js               # Client-side JavaScript
└── README.md                # This file
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Installation

1. Clone this repository or download the files
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory
   ```
   cd sensor-dashboard
   ```

3. Install dependencies
   ```
   npm install
   ```

4. Start the server
   ```
   npm start
   ```

5. Access the dashboard
   ```
   http://localhost:3000
   ```

## Configuration

The server listens on port 3000 by default. You can change this by setting the `PORT` environment variable:

```
PORT=8080 npm start
```

## API Endpoints

### POST /sensors
Endpoint for devices to send sensor data.

**Request Body Example:**
```json
{
  "device_id": "pico_with_naughty_sensor",
  "sensors": {
    "air_velocity": {
      "value": 2.45,
      "unit": "m/s"
    },
    "temperature": {
      "value": 22.5,
      "unit": "C"
    },
    "humidity": {
      "value": 45.2,
      "unit": "%"
    }
  }
}
```

### GET /api/devices
Returns a list of all device IDs that have sent data.

### GET /api/current/:deviceId
Returns the most recent data for a specific device.

### GET /api/history/:deviceId
Returns historical data for a specific device (limited to 100 most recent readings).

## Raspberry Pi Pico W Setup

The Raspberry Pi Pico W should POST sensor data to the `/sensors` endpoint in the format shown above. The server is designed to accept any sensor types, not just those shown in the example.

## Adding New Sensor Types

The dashboard is designed to automatically detect and display new sensor types without any code changes. When a device sends data with new sensor types, the dashboard will create new tiles and chart options for them.

## Troubleshooting

- **No devices showing up?** Make sure your Raspberry Pi Pico W is correctly posting data to the `/sensors` endpoint.
- **Chart not updating?** Check your browser console for any errors.
- **Server won't start?** Make sure port 3000 (or your custom port) is not in use by another application.

## License

This project is licensed under the MIT License.
