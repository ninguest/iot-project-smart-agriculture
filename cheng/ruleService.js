// ruleService.js
const { getRedisClient } = require('./redisClient');
const { getLatestDeviceData } = require('./redisSensorData');
const { sendCommand } = require('./mqttService');
const schedule = require('node-schedule');

// Store scheduled jobs to allow cancellation
const scheduledJobs = new Map();

// Cache for latest device data (to avoid excessive Redis queries)
const deviceDataCache = new Map();
const CACHE_TTL = 10000; // 10 seconds

/**
 * Initialize the rule service
 */
async function initRuleService() {
  console.log('Initializing rule service...');
  
  try {
    // Load all rules from Redis
    const rules = await loadRules();
    console.log(`Loaded ${rules.length} rules from Redis`);
    
    // Start the rule evaluation loop
    startRuleLoop();
    
    // Schedule all time-based rules
    scheduleAllRules(rules.filter(rule => rule.type === 'schedule'));
    
    console.log('Rule service initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize rule service:', error);
    return false;
  }
}

/**
 * Start the rule evaluation loop
 * Runs every 30 seconds to check condition-based rules
 */
function startRuleLoop() {
  console.log('Starting rule evaluation loop...');
  
  // Run immediately once
  evaluateAllRules();
  
  // Then set interval
  setInterval(async () => {
    await evaluateAllRules();
  }, 30000); // Every 30 seconds
}

/**
 * Evaluate all condition-based rules
 */
async function evaluateAllRules() {
  try {
    // Load all condition-based rules
    const rules = await loadRules();
    const conditionRules = rules.filter(rule => rule.type === 'condition');
    
    if (conditionRules.length === 0) {
      return;
    }
    
    console.log(`Evaluating ${conditionRules.length} condition-based rules...`);
    
    // Group rules by device for efficient evaluation
    const rulesByDevice = {};
    conditionRules.forEach(rule => {
      if (!rulesByDevice[rule.deviceId]) {
        rulesByDevice[rule.deviceId] = [];
      }
      rulesByDevice[rule.deviceId].push(rule);
    });
    
    // Evaluate rules for each device
    for (const [deviceId, deviceRules] of Object.entries(rulesByDevice)) {
      try {
        const deviceData = await getDeviceData(deviceId);
        if (!deviceData) {
          console.log(`No data available for device ${deviceId}, skipping rules`);
          continue;
        }
        
        // Evaluate each rule for this device
        for (const rule of deviceRules) {
          if (rule.enabled) {
            evaluateRule(rule, deviceData);
          }
        }
      } catch (deviceError) {
        console.error(`Error evaluating rules for device ${deviceId}:`, deviceError);
      }
    }
  } catch (error) {
    console.error('Error evaluating rules:', error);
  }
}

/**
 * Evaluate a single rule against device data
 * @param {Object} rule - The rule to evaluate
 * @param {Object} deviceData - The latest device data
 */
function evaluateRule(rule, deviceData) {
  try {
    // Make sure we have both rule and data
    if (!rule || !deviceData) return;
    
    console.log(`Evaluating rule: ${rule.name} (ID: ${rule.id})`);
    
    // Extract condition details
    const { condition } = rule;
    if (!condition || !condition.sensor || !condition.operator || condition.value === undefined) {
      console.error(`Rule ${rule.id} has invalid condition:`, condition);
      return;
    }
    
    // Check if the sensor exists in the device data
    if (!deviceData.sensors || !deviceData.sensors[condition.sensor]) {
      console.log(`Sensor ${condition.sensor} not found in device data, skipping rule`);
      return;
    }
    
    // Get the current sensor value
    const currentValue = parseFloat(deviceData.sensors[condition.sensor].value);
    const thresholdValue = parseFloat(condition.value);
    
    // Evaluate the condition
    let conditionMet = false;
    switch (condition.operator) {
      case '>':
        conditionMet = currentValue > thresholdValue;
        break;
      case '>=':
        conditionMet = currentValue >= thresholdValue;
        break;
      case '<':
        conditionMet = currentValue < thresholdValue;
        break;
      case '<=':
        conditionMet = currentValue <= thresholdValue;
        break;
      case '==':
        conditionMet = currentValue === thresholdValue;
        break;
      case '!=':
        conditionMet = currentValue !== thresholdValue;
        break;
      default:
        console.error(`Unknown operator in rule ${rule.id}: ${condition.operator}`);
        return;
    }
    
    console.log(`Rule ${rule.id} condition: ${currentValue} ${condition.operator} ${thresholdValue} = ${conditionMet}`);
    
    // If condition is met, execute the action
    if (conditionMet) {
      executeRuleAction(rule);
    }
  } catch (error) {
    console.error(`Error evaluating rule ${rule.id}:`, error);
  }
}

