// __tests__/integration.test.js
const request = require('supertest');
const app = require('../server');
const mqtt = require('mqtt');

jest.mock('mqtt');

// This test requires a running Redis instance
describe('End-to-End Workflow', () => {
  test('Sensor data submission triggers rule execution', async () => {
    // 1. Create a test rule
    await request(app)
      .post('/api/rules')
      .send({
        name: 'Test Rule',
        deviceId: 'test-device',
        conditions: [{
          sensor: 'temperature',
          operator: '>',
          value: 25
        }],
        actions: [{
          type: 'control',
          deviceId: 'test-device',
          component: 'fan',
          action: 'power',
          value: 'on'
        }],
        enabled: true
      });
    
    // 2. Submit sensor data that should trigger the rule
    await request(app)
      .post('/sensors')
      .send({
        device_id: 'test-device',
        sensors: {
          temperature: 26
        }
      });
    
    // 3. Verify that the command was sent via MQTT
    const mockPublish = mqtt.connect().publish;
    expect(mockPublish).toHaveBeenCalledWith(
      expect.stringContaining('test-device'),
      expect.stringContaining('fan'),
      expect.any(Object)
    );
  });
});