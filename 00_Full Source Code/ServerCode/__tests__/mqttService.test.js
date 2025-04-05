// __tests__/mqttService.test.js
const { 
  sendCommand,
  broadcastCommand
} = require('../mqttService');

// Mock the MQTT client
jest.mock('mqtt', () => ({
  connect: jest.fn().mockReturnValue({
    on: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(),
    end: jest.fn()
  })
}));

describe('MQTT Service', () => {
  let mockClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = require('mqtt').connect();
  });
  
  test('sendCommand should publish message to correct topic', () => {
    const deviceId = 'test-device';
    const component = 'fan';
    const action = 'power';
    const value = 'on';
    
    sendCommand(deviceId, component, action, value);
    
    expect(mockClient.publish).toHaveBeenCalledWith(
      `ycstation/devices/${deviceId}/commands`,
      expect.stringContaining(component),
      expect.any(Object)
    );
  });
});