/**
 * Execute the action defined in a rule
 * @param {Object} rule - The rule containing the action to execute
 */
function executeRuleAction(rule) {
  try {
    const { action } = rule;
    
    if (!action) {
      console.error(`Rule ${rule.id} has no action defined`);
      return;
    }
    
    // Set broadcast flag if deviceId is 'broadcast'
    const broadcastMode = rule.deviceId === 'broadcast' || action.broadcast === true;
    
    // Handle custom JSON action
    if (action.isCustomJson) {
      console.log(`Executing custom JSON action for rule ${rule.id}`);
      
      // Determine if this is a broadcast action
      if (broadcastMode) {
        // Send to all devices
        console.log(`Broadcasting command to all devices: ${action.component}.${action.action || action.command}=${action.value}`);
        
        // Use the MQTT broadcast method
        const broadcastAction = action.action || action.command; // support both naming conventions
        const broadcastResult = require('./mqttService').broadcastCommandToAll(
          action.component,
          broadcastAction, 
          action.value
        );
        
        // Record in history
        addToRuleHistory(rule.id, {
          timestamp: new Date().toISOString(),
          rule: rule.name,
          action: `Broadcast ${action.component}.${broadcastAction}=${action.value}`,
          device: 'All Devices'
        });
      } else {
        // Send to specific device (either from action or rule)
        const targetDevice = action.deviceId || rule.deviceId;
        const commandAction = action.action || action.command;
        
        console.log(`Sending command to device ${targetDevice}: ${action.component}.${commandAction}=${action.value}`);
        
        // Send command via MQTT
        const { sendCommand } = require('./mqttService');
        sendCommand(targetDevice, action.component, commandAction, action.value);
        
        // Record in history
        addToRuleHistory(rule.id, {
          timestamp: new Date().toISOString(),
          rule: rule.name,
          action: `${action.component}.${commandAction}=${action.value}`,
          device: targetDevice
        });
      }
      
      // Update rule last execution time
      updateRuleLastExecution(rule.id);
      
      return;
    }
    
    // Standard action handling
    if (!action.component || !action.command || action.value === undefined) {
      console.error(`Rule ${rule.id} has invalid action:`, action);
      return;
    }
    
    // Check if this is a broadcast action or targeted to a specific device
    if (broadcastMode) {
      console.log(`Broadcasting action for rule ${rule.id}: ${action.component}.${action.command}=${action.value}`);
      
      // Use broadcast method
      const { broadcastCommandToAll } = require('./mqttService');
      broadcastCommandToAll(action.component, action.command, action.value);
      
      // Record in history
      addToRuleHistory(rule.id, {
        timestamp: new Date().toISOString(),
        rule: rule.name,
        action: `${action.component}.${action.command}=${action.value}`,
        device: 'All Devices'
      });
    } else {
      console.log(`Executing action for rule ${rule.id}: ${action.component}.${action.command}=${action.value}`);
      
      // Send command via MQTT
      const { sendCommand } = require('./mqttService');
      sendCommand(rule.deviceId, action.component, action.command, action.value);
      
      // Record in history
      addToRuleHistory(rule.id, {
        timestamp: new Date().toISOString(),
        rule: rule.name,
        action: `${action.component}.${action.command}=${action.value}`,
        device: rule.deviceId
      });
    }
    
    // Update rule last execution time
    updateRuleLastExecution(rule.id);
  } catch (error) {
    console.error(`Error executing action for rule ${rule.id}:`, error);
  }
}

/**
 * Schedule all time-based rules
 * @param {Array} rules - List of schedule-type rules
 */
function scheduleAllRules(rules) {
  // Cancel any existing scheduled jobs
  cancelAllScheduledJobs();
  
  // Schedule each rule
  for (const rule of rules) {
    if (rule.enabled) {
      scheduleRule(rule);
    }
  }
  
  console.log(`Scheduled ${rules.filter(r => r.enabled).length} time-based rules`);
}

/**
 * Schedule a single rule
 * @param {Object} rule - The rule to schedule
 */
