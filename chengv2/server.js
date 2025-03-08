// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');

// Create Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set up middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store most recent data from each device
const deviceData = {};
// Store historical data (limited to last 100 readings for each device)
const historicalData = {};
// Store device connection status
const connectedDevices = {};

// Route to serve the main dashboard page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to receive sensor data from the Pico W
app.post('/sensors', (req, res) => {
  try {
    const data = req.body;
    
    if (!data || !data.device_id || !data.sensors) {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    const deviceId = data.device_id;
    const timestamp = new Date().toISOString();
    
    // Add timestamp to the data
    const dataWithTimestamp = {
      ...data,
      timestamp
    };
    
    // Update most recent data for this device
    deviceData[deviceId] = dataWithTimestamp;
    
    // Initialize historical data array for this device if it doesn't exist
    if (!historicalData[deviceId]) {
      historicalData[deviceId] = [];
    }
    
    // Add to historical data, limiting to 100 readings
    historicalData[deviceId].push(dataWithTimestamp);
    if (historicalData[deviceId].length > 100) {
      historicalData[deviceId].shift(); // Remove oldest reading
    }
    
    // Update device connection status and timestamp
    connectedDevices[deviceId] = {
      lastSeen: timestamp,
      status: 'online'
    };
    
    // Emit updated data to all connected clients
    io.emit('sensorUpdate', { 
      deviceId,
      data: dataWithTimestamp
    });
    
    // Also emit the complete current state to keep clients in sync
    io.emit('deviceStatus', connectedDevices);
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing sensor data:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// API endpoints to get data
app.get('/api/devices', (req, res) => {
  res.json(Object.keys(deviceData));
});

app.get('/api/current/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  if (deviceData[deviceId]) {
    res.json(deviceData[deviceId]);
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

app.get('/api/history/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  if (historicalData[deviceId]) {
    res.json(historicalData[deviceId]);
  } else {
    res.status(404).json({ error: 'Device history not found' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected');
  
  // Send the current state to the newly connected client
  socket.emit('initialData', deviceData);
  socket.emit('deviceStatus', connectedDevices);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
  
  // Handle client requesting historical data
  socket.on('getHistoricalData', (deviceId) => {
    if (historicalData[deviceId]) {
      socket.emit('historicalData', {
        deviceId,
        data: historicalData[deviceId]
      });
    }
  });
});

// Check for inactive devices every minute
setInterval(() => {
  const now = new Date();
  
  Object.keys(connectedDevices).forEach(deviceId => {
    const device = connectedDevices[deviceId];
    const lastSeen = new Date(device.lastSeen);
    const diffMinutes = (now - lastSeen) / (1000 * 60);
    
    // If not seen in the last 2 minutes, mark as offline
    if (diffMinutes > 2 && device.status !== 'offline') {
      connectedDevices[deviceId] = {
        ...device,
        status: 'offline'
      };
      
      // Emit status update
      io.emit('deviceStatus', connectedDevices);
    }
  });
}, 60000);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});
