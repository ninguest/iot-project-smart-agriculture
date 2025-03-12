// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const lockfile = require('proper-lockfile'); // For file locking
const { getRedisClient } = require('./redisClient');
const { 
  saveToRedis, 
  getLatestDeviceData, 
  getHistoricalDeviceData, 
  getDateRangeData 
} = require('./redisSensorData');
const {
  initPicoWebSocketServer,
  sendCommand,
  broadcastCommand,
  getConnectedPicoDevices
} = require('./picoWebsocket');

// Create Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Initialize WebSocket server for Pico W devices
const picoWss = initPicoWebSocketServer(server);

// Set up middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

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

// Function to load historical data from log files
function loadHistoricalData() {
  try {
    // Get list of device folders in logs directory
    const deviceFolders = fs.readdirSync(logsDir);
    
    deviceFolders.forEach(deviceId => {
      const devicePath = path.join(logsDir, deviceId);
      
      // Make sure it's a directory
      if (fs.statSync(devicePath).isDirectory()) {
        // Get the latest log file for this device
        const logFiles = fs.readdirSync(devicePath)
          .filter(file => file.endsWith('.json'))
          .sort(); // Sort to get the latest file
          
        if (logFiles.length > 0) {
          const latestLogFile = logFiles[logFiles.length - 1];
          try{
            const logData = JSON.parse(fs.readFileSync(path.join(devicePath, latestLogFile), 'utf8'));

            // Initialize historicalData for this device
            historicalData[deviceId] = logData.slice(-100); // Limit to last 100 readings

            // Set the most recent data for this device
            if (logData.length > 0) {
              deviceData[deviceId] = logData[logData.length - 1];
              
              // Update connection status based on the timestamp of the last entry
              const lastSeen = new Date(deviceData[deviceId].timestamp);
              const now = new Date();
              const diffMinutes = (now - lastSeen) / (1000 * 60);
              
              connectedDevices[deviceId] = {
                lastSeen: deviceData[deviceId].timestamp,
                status: diffMinutes <= 2 ? 'online' : 'offline'
              };
            }

          } catch (error) {
            console.error(`Error parsing log file for device ${deviceId}:`, error);
            // Create empty arrays to avoid further errors
            historicalData[deviceId] = [];
          }
          
        }
      }
    });
    
    console.log(`Loaded historical data for ${Object.keys(historicalData).length} devices`);
  } catch (error) {
    console.error('Error loading historical data:', error);
  }
}

// Function to save data to log file
// Function to save data to log file
function saveToLogFile(deviceId, data) {
  try {
    // Create device directory if it doesn't exist
    const deviceDir = path.join(logsDir, deviceId);
    if (!fs.existsSync(deviceDir)) {
      fs.mkdirSync(deviceDir);
    }
    
    // Get current date for file naming
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    const logFilePath = path.join(deviceDir, `${dateStr}.json`);
    
    // Create the file if it doesn't exist
    if (!fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, '[]');
    }
    
    // Acquire lock, read, modify, write, release lock
    lockfile.lock(logFilePath, { retries: 5 })
      .then(release => {
        // Read existing data
        let logData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
        
        // Add new data
        logData.push(data);
        
        // Write back to file
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2));
        
        // Release the lock
        return release();
      })
      .then(() => {
        console.log(`Saved data for device ${deviceId} to ${logFilePath}`);
      })
      .catch(error => {
        console.error(`Error acquiring lock for ${logFilePath}:`, error);
      });
  } catch (error) {
    console.error(`Error saving log for device ${deviceId}:`, error);
  }
}

