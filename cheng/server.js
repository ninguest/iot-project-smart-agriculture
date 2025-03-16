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
  initRuleService,
  saveRule,
  loadRules,
  getRuleById,
  deleteRule,
  setRuleEnabled,
  getRuleHistory
} = require('./ruleService');

// Import both WebSocket and MQTT services (renamed to avoid conflicts)
const {
  initPicoWebSocketServer,
  sendCommand: sendWsCommand,
  broadcastCommand: broadcastWsCommand,
  getConnectedPicoDevices
} = require('./picoWebsocket');

const {
  initMqttClient,
  sendCommand: sendMqttCommand,
  broadcastCommand: broadcastMqttCommand
} = require('./mqttService');

// Create Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set global io for mqttService to use
global.io = io;

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

// Communication mode - can be 'websocket' or 'mqtt'
const COMMUNICATION_MODE = 'mqtt'; // Set to your preferred mode

// Route to serve the main dashboard page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/mqtt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mqtt.html'));
});

app.get('/rules', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rules.html'));
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

    // Save to log file
    saveToLogFile(deviceId, dataWithTimestamp);

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
});

// Get all Pico W devices with their capabilities
app.get('/api/pico-devices', (req, res) => {
  const devices = getConnectedPicoDevices();
  res.json(devices);
});

// Get all rules
app.get('/api/rules', async (req, res) => {
  try {
    const rules = await loadRules();
    res.json(rules);
  } catch (error) {
    console.error('Error getting rules:', error);
    res.status(500).json({ error: 'Error getting rules' });
  }
});

