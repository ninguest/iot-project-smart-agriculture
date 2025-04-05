// redisClient.js
const { createClient } = require('redis');
const { url } = require('./redisConfig');

let client = null;

async function getRedisClient() {
  if (client === null) {
    try {
      client = createClient({
        url: url
      });

      client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      await client.connect();
      console.log('Connected to Redis');
      
      // Check if Redis modules are available
      try {
        // Check for RedisTimeSeries
        await client.sendCommand(['MODULE', 'LIST']).then(modules => {
          const hasTimeSeries = modules.some(module => 
            module.includes('timeseries') || module.includes('TIMESERIES')
          );
          
          if (!hasTimeSeries) {
            console.warn('Redis TimeSeries module is not available. Some functionality will be limited.');
          } else {
            console.log('Redis TimeSeries module is available.');
          }
          
          const hasRedisJSON = modules.some(module => 
            module.includes('ReJSON') || module.includes('REJSON')
          );
          
          if (!hasRedisJSON) {
            console.warn('RedisJSON module is not available. Some functionality will be limited.');
          } else {
            console.log('RedisJSON module is available.');
          }
        });
      } catch (error) {
        console.warn('Unable to check Redis modules:', error.message);
      }
    } catch (error) {
      console.error('Failed to create Redis client:', error);
      throw error;
    }
  }
  
  return client;
}

module.exports = { getRedisClient };