// Data retention - clean up old log files (older than 30 days)
function cleanupOldLogs() {
  try {
    console.log('Starting cleanup of old log files...');
    
    const now = new Date();
    const maxAge = 30; // days to keep logs
    
    // Get list of device folders
    const deviceFolders = fs.readdirSync(logsDir);
    
    deviceFolders.forEach(deviceId => {
      const devicePath = path.join(logsDir, deviceId);
      
      // Make sure it's a directory
      if (fs.statSync(devicePath).isDirectory()) {
        const logFiles = fs.readdirSync(devicePath)
          .filter(file => file.endsWith('.json'));
          
        logFiles.forEach(file => {
          // Extract date from filename (assuming YYYY-MM-DD.json format)
          const dateStr = file.replace('.json', '');
          const fileDate = new Date(dateStr);
          
          if (!isNaN(fileDate.getTime())) {
            // Calculate age in days
            const ageInDays = (now - fileDate) / (1000 * 60 * 60 * 24);
            
            if (ageInDays > maxAge) {
              // Delete old file
              fs.unlinkSync(path.join(devicePath, file));
              console.log(`Deleted old log file: ${deviceId}/${file}`);
            }
          }
        });
      }
    });
    
    console.log('Log cleanup completed');
  } catch (error) {
    console.error('Error during log cleanup:', error);
  }
}

