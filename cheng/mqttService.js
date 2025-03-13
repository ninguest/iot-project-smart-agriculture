// mqttService.js
const mqtt = require('mqtt');
const { getRedisClient } = require('./redisClient');

// MQTT Configuration - using EMQX public broker
const MQTT_BROKER = 'mqtt://broker.emqx.io:1883';
const TOPIC_PREFIX = 'ycstation/devices/'; // Change to a unique identifier
let mqttClient = null;

/**
 * Initialize the MQTT client
 */
async function initMqttClient() {
  console.log('Connecting to MQTT broker:', MQTT_BROKER);
  
  // Connect to MQTT broker
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: 'server_' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 5000
  });
  
  // Handle connection events
  mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    
    // Subscribe to device topics
    const statusTopic = TOPIC_PREFIX + '+/status';
    const telemetryTopic = TOPIC_PREFIX + '+/telemetry';
    const ackTopic = TOPIC_PREFIX + '+/ack';
    
    mqttClient.subscribe([statusTopic, telemetryTopic, ackTopic], (err) => {
      if (!err) {
        console.log('Subscribed to device topics:', statusTopic, telemetryTopic, ackTopic);
      } else {
        console.error('Subscription error:', err);
      }
    });
  });
  
  // Handle incoming messages
  mqttClient.on('message', async (topic, message) => {
    try {
      console.log(`Received message on ${topic}`);
      
      // Parse message
      const payload = JSON.parse(message.toString());
      
      // Extract device ID from topic
      const topicParts = topic.split('/');
      const deviceId = topicParts[topicParts.indexOf('devices') + 1];
      const messageType = topicParts[topicParts.length - 1];
      
      // Process based on message type
      if (messageType === 'status') {
        await handleStatusUpdate(deviceId, payload);
      } else if (messageType === 'telemetry') {
        await handleTelemetryData(deviceId, payload);
      } else if (messageType === 'ack') {
        await handleCommandAcknowledgment(deviceId, payload);
      }
      
      // Emit to Socket.IO clients if available
      if (global.io) {
        global.io.emit('mqttMessage', {
          type: messageType,
          topic: topic,
          content: payload,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error processing MQTT message:', error);
      
      // Emit error to Socket.IO clients
      if (global.io) {
        global.io.emit('mqttMessage', {
          type: 'error',
          topic: topic,
          content: {
            message: 'Error processing MQTT message',
            error: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  });
  
  // Handle errors and other events
  mqttClient.on('error', (error) => {
    console.error('MQTT error:', error);
  });
  
  mqttClient.on('close', () => {
    console.log('MQTT connection closed');
  });
  
  mqttClient.on('offline', () => {
    console.log('MQTT client went offline');
  });
  
  mqttClient.on('reconnect', () => {
    console.log('MQTT client reconnecting');
  });
  
  return mqttClient;
}

/**
 * Handle device status updates
 */
async function handleStatusUpdate(deviceId, status) {
  try {
    console.log(`Device ${deviceId} status update:`, status);
    const client = await getRedisClient();
    
    // Store latest status in Redis
    if (client.json) {
      await client.json.set(`device:${deviceId}:latest`, '$', status);
    } else {
      await client.set(`device:${deviceId}:latest`, JSON.stringify(status));
    }
    
    // Update device connection status
    await client.hSet(`device:${deviceId}:connection`, {
      status: 'online',
      lastSeen: new Date().toISOString()
    });
    
    // Emit through Socket.IO to update UI
    const io = global.io;
    if (io) {
      io.emit('deviceStatus', {
        [deviceId]: {
          status: 'online',
          lastSeen: status.timestamp
        }
      });
    }
    
    console.log(`Updated status for device ${deviceId}`);
  } catch (error) {
    console.error(`Error handling status update for device ${deviceId}:`, error);
  }
}

/**
 * Handle telemetry data (sensor readings)
 */
async function handleTelemetryData(deviceId, telemetry) {
  try {
    console.log(`Device ${deviceId} telemetry:`, telemetry);
    
    // Store in Redis (using your existing function)
    const { saveToRedis } = require('./redisSensorData');
    await saveToRedis(deviceId, telemetry);
    
    // Emit to Socket.IO clients
    const io = global.io;
    if (io) {
      io.emit('sensorUpdate', { 
        deviceId,
        data: telemetry
      });
    }
    
    console.log(`Processed telemetry data for device ${deviceId}`);
  } catch (error) {
    console.error(`Error handling telemetry data for device ${deviceId}:`, error);
  }
}

/**
 * Handle command acknowledgments
 */
async function handleCommandAcknowledgment(deviceId, ack) {
  try {
    console.log(`Device ${deviceId} command ack:`, ack);
    const client = await getRedisClient();
    
    // Update command status in Redis
    await client.hSet(`device:${deviceId}:command:${ack.command_id}`, {
      status: ack.success ? 'executed' : 'failed',
      message: ack.message,
      executed_at: new Date().toISOString()
    });
    
    // Emit command result to Socket.IO clients
    const io = global.io;
    if (io) {
      io.emit('commandResult', {
        deviceId,
        commandId: ack.command_id,
        success: ack.success,
        message: ack.message
      });
    }
    
    console.log(`Command ${ack.command_id} for device ${deviceId} was ${ack.success ? 'executed' : 'failed'}`);
  } catch (error) {
    console.error(`Error handling command acknowledgment for device ${deviceId}:`, error);
  }
}

/**
 * Send a command to a device via MQTT
 */
function sendCommand(deviceId, component, action, value) {
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
  mqttClient.publish(topic, JSON.stringify(command));
  
  console.log(`Command sent to device ${deviceId}: ${component}.${action}=${value}`);
  return commandId;
}

/**
 * Broadcast command to multiple devices
 */
function broadcastCommand(devices, component, action, value) {
  if (!mqttClient || !mqttClient.connected) {
    console.error('MQTT client not connected');
    return [];
  }
  
  const results = [];
  
  for (const deviceId of devices) {
    const commandId = sendCommand(deviceId, component, action, value);
    if (commandId) {
      results.push({ deviceId, commandId });
    }
  }
  
  console.log(`Broadcast command sent to ${results.length} devices`);
  return results;
}

/**
 * Broadcast command to all devices using a common topic
 */
function broadcastCommandToAll(component, action, value) {
  if (!mqttClient || !mqttClient.connected) {
    console.error('MQTT client not connected');
    return false;
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
  
  // Publish to the broadcast topic that all devices listen to
  const topic = `${TOPIC_PREFIX}all/commands`;
  mqttClient.publish(topic, JSON.stringify(command));
  
  console.log(`Broadcast command sent to all devices on topic ${topic}: ${component}.${action}=${value}`);
  return commandId;
}

function getMqttInfo() {
    return {
      broker: MQTT_BROKER,
      topicPrefix: TOPIC_PREFIX,
      connected: mqttClient && mqttClient.connected
    };
}

module.exports = {
    initMqttClient,
    sendCommand,
    broadcastCommand,
    broadcastCommandToAll,
    getMqttInfo
};