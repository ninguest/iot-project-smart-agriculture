// __tests__/redisSensorData.test.js
const { 
  saveToRedis, 
  getLatestDeviceData, 
  getHistoricalDeviceData 
} = require('../redisSensorData');
const { getRedisClient } = require('../redisClient');

// Mock Redis client
jest.mock('../redisClient', () => ({
  getRedisClient: jest.fn()
}));

describe('Redis Sensor Data Functions', () => {
  let mockRedisClient;
  
  beforeEach(() => {
    // Create a mock Redis client with required methods
    mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      lrange: jest.fn().mockResolvedValue([]),
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      quit: jest.fn().mockResolvedValue('OK')
    };
    
    // Set the mock to be returned when getRedisClient is called
    getRedisClient.mockReturnValue(mockRedisClient);
  });
  
  test('saveToRedis should store data correctly', async () => {
    const deviceId = 'test-device';
    const data = { temperature: 22.5, humidity: 55 };
    
    await saveToRedis(deviceId, data);
    
    // Check that the Redis client methods were called correctly
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      `device:${deviceId}:current`, 
      expect.any(String)
    );
    expect(mockRedisClient.lpush).toHaveBeenCalledWith(
      `device:${deviceId}:history`, 
      expect.any(String)
    );
    expect(mockRedisClient.ltrim).toHaveBeenCalledWith(
      `device:${deviceId}:history`, 
      0, 
      99
    );
  });
  
  test('getLatestDeviceData should return latest data', async () => {
    const deviceId = 'test-device';
    const mockData = JSON.stringify({ temperature: 22.5, humidity: 55 });
    
    mockRedisClient.get.mockResolvedValue(mockData);
    
    const result = await getLatestDeviceData(deviceId);
    
    expect(mockRedisClient.get).toHaveBeenCalledWith(`device:${deviceId}:current`);
    expect(result).toEqual(JSON.parse(mockData));
  });
});