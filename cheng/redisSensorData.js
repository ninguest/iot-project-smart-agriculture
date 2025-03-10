// redisSensorData.js
const { getRedisClient } = require('./redisClient');
const { retentionPeriod } = require('./redisConfig');

// Flag to track if TimeSeries is available
let timeSeriesAvailable = true;
let timeSeriesChecked = false;

/**
 * Check if Redis TimeSeries module is available
 * @param {Object} client - Redis client
 * @returns {Promise<boolean>} - Whether TimeSeries is available
 */
async function checkTimeSeriesAvailable(client) {
  if (timeSeriesChecked) {
    return timeSeriesAvailable;
  }
  
  try {
    // Try to execute a simple TimeSeries command
    await client.sendCommand(['TS.INFO', 'test']);
    timeSeriesAvailable = true;
  } catch (err) {
    if (err.message && err.message.includes('unknown command')) {
      console.warn('Redis TimeSeries module is not available. Using standard Redis commands instead.');
      timeSeriesAvailable = false;
    } else if (!err.message.includes('key does not exist')) {
      // If error is not "key doesn't exist", then something else is wrong
      console.error('Error checking TimeSeries availability:', err);
      timeSeriesAvailable = false;
    }
  }
  
  timeSeriesChecked = true;
  return timeSeriesAvailable;
}

/**
 * Save sensor data to Redis
 * @param {string} deviceId - The device ID
 * @param {Object} data - The sensor data object
 */
async function saveToRedis(deviceId, data) {
  try {
    const client = await getRedisClient();
    const timestamp = new Date(data.timestamp).getTime(); // Convert to milliseconds
    
    // Check if TimeSeries is available
    const useTSDB = await checkTimeSeriesAvailable(client);
    
    if (useTSDB) {
      // TimeSeries is available, use TS commands
      // Store each sensor in its own time series
      for (const [sensorKey, sensorData] of Object.entries(data.sensors)) {
        const key = `device:${deviceId}:sensor:${sensorKey}`;
        const value = parseFloat(sensorData.value);
        
        try {
          // Create the time series if it doesn't exist
          await client.ts.create(key, {
            RETENTION: retentionPeriod,
            LABELS: {
              device_id: deviceId,
              sensor: sensorKey,
              unit: sensorData.unit
            }
          });
        } catch (err) {
          // Ignore "key already exists" error (TSDB:duplicate key)
          if (!err.message.includes('TSDB: key already exists')) {
            throw err;
          }
        }
        
        // Add the data point
        await client.ts.add(key, timestamp, value);
      }
    } else {
      // TimeSeries not available, use standard Redis commands
      // Store data points in a sorted set with timestamp as score
      for (const [sensorKey, sensorData] of Object.entries(data.sensors)) {
        const key = `fallback:device:${deviceId}:sensor:${sensorKey}`;
        const value = parseFloat(sensorData.value);
        
        // Store in sorted set: timestamp -> value:unit
        await client.zAdd(key, {
          score: timestamp,
          value: `${value}:${sensorData.unit}`
        });
        
        // Set expiration based on retention period
        await client.expire(key, Math.floor(retentionPeriod / 1000));
        
        // Also store the sensor metadata
        const metaKey = `meta:${key}`;
        await client.hSet(metaKey, {
          device_id: deviceId,
          sensor: sensorKey,
          unit: sensorData.unit,
          last_update: timestamp
        });
        await client.expire(metaKey, Math.floor(retentionPeriod / 1000));
      }
    }
    
    // Store the full JSON of the latest reading for each device (this works the same way regardless of TimeSeries)
    if (client.json) {
      await client.json.set(`device:${deviceId}:latest`, '$', data);
    } else {
      // Fallback for when RedisJSON module is not available
      await client.set(`device:${deviceId}:latest`, JSON.stringify(data));
    }
    
    console.log(`Saved data for device ${deviceId} to Redis`);
  } catch (error) {
    console.error(`Error saving to Redis for device ${deviceId}:`, error);
  }
}

/**
 * Get the latest data for a device
 * @param {string} deviceId - The device ID
 * @returns {Object|null} - The latest data or null
 */
async function getLatestDeviceData(deviceId) {
  try {
    const client = await getRedisClient();
    let latest;
    
    if (client.json) {
      latest = await client.json.get(`device:${deviceId}:latest`);
    } else {
      // Fallback for when RedisJSON module is not available
      const jsonStr = await client.get(`device:${deviceId}:latest`);
      if (jsonStr) {
        latest = JSON.parse(jsonStr);
      }
    }
    
    return latest;
  } catch (error) {
    console.error(`Error getting latest data for device ${deviceId}:`, error);
    return null;
  }
}

/**
 * Get historical data for a device using standard Redis commands
 * @param {string} deviceId - The device ID
 * @param {number} fromTime - Start time in milliseconds
 * @param {number} toTime - End time in milliseconds or '+' for all data
 * @returns {Array} - Array of readings
 */