function scheduleRule(rule) {
  try {
    const { schedule: scheduleConfig } = rule;
    if (!scheduleConfig || !scheduleConfig.pattern) {
      console.error(`Rule ${rule.id} has invalid schedule configuration:`, scheduleConfig);
      return false;
    }
    
    console.log(`Scheduling rule ${rule.id} (${rule.name}) with pattern: ${scheduleConfig.pattern}`);
    
    // Create a scheduled job with node-schedule
    const job = schedule.scheduleJob(scheduleConfig.pattern, () => {
      console.log(`Executing scheduled rule ${rule.id} (${rule.name})`);
      executeRuleAction(rule);
    });
    
    // Store the job reference for later cancellation if needed
    scheduledJobs.set(rule.id, job);
    
    return true;
  } catch (error) {
    console.error(`Error scheduling rule ${rule.id}:`, error);
    return false;
  }
}

/**
 * Cancel all scheduled jobs
 */
function cancelAllScheduledJobs() {
  for (const [ruleId, job] of scheduledJobs.entries()) {
    console.log(`Cancelling scheduled job for rule ${ruleId}`);
    job.cancel();
  }
  scheduledJobs.clear();
}

/**
 * Get cached device data or fetch from Redis if cache expired
 * @param {string} deviceId - Device ID
 * @returns {Object} - Latest device data
 */
async function getDeviceData(deviceId) {
  const now = Date.now();
  const cached = deviceDataCache.get(deviceId);
  
  // If we have valid cached data, use it
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  
  // Otherwise fetch fresh data
  try {
    const data = await getLatestDeviceData(deviceId);
    if (data) {
      deviceDataCache.set(deviceId, {
        data,
        timestamp: now
      });
    }
    return data;
  } catch (error) {
    console.error(`Error fetching device data for ${deviceId}:`, error);
    return null;
  }
}

/**
 * Save a rule to Redis
 * @param {Object} rule - The rule to save
 * @returns {boolean} - Success status
 */
async function saveRule(rule) {
  try {
    if (!rule.id) {
      rule.id = generateRuleId();
    }
    
    // Set creation date if new
    if (!rule.createdAt) {
      rule.createdAt = new Date().toISOString();
    }
    
    // Always update the modified date
    rule.updatedAt = new Date().toISOString();
    
    // Initialize execution history if not exists
    if (!rule.lastExecuted) {
      rule.lastExecuted = null;
    }
    
    // Set enabled flag if not specified
    if (rule.enabled === undefined) {
      rule.enabled = true;
    }
    
    const client = await getRedisClient();
    const key = `rule:${rule.id}`;
    
    await client.set(key, JSON.stringify(rule));
    
    // If it's a schedule rule and enabled, schedule it
    if (rule.type === 'schedule' && rule.enabled) {
      // Cancel existing job if exists
      if (scheduledJobs.has(rule.id)) {
        scheduledJobs.get(rule.id).cancel();
        scheduledJobs.delete(rule.id);
      }
      
      // Create new schedule
      scheduleRule(rule);
    }
    
    console.log(`Rule ${rule.id} saved to Redis`);
    return true;
  } catch (error) {
    console.error('Error saving rule to Redis:', error);
    return false;
  }
}

/**
 * Load all rules from Redis
 * @returns {Array} - List of rules
 */
async function loadRules() {
  try {
    const client = await getRedisClient();
    const keys = await client.keys('rule:*');
    
    if (!keys || keys.length === 0) {
      return [];
    }
    
    const rules = [];
    for (const key of keys) {
      const ruleJson = await client.get(key);
      if (ruleJson) {
        try {
          const rule = JSON.parse(ruleJson);
          
          // Validate that the rule has required fields
          if (rule && rule.id && rule.name) {
            rules.push(rule);
          } else {
            console.warn(`Found invalid rule (missing required fields): ${key}`);
          }
        } catch (parseError) {
          console.error(`Error parsing rule from Redis (${key}):`, parseError);
        }
      }
    }
    
    return rules;
  } catch (error) {
    console.error('Error loading rules from Redis:', error);
    return [];
  }
}

/**
 * Get a single rule by ID
 * @param {string} ruleId - Rule ID
 * @returns {Object|null} - The rule or null if not found
 */
