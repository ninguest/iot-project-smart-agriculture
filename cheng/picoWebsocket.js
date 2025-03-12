// picoWebsocket.js
const WebSocket = require('ws');

// Store connected Pico W devices and their capabilities
const connectedPicos = new Map();

/**
 * Initialize WebSocket server for Pico W devices
 * @param {Object} server - HTTP server instance
 * @returns {WebSocket.Server} - WebSocket server instance
 */
function initPicoWebSocketServer(server) {
  // Create WebSocket server on a different path than Socket.IO
  const wss = new WebSocket.Server({ 
    server,
    path: '/pico'
  });
  
  // Add more detailed logging
  wss.on('headers', (headers, req) => {
    console.log('WebSocket headers:', headers);
    console.log('WebSocket request URL:', req.url);
  });

  wss.on('connection', (ws, req)=>{
    console.log('Pico W device connected from:', req.socket.remoteAddress);
    handlePicoConnection(ws);
  });
  
  console.log('Pico WebSocket server initialized on path: /pico');
  return wss;
}

/**
 * Handle new Pico W connection
 * @param {WebSocket} ws - WebSocket connection
 */
function handlePicoConnection(ws) {
  console.log('Pico W device connected');
  
  // Set up message handler
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handlePicoMessage(ws, message);
    } catch (error) {
      console.error('Error parsing message from Pico W:', error);
      sendToPico(ws, {
        type: 'error',
        message: 'Invalid message format. Expected JSON.'
      });
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    // Find and remove this device from connectedPicos
    for (const [deviceId, device] of connectedPicos.entries()) {
      if (device.connection === ws) {
        console.log(`Pico W device ${deviceId} disconnected`);
        connectedPicos.delete(deviceId);
        break;
      }
    }
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('Pico WebSocket error:', error);
  });
  
  // Send welcome message and request registration
  sendToPico(ws, {
    type: 'system',
    action: 'welcome',
    message: 'Connected to server. Please register with device_id and capabilities.'
  });
}

/**
 * Handle messages from Pico W devices
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message
 */
function handlePicoMessage(ws, message) {
  // Validate message format
  if (!message.type) {
    return sendToPico(ws, {
      type: 'error',
      message: 'Missing message type'
    });
  }
  
  console.log('Received message from Pico W:', message);
  
  switch (message.type) {
    case 'register':
      handleRegistration(ws, message);
      break;
    
    case 'status':
      handleStatusUpdate(message);
      break;
      
    case 'sensor_data':
      // This is handled by the REST API, but we could process it here too
      console.log('Received sensor data via WebSocket');
      break;
      
    case 'action_result':
      handleActionResult(message);
      break;
      
    default:
      sendToPico(ws, {
        type: 'error',
        message: `Unknown message type: ${message.type}`
      });
  }
}

/**
 * Handle device registration
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Registration message
 */
function handleRegistration(ws, message) {
  // Validate registration data
  if (!message.device_id) {
    return sendToPico(ws, {
      type: 'error',
      message: 'Missing device_id in registration'
    });
  }
  
  // Store device information and capabilities
  connectedPicos.set(message.device_id, {
    connection: ws,
    capabilities: message.capabilities || [],
    lastSeen: new Date().toISOString(),
    status: 'online'
  });
  
  console.log(`Registered Pico W device: ${message.device_id}`);
  console.log(`Device capabilities:`, message.capabilities);
  
  // Confirm registration
  sendToPico(ws, {
    type: 'system',
    action: 'registered',
    message: `Successfully registered device ${message.device_id}`
  });
}

/**
 * Handle device status update
 * @param {Object} message - Status message
 */
function handleStatusUpdate(message) {
  if (!message.device_id || !connectedPicos.has(message.device_id)) {
    return;
  }
  
  // Update device status
  const device = connectedPicos.get(message.device_id);
  device.lastSeen = new Date().toISOString();
  
  // If the device sent component states, update them
  if (message.components) {
    device.components = message.components;
  }
}

/**
 * Handle action result from device
 * @param {Object} message - Action result message
 */
function handleActionResult(message) {
  if (!message.device_id || !message.action_id) {
    return;
  }
  
  console.log(`Received action result from ${message.device_id}:`, message);
  
  // Here you could update UI or notify clients about the result
  // For now, just log it
}

/**
 * Send message to a specific Pico W device
 * @param {WebSocket|string} target - WebSocket connection or device_id
 * @param {Object} message - Message to send
 */
function sendToPico(target, message) {
  try {
    let ws;
    
    // If target is a string, assume it's a device_id
    if (typeof target === 'string') {
      const device = connectedPicos.get(target);
      if (!device) {
        console.error(`Device ${target} not found`);
        return false;
      }
      ws = device.connection;
    } else {
      // Otherwise, assume it's a WebSocket connection
      ws = target;
    }
    
    // Check if the connection is still open
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    } else {
      console.error('WebSocket connection is not open');
      return false;
    }
  } catch (error) {
    console.error('Error sending message to Pico W:', error);
    return false;
  }
}

/**
 * Send a command to a specific device
 * @param {string} deviceId - Target device ID
 * @param {string} component - Component to control (e.g., 'fan', 'led', 'pump')
 * @param {string} action - Action to perform (e.g., 'on', 'off', 'set')
 * @param {any} value - Optional value for the action
 * @returns {boolean} - Success status
 */
function sendCommand(deviceId, component, action, value = null) {
  if (!connectedPicos.has(deviceId)) {
    console.error(`Device ${deviceId} not connected`);
    return false;
  }
  
  const device = connectedPicos.get(deviceId);
  
  // Check if the device has this capability
  if (device.capabilities && !device.capabilities.includes(component)) {
    console.error(`Device ${deviceId} does not support component: ${component}`);
    return false;
  }
  
  const actionId = generateActionId();
  
  return sendToPico(deviceId, {
    type: 'command',
    action_id: actionId,
    component,
    action,
    value
  });
}

/**
 * Broadcast a command to all devices with a specific capability
 * @param {string} component - Component to control (e.g., 'fan', 'led', 'pump')
 * @param {string} action - Action to perform
 * @param {any} value - Optional value for the action
 * @returns {Array} - Array of device IDs that received the command
 */
function broadcastCommand(component, action, value = null) {
  const targetDevices = [];
  
  // Find all devices with this capability
  for (const [deviceId, device] of connectedPicos.entries()) {
    if (device.capabilities && device.capabilities.includes(component)) {
      const actionId = generateActionId();
      
      sendToPico(deviceId, {
        type: 'command',
        action_id: actionId,
        component,
        action,
        value
      });
      
      targetDevices.push(deviceId);
    }
  }
  
  console.log(`Broadcasted ${component} ${action} command to ${targetDevices.length} devices`);
  return targetDevices;
}

/**
 * Generate a unique action ID
 * @returns {string} - Unique ID
 */
function generateActionId() {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Get a list of all connected Pico devices and their capabilities
 * @returns {Array} - Array of device objects
 */
function getConnectedPicoDevices() {
  const devices = [];
  
  for (const [deviceId, device] of connectedPicos.entries()) {
    devices.push({
      device_id: deviceId,
      capabilities: device.capabilities,
      lastSeen: device.lastSeen,
      status: device.status,
      components: device.components || {}
    });
  }
  
  return devices;
}

module.exports = {
  initPicoWebSocketServer,
  sendCommand,
  broadcastCommand,
  getConnectedPicoDevices
};