// Get a specific rule
app.get('/api/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const rule = await getRuleById(ruleId);
    
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    res.json(rule);
  } catch (error) {
    console.error(`Error getting rule ${req.params.ruleId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or update a rule
app.post('/api/rules', async (req, res) => {
  try {
    const rule = req.body;
    
    // Validate rule
    if (!rule || !rule.name || !rule.deviceId || !rule.type) {
      return res.status(400).json({ error: 'Invalid rule data. Required fields: name, deviceId, type' });
    }
    
    // For broadcast mode, only allow schedule rules (not condition rules)
    if (rule.deviceId === 'broadcast' && rule.type === 'condition') {
      return res.status(400).json({ 
        error: 'Broadcast mode only supports schedule-based rules, not condition-based rules' 
      });
    }
    
    // Validate condition for condition-type rules (for non-broadcast mode)
    if (rule.type === 'condition' && (!rule.condition || !rule.condition.sensor || !rule.condition.operator || rule.condition.value === undefined)) {
      return res.status(400).json({ error: 'Invalid condition rule. Required fields: condition.sensor, condition.operator, condition.value' });
    }
    
    // Validate schedule for schedule-type rules
    if (rule.type === 'schedule' && (!rule.schedule || !rule.schedule.pattern)) {
      return res.status(400).json({ error: 'Invalid schedule rule. Required field: schedule.pattern' });
    }
    
    // Validate action
    if (!rule.action) {
      return res.status(400).json({ error: 'Invalid rule action. Action is required.' });
    }
    
    // Special handling for custom JSON actions
    if (rule.action.isCustomJson) {
      // For custom JSON actions, we need either action or command (or both)
      if ((!rule.action.component) || 
          (rule.action.action === undefined && rule.action.command === undefined) || 
          (rule.action.value === undefined)) {
        return res.status(400).json({ 
          error: 'Invalid custom JSON action. Required fields: component, action/command, value' 
        });
      }
    } else {
      // Standard action validation
      if (!rule.action.component || !rule.action.command || rule.action.value === undefined) {
        return res.status(400).json({ 
          error: 'Invalid standard action. Required fields: action.component, action.command, action.value' 
        });
      }
    }
    
    // For broadcast mode, set the broadcast flag
    if (rule.deviceId === 'broadcast') {
      rule.action.broadcast = true;
    }
    
    const success = await saveRule(rule);
    
    if (success) {
      res.status(rule.id ? 200 : 201).json({ success: true, ruleId: rule.id });
    } else {
      res.status(500).json({ error: 'Failed to save rule' });
    }
  } catch (error) {
    console.error('Error saving rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a rule
app.delete('/api/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const rule = await getRuleById(ruleId);
    
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    const success = await deleteRule(ruleId);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete rule' });
    }
  } catch (error) {
    console.error(`Error deleting rule ${req.params.ruleId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Enable or disable a rule
app.post('/api/rules/:ruleId/toggle', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Missing required field: enabled' });
    }
    
    const rule = await getRuleById(ruleId);
    
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    const success = await setRuleEnabled(ruleId, enabled);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to update rule status' });
    }
  } catch (error) {
    console.error(`Error toggling rule ${req.params.ruleId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get rule execution history
app.get('/api/rules/:ruleId/history', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const history = await getRuleHistory(ruleId);
    
    res.json(history);
  } catch (error) {
    console.error(`Error getting history for rule ${req.params.ruleId}:`, error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Universal send command function that routes to the appropriate implementation
function sendCommand(deviceId, component, action, value) {
  console.log(`MQTT sendCommand called: ${deviceId}, ${component}, ${action}, ${value}`);
  
  if (!mqttClient || !mqttClient.connected) {
    console.error('MQTT client not connected');
    return null;
  }
  
  // Generate command ID
  const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  // Create command object
  const command = {
    id: commandId,
    component,
    action,
    value,
    timestamp: Date.now()
  };
  
  // Publish to device's command topic
  const topic = `${TOPIC_PREFIX}${deviceId}/commands`;
  console.log(`Publishing to topic: ${topic}`);
  console.log(`Command payload: ${JSON.stringify(command)}`);
  
  mqttClient.publish(topic, JSON.stringify(command));
  
  console.log(`Command sent to device ${deviceId}: ${component}.${action}=${value}`);
  return commandId;
}

// Universal broadcast command function that routes to the appropriate implementation
function broadcastCommand(component, action, value) {
  if (COMMUNICATION_MODE === 'mqtt') {
    // Use the new broadcast-to-all method instead of targeting specific devices
    return require('./mqttService').broadcastCommandToAll(component, action, value);
  } else {
    // Default to WebSocket
    return broadcastWsCommand(component, action, value);
  }
}

// Send command to a specific device
app.post('/api/command/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { component, action, value } = req.body;
  
  if (!component || !action) {
    return res.status(400).json({ error: 'Missing required parameters: component and action' });
  }
  
  const commandId = sendCommand(deviceId, component, action, value);
  
  if (commandId) {
    res.json({ 
      success: true, 
      message: `Command sent to device ${deviceId}`,
      commandId
    });
  } else {
    res.status(404).json({ 
      success: false, 
      error: `Failed to send command to device ${deviceId}` 
    });
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
    
    const commandId = sendCommand(deviceId, component, action, value);
    
    // Send result back to the client
    socket.emit('commandResult', {
      success: !!commandId,
      deviceId,
      component,
      action,
      value,
      commandId
    });
  });
  
  socket.on('broadcastCommand', ({ component, action, value }) => {
    console.log(`Client requested broadcast: ${component} ${action}`);
  
    // For MQTT mode, use the broadcast-to-all method
    let success = false;
    let commandId = null;
    
    if (COMMUNICATION_MODE === 'mqtt') {
      commandId = require('./mqttService').broadcastCommandToAll(component, action, value);
      success = !!commandId;
    } else {
      // For WebSocket mode, use the existing method
      const targetDevices = broadcastWsCommand(component, action, value);
      success = targetDevices.length > 0;
    }
    
    // Send result back to the client
    socket.emit('broadcastResult', {
      success: success,
      targetDevices: ['all'], // Indicate broadcast to all devices
      component,
      action,
      value,
      commandId
    });
  });

  socket.on('getPicoDevices', () => {
    const devices = getConnectedPicoDevices();
    socket.emit('picoDevices', devices);
  });

  // MQTT Status request
  socket.on('getMqttStatus', () => {
    // Get MQTT info from the mqttService module
    const mqttInfo = require('./mqttService').getMqttInfo();
    
    socket.emit('mqttStatus', mqttInfo);
  });

  // Add handlers for rules
  socket.on('getRules', async () => {
    try {
      const rules = await loadRules();
      socket.emit('rules', rules);
    } catch (error) {
      console.error('Error fetching rules for socket:', error);
      socket.emit('error', { message: 'Error retrieving rules' });
    }
  });
  
  socket.on('getSensorsForDevice', async (deviceId) => {
    try {
      const deviceData = await getLatestDeviceData(deviceId);
      if (deviceData && deviceData.sensors) {
        const sensors = Object.keys(deviceData.sensors).map(sensorKey => ({
          id: sensorKey,
          name: sensorKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          unit: deviceData.sensors[sensorKey].unit
        }));
        
        socket.emit('deviceSensors', { deviceId, sensors });
      } else {
        socket.emit('deviceSensors', { deviceId, sensors: [] });
      }
    } catch (error) {
      console.error(`Error fetching sensors for device ${deviceId}:`, error);
      socket.emit('error', { message: 'Error retrieving sensors' });
    }
  });
  
  socket.on('getComponentsForDevice', async (deviceId) => {
    try {
      // For MQTT devices, we can use standard components
      const components = [
        { id: 'fan', name: 'Fan' },
        { id: 'led', name: 'LED' },
        { id: 'pump', name: 'Pump' }
      ];
      
      socket.emit('deviceComponents', { deviceId, components });
    } catch (error) {
      console.error(`Error fetching components for device ${deviceId}:`, error);
      socket.emit('error', { message: 'Error retrieving components' });
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
const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
  
  try {
    // Initialize MQTT client
    await initMqttClient();
    console.log('MQTT service initialized');
    
    // Initialize the rule service
    await initRuleService();
    console.log('Rule service initialized');

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
    console.error('Error during server initialization:', error);
  }
});