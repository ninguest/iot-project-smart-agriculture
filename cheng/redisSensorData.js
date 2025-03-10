// redisSensorData.js
const { getRedisClient } = require('./redisClient');
const { retentionPeriod } = require('./redisConfig');

/**
 * Save sensor data to Redis TimeSeries
 * @param {string} deviceId - The device ID
 * @param {Object} data - The sensor data object
 */
async function saveToRedis(deviceId, data) {
  try {
    const client = await getRedisClient();
    const timestamp = new Date(data.timestamp).getTime(); // Convert to milliseconds

    // Store each sensor in its own time series
    for (const [sensorKey, sensorData] of Object.entries(data.sensors)) {
      const key = `device:${deviceId}:sensor:${sensorKey}`;
      const value = parseFloat(sensorData.value);
      
      // Create the time series if it doesn't exist
      try {
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
    
    // Also store the full JSON of the latest reading for each device
    await client.json.set(`device:${deviceId}:latest`, '$', data);
    
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
    const latest = await client.json.get(`device:${deviceId}:latest`);
    return latest;
  } catch (error) {
    console.error(`Error getting latest data for device ${deviceId}:`, error);
    return null;
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
    
    // Get all sensor keys for this device
    const keys = await client.keys(`device:${deviceId}:sensor:*`);
    
    if (keys.length === 0) {
      return [];
    }
    
    // Get the device's latest data to extract sensor info
    const latestData = await client.json.get(`device:${deviceId}:latest`);
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