// redisConfig.js
module.exports = {
    url: 'redis://localhost:6379',
    // For production with password:
    // url: 'redis://username:password@your-redis-server:6379',
    
    // Retention period in milliseconds (30 days)
    retentionPeriod: 30 * 24 * 60 * 60 * 1000 
};