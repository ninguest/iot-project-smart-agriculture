// __tests__/dashboard.test.js
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/dom';
import fs from 'fs';
import path from 'path';

// Load the HTML file
document.body.innerHTML = fs.readFileSync(
  path.resolve(__dirname, '../public/index.html'),
  'utf8'
);

// Mock socket.io
window.io = jest.fn().mockReturnValue({
  on: jest.fn(),
  emit: jest.fn()
});

// Import the script after DOM is ready
require('../public/app.js');

describe('Dashboard UI', () => {
  test('Should display device data when received', async () => {
    // Find socket.io handler
    const socketHandlers = {};
    window.io().on.mockImplementation((event, handler) => {
      socketHandlers[event] = handler;
    });
    
    // Simulate receiving data
    socketHandlers.sensorUpdate({
      deviceId: 'test-device',
      data: {
        device_id: 'test-device',
        sensors: {
          temperature: 22.5
        },
        timestamp: new Date().toISOString()
      }
    });
    
    await waitFor(() => {
      // Check if the UI was updated
      expect(screen.getByText(/22.5/)).toBeInTheDocument();
    });
  });
});