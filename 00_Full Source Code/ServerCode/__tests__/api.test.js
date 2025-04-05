// __tests__/api.test.js
const request = require('supertest');
const express = require('express');
const app = require('../server'); // Export your Express app for testing

describe('API Endpoints', () => {
  test('POST /sensors should accept valid sensor data', async () => {
    const response = await request(app)
      .post('/sensors')
      .send({
        device_id: 'test-device',
        sensors: {
          temperature: 22.5,
          humidity: 55,
          light: 800
        }
      });
      
    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });
  
  test('POST /sensors should reject invalid data', async () => {
    const response = await request(app)
      .post('/sensors')
      .send({
        // Missing required fields
        sensors: {
          temperature: 22.5
        }
      });
      
    expect(response.statusCode).toBe(400);
  });
});