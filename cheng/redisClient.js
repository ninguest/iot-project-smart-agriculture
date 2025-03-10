// redisClient.js
const { createClient } = require('redis');
const { url } = require('./redisConfig');

let client = null;

async function getRedisClient() {
  if (client === null) {
    client = createClient({
      url: url
    });

    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    await client.connect();
    console.log('Connected to Redis');
  }
  
  return client;
}

module.exports = { getRedisClient };