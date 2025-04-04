// __tests__/ruleService.test.js
const {
  evaluateCondition,
  executeAction
} = require('../ruleService');

// Mock the action handlers
jest.mock('../mqttService', () => ({
  sendCommand: jest.fn().mockResolvedValue(true)
}));

describe('Rule Service', () => {
  test('evaluateCondition correctly evaluates greater than condition', () => {
    const condition = {
      sensor: 'temperature',
      operator: '>',
      value: 25
    };
    
    const sensorData = {
      temperature: 28
    };
    
    expect(evaluateCondition(condition, sensorData)).toBe(true);
  });
  
  test('executeAction calls sendCommand with correct parameters', async () => {
    const action = {
      type: 'control',
      deviceId: 'test-device',
      component: 'fan',
      action: 'power',
      value: 'on'
    };
    
    await executeAction(action);
    
    const { sendCommand } = require('../mqttService');
    expect(sendCommand).toHaveBeenCalledWith(
      'test-device',
      'fan',
      'power',
      'on'
    );
  });
});