async function getFallbackHistoricalData(client, deviceId, fromTime, toTime) {
  try {
    // If toTime is '+', use current time as end time
    const endTime = toTime === '+' ? Date.now() : toTime;
    
    // Get all sensor keys for this device
    const sensorKeys = await client.keys(`fallback:device:${deviceId}:sensor:*`);
    
    if (sensorKeys.length === 0) {
      return [];
    }
    
    // For each sensor, get its time series data
    const sensorResults = {};
    const timestamps = new Set();
    
    for (const key of sensorKeys) {
      // Extract sensor name from key
      const sensorKey = key.split(':').pop();
      
      // Get range of data for this sensor
      const range = await client.zRangeByScore(key, fromTime, endTime, {
        WITHSCORES: true
      });
      
      // Process and convert range data to the same format as TS.RANGE
      const points = [];
      for (let i = 0; i < range.length; i += 2) {
        const [valueUnit, timestamp] = [range[i], parseInt(range[i + 1])];
        const [value, unit] = valueUnit.split(':');
        
        points.push({
          timestamp,
          value: parseFloat(value),
          unit
        });
        
        timestamps.add(timestamp);
      }
      
      sensorResults[sensorKey] = points;
    }
    
    // Convert to array and sort timestamps
    const sortedTimestamps = [...timestamps].sort();
    
    // Reconstruct the data readings at each timestamp
    return sortedTimestamps.map(timestamp => {
      const reading = {
        device_id: deviceId,
        timestamp: new Date(timestamp).toISOString(),
        sensors: {}
      };
      
      // Add each sensor's value at this timestamp if available
      for (const [sensorKey, points] of Object.entries(sensorResults)) {
        const point = points.find(p => p.timestamp === timestamp);
        if (point) {
          reading.sensors[sensorKey] = {
            value: point.value,
            unit: point.unit
          };
        }
      }
      
      return reading;
    });
  } catch (error) {
    console.error(`Error getting fallback historical data for device ${deviceId}:`, error);
    return [];
  }
}

/**
 * Get historical data for a device
 * @param {string} deviceId - The device ID
 * @param {number} fromTime - Start time in milliseconds
 * @param {number} toTime - End time in milliseconds
 * @returns {Array} - Array of readings
 */
async function getHistoricalDeviceData(deviceId, fromTime, toTime = '+') {
  try {
    const client = await getRedisClient();
    
    // Check if TimeSeries is available
    const useTSDB = await checkTimeSeriesAvailable(client);
    
    if (!useTSDB) {
      // Use fallback method
      return getFallbackHistoricalData(client, deviceId, fromTime, toTime);
    }
    
    // TimeSeries is available, use TS commands
    // Get all sensor keys for this device
    const keys = await client.keys(`device:${deviceId}:sensor:*`);
    
    if (keys.length === 0) {
      return [];
    }
    
    // Get the device's latest data to extract sensor info
    const latestData = await getLatestDeviceData(deviceId);
    if (!latestData) {
      return [];
    }
    
    // For each sensor, get its time series data
    const sensorResults = {};
    const timestamps = new Set();
    
    for (const key of keys) {
      // Extract sensor name from key
      const sensorKey = key.split(':').pop();
      
      // Get range of data for this sensor
      const range = await client.ts.range(key, fromTime, toTime);
      
      // Process and store results
      sensorResults[sensorKey] = range.map(point => ({
        timestamp: point.timestamp,
        value: point.value,
        unit: latestData.sensors[sensorKey]?.unit || 'unknown'
      }));
      
      // Collect all timestamps
      range.forEach(point => timestamps.add(point.timestamp));
    }
    
    // Convert to array and sort timestamps
    const sortedTimestamps = [...timestamps].sort();
    
    // Reconstruct the data readings at each timestamp
    return sortedTimestamps.map(timestamp => {
      const reading = {
        device_id: deviceId,
        timestamp: new Date(timestamp).toISOString(),
        sensors: {}
      };
      
      // Add each sensor's value at this timestamp if available
      for (const [sensorKey, points] of Object.entries(sensorResults)) {
        const point = points.find(p => p.timestamp === timestamp);
        if (point) {
          reading.sensors[sensorKey] = {
            value: point.value,
            unit: point.unit
          };
        }
      }
      
      return reading;
    });
  } catch (error) {
    console.error(`Error getting historical data for device ${deviceId}:`, error);
    return [];
  }
}

/**
 * Get data for a specific date range
 * @param {string} deviceId - The device ID
 * @param {string} startDate - Start date in ISO format
 * @param {string} endDate - End date in ISO format
 * @returns {Array} - Array of readings
 */
async function getDateRangeData(deviceId, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Set to end of day
  
  return getHistoricalDeviceData(
    deviceId, 
    start.getTime(),
    end.getTime()
  );
}

module.exports = {
  saveToRedis,
  getLatestDeviceData,
  getHistoricalDeviceData,
  getDateRangeData
};