// API endpoint to receive sensor data from the Pico W
app.post('/sensors', async (req, res) => {
  try {
    const data = req.body;
    
    if (!data || !data.device_id || !data.sensors) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    // Validate sensor data structure
    for (const sensor in data.sensors) {
      const sensorData = data.sensors[sensor];
      if (!sensorData.hasOwnProperty('value') || !sensorData.hasOwnProperty('unit')) {
        return res.status(400).json({ 
          error: `Invalid sensor data format for sensor: ${sensor}. Each sensor must have 'value' and 'unit' properties.` 
        });
      }
      
      // Check if sensor value is a number
      if (isNaN(parseFloat(sensorData.value))) {
        return res.status(400).json({ 
          error: `Invalid sensor value for sensor: ${sensor}. Value must be a number.` 
        });
      }
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

    // Save to Redis
    await saveToRedis(deviceId, dataWithTimestamp);
    
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

// API endpoint to get historical data by date range
app.get('/api/history/:deviceId/:startDate/:endDate', (req, res) => {
  try {
    const { deviceId, startDate, endDate } = req.params;
    
    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    
    // Generate list of dates between start and end (inclusive)
    const dateList = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      dateList.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Read log files for each date
    const deviceDir = path.join(logsDir, deviceId);
    if (!fs.existsSync(deviceDir)) {
      return res.status(404).json({ error: 'No data found for this device' });
    }
    
    let combinedData = [];
    dateList.forEach(date => {
      const logFilePath = path.join(deviceDir, `${date}.json`);
      if (fs.existsSync(logFilePath)) {
        const logData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
        combinedData = [...combinedData, ...logData];
      }
    });
    
    // Sort data by timestamp
    combinedData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    res.json(combinedData);
  } catch (error) {
    console.error('Error retrieving historical data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updateMe', (req, res) => {
  exec("/home/nin/server/iot-project-smart-agriculture/update.sh", (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
    console.error(`stderr: ${stderr}`);
  });
  res.status(200).json({ success: true, message: 'Updating...' });
})

// Get all Pico W devices with their capabilities
app.get('/api/pico-devices', (req, res) => {
  const devices = getConnectedPicoDevices();
  res.json(devices);
});

// Send command to a specific device
app.post('/api/command/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { component, action, value } = req.body;
  
  if (!component || !action) {
    return res.status(400).json({ error: 'Missing required parameters: component and action' });
  }
  
  const success = sendCommand(deviceId, component, action, value);
  
  if (success) {
    res.json({ success: true, message: `Command sent to device ${deviceId}` });
  } else {
    res.status(404).json({ success: false, error: `Failed to send command to device ${deviceId}` });
  }
});

// Broadcast command to all devices with a specific capability
app.post('/api/broadcast', (req, res) => {
  const { component, action, value } = req.body;
  
  if (!component || !action) {
    return res.status(400).json({ error: 'Missing required parameters: component and action' });
  }
  
  const targetDevices = broadcastCommand(component, action, value);
  
  res.json({ 
    success: true, 
    message: `Command broadcasted to ${targetDevices.length} devices`,
    targetDevices
  });
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
  socket.on('getHistoricalData', async (deviceId) => {
    try {
      // If we have cached data, use that
      if (historicalData[deviceId] && historicalData[deviceId].length > 0) {
        socket.emit('historicalData', {
          deviceId,
          data: historicalData[deviceId]
        });
        return;
      }
      
      // Otherwise, query from Redis
      const now = new Date();
      const fromTime = now.getTime() - (24 * 60 * 60 * 1000); // 24 hours ago
      
      const history = await getHistoricalDeviceData(deviceId, fromTime);
      
      // Cache the data
      historicalData[deviceId] = history;
      
      socket.emit('historicalData', {
        deviceId,
        data: history
      });
    } catch (error) {
      console.error(`Error fetching historical data for ${deviceId}:`, error);
      socket.emit('error', { message: 'Error retrieving historical data' });
    }
  });
  
  // Handle client requesting data for a specific date range
  socket.on('getDateRangeData', async ({deviceId, startDate, endDate}) => {
    try {
      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return socket.emit('error', { message: 'Invalid date format' });
      }
      
      // Query from Redis
      const rangeData = await getDateRangeData(deviceId, startDate, endDate);
      
      socket.emit('dateRangeData', {
        deviceId,
        data: rangeData
      });
    } catch (error) {
      console.error('Error retrieving date range data:', error);
      socket.emit('error', { message: 'Server error' });
    }
  });

  socket.on('sendCommand', ({ deviceId, component, action, value }) => {
    console.log(`Client requested command: ${deviceId} ${component} ${action}`);
    
    const success = sendCommand(deviceId, component, action, value);
    
    // Send result back to the client
    socket.emit('commandResult', {
      success,
      deviceId,
      component,
      action,
      value
    });
  });
  
  socket.on('broadcastCommand', ({ component, action, value }) => {
    console.log(`Client requested broadcast: ${component} ${action}`);
    
    const targetDevices = broadcastCommand(component, action, value);
    
    // Send result back to the client
    socket.emit('broadcastResult', {
      success: targetDevices.length > 0,
      targetDevices,
      component,
      action,
      value
    });
  });

  socket.on('getPicoDevices', () => {
    const devices = getConnectedPicoDevices();
    socket.emit('picoDevices', devices);
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
const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
  
  try {
    const client = await getRedisClient();
    
    // Get all device IDs
    const deviceKeys = await client.keys('device:*:latest');
    const deviceIds = deviceKeys.map(key => key.split(':')[1]);
    
    console.log(`Found ${deviceIds.length} devices in Redis`);
    
    // Load latest data for each device
    for (const deviceId of deviceIds) {
      try {
        const latestData = await getLatestDeviceData(deviceId);
        if (latestData) {
          deviceData[deviceId] = latestData;
          
          // Get recent historical data
          const now = new Date();
          const fromTime = now.getTime() - (24 * 60 * 60 * 1000); // 24 hours ago
          
          const history = await getHistoricalDeviceData(deviceId, fromTime);
          historicalData[deviceId] = history;
          
          // Update device connection status
          const lastSeen = new Date(latestData.timestamp);
          const diffMinutes = (now - lastSeen) / (1000 * 60);
          
          connectedDevices[deviceId] = {
            lastSeen: latestData.timestamp,
            status: diffMinutes <= 2 ? 'online' : 'offline'
          };
        }
      } catch (err) {
        console.error(`Error loading data for device ${deviceId}:`, err);
      }
    }
    
    console.log(`Loaded data for ${Object.keys(deviceData).length} devices`);
  } catch (error) {
    console.error('Error connecting to Redis:', error);
  }
});