async function getRuleById(ruleId) {
  try {
    const client = await getRedisClient();
    const ruleJson = await client.get(`rule:${ruleId}`);
    
    if (!ruleJson) {
      return null;
    }
    
    return JSON.parse(ruleJson);
  } catch (error) {
    console.error(`Error getting rule ${ruleId}:`, error);
    return null;
  }
}

/**
 * Delete a rule by ID
 * @param {string} ruleId - Rule ID to delete
 * @returns {boolean} - Success status
 */
async function deleteRule(ruleId) {
  try {
    // Cancel any scheduled job for this rule
    if (scheduledJobs.has(ruleId)) {
      scheduledJobs.get(ruleId).cancel();
      scheduledJobs.delete(ruleId);
    }
    
    const client = await getRedisClient();
    await client.del(`rule:${ruleId}`);
    await client.del(`rule:history:${ruleId}`);
    
    console.log(`Rule ${ruleId} deleted from Redis`);
    return true;
  } catch (error) {
    console.error(`Error deleting rule ${ruleId}:`, error);
    return false;
  }
}

/**
 * Enable or disable a rule
 * @param {string} ruleId - Rule ID
 * @param {boolean} enabled - Enable/disable flag
 * @returns {boolean} - Success status
 */
async function setRuleEnabled(ruleId, enabled) {
  try {
    const rule = await getRuleById(ruleId);
    if (!rule) {
      return false;
    }
    
    rule.enabled = !!enabled;
    rule.updatedAt = new Date().toISOString();
    
    // If it's a schedule rule, handle the job
    if (rule.type === 'schedule') {
      if (rule.enabled) {
        // Schedule if enabled
        scheduleRule(rule);
      } else if (scheduledJobs.has(ruleId)) {
        // Cancel if disabled
        scheduledJobs.get(ruleId).cancel();
        scheduledJobs.delete(ruleId);
      }
    }
    
    // Save the updated rule
    return await saveRule(rule);
  } catch (error) {
    console.error(`Error setting enabled state for rule ${ruleId}:`, error);
    return false;
  }
}

/**
 * Update rule last execution time
 * @param {string} ruleId - Rule ID
 * @returns {boolean} - Success status
 */
async function updateRuleLastExecution(ruleId) {
  try {
    const rule = await getRuleById(ruleId);
    if (!rule) {
      return false;
    }
    
    rule.lastExecuted = new Date().toISOString();
    
    const client = await getRedisClient();
    await client.set(`rule:${ruleId}`, JSON.stringify(rule));
    
    return true;
  } catch (error) {
    console.error(`Error updating last execution for rule ${ruleId}:`, error);
    return false;
  }
}

/**
 * Add an entry to the rule execution history
 * @param {string} ruleId - Rule ID
 * @param {Object} historyEntry - History entry details
 * @returns {boolean} - Success status
 */
async function addToRuleHistory(ruleId, historyEntry) {
  try {
    const client = await getRedisClient();
    const key = `rule:history:${ruleId}`;
    
    // Get existing history
    const historyJson = await client.get(key);
    let history = [];
    
    if (historyJson) {
      history = JSON.parse(historyJson);
    }
    
    // Add new entry
    history.push(historyEntry);
    
    // Keep only last 50 entries
    if (history.length > 50) {
      history = history.slice(-50);
    }
    
    // Save back to Redis
    await client.set(key, JSON.stringify(history));
    
    // Also emit to Socket.IO if global.io is available
    if (global.io) {
      global.io.emit('ruleExecuted', {
        ruleId,
        execution: historyEntry
      });
    }
    
    return true;
  } catch (error) {
    console.error(`Error adding to history for rule ${ruleId}:`, error);
    return false;
  }
}

/**
 * Get execution history for a rule
 * @param {string} ruleId - Rule ID
 * @returns {Array} - History entries
 */
async function getRuleHistory(ruleId) {
  try {
    const client = await getRedisClient();
    const historyJson = await client.get(`rule:history:${ruleId}`);
    
    if (!historyJson) {
      return [];
    }
    
    return JSON.parse(historyJson);
  } catch (error) {
    console.error(`Error getting history for rule ${ruleId}:`, error);
    return [];
  }
}

/**
 * Generate a unique rule ID
 * @returns {string} - Unique ID
 */
function generateRuleId() {
  return `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

module.exports = {
  initRuleService,
  saveRule,
  loadRules,
  getRuleById,
  deleteRule,
  setRuleEnabled,
  getRuleHistory,
  evaluateRule,
  scheduleRule
};