const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data storage
const dataFile = path.join(__dirname, 'sensor_data.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, JSON.stringify({ 
    readings: [],
    air_velocity: [],
    co2: [],
    temperature: [],
    humidity: []
  }));
}

// Helper function to read data
function readData() {
  const rawData = fs.readFileSync(dataFile);
  return JSON.parse(rawData);
}

// Helper function to write data
function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// Helper function to validate and format timestamp
function validateTimestamp(timestamp) {
    if (!timestamp) return Date.now();
    
    // Check if timestamp is in seconds (MicroPython's time.time() returns seconds)
    // A typical millisecond timestamp would be > 1000000000000 (year 2001)
    if (timestamp < 20000000000) {
        // Convert from seconds to milliseconds
        timestamp = timestamp * 1000;
    }
    
    const parsed = new Date(timestamp).getTime();
    return !isNaN(parsed) ? parsed : Date.now();
}

// API Endpoint to receive all sensor data
app.post('/sensors', (req, res) => {
  try {
    const { device_id, sensors } = req.body;
    
    // Validate required fields
    if (!sensors || typeof sensors !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid sensors data' });
    }
    
    // Create reading object with server timestamp
    const serverTimestamp = Date.now();
    const reading = {
      device_id: device_id || 'unknown',
      timestamp: serverTimestamp,
      received_at: serverTimestamp,
      sensors: {} // Will store all sensor data
    };
    
    // Process each sensor type
    const data = readData();
    
    // Add each sensor's data to the combined reading and to individual sensor arrays
    if (sensors.air_velocity) {
      reading.sensors.air_velocity = {
        value: sensors.air_velocity.value,
        unit: sensors.air_velocity.unit || 'm/s'
      };
      
      // Also store in dedicated air_velocity array
      data.air_velocity.push({
        value: sensors.air_velocity.value,
        unit: sensors.air_velocity.unit || 'm/s',
        device_id: device_id || 'unknown',
        timestamp: serverTimestamp
      });
    }
    
    if (sensors.co2) {
      console.log("Received CO2 data:", JSON.stringify(sensors.co2));
      
      // Validate CO2 value - must be a number and not undefined
      const co2Value = sensors.co2.value;
      console.log("CO2 raw value:", co2Value, "Type:", typeof co2Value);
      
      // If the value is zero or falsy but a valid number, still process it
      // This ensures we don't skip legitimate zero readings
      if (co2Value !== undefined && (!isNaN(parseFloat(co2Value)) || co2Value === 0)) {
        // Make sure we store as a number
        const parsedValue = parseFloat(co2Value);
        console.log("Storing CO2 value:", parsedValue);
        
        reading.sensors.co2 = {
          value: parsedValue,
          unit: sensors.co2.unit || 'ppm'
        };
        
        // Store in dedicated co2 array
        data.co2.push({
          value: parsedValue,
          unit: sensors.co2.unit || 'ppm',
          device_id: device_id || 'unknown',
          timestamp: serverTimestamp
        });
      } else {
        console.warn("Invalid CO2 value received:", co2Value);
      }
    }
    
    if (sensors.temperature) {
      reading.sensors.temperature = {
        value: sensors.temperature.value,
        unit: sensors.temperature.unit || 'C'
      };
      
      // Store in dedicated temperature array
      data.temperature.push({
        value: sensors.temperature.value,
        unit: sensors.temperature.unit || 'C',
        device_id: device_id || 'unknown',
        timestamp: serverTimestamp
      });
    }
    
    if (sensors.humidity) {
      reading.sensors.humidity = {
        value: sensors.humidity.value,
        unit: sensors.humidity.unit || '%'
      };
      
      // Store in dedicated humidity array
      data.humidity.push({
        value: sensors.humidity.value,
        unit: sensors.humidity.unit || '%',
        device_id: device_id || 'unknown',
        timestamp: serverTimestamp
      });
    }
    
    // Save the combined reading to the readings array
    data.readings.push(reading);
    
    // Limit array sizes to prevent file from growing too large
    const MAX_READINGS = 1000;
    if (data.readings.length > MAX_READINGS) {
      data.readings = data.readings.slice(-MAX_READINGS);
    }
    if (data.air_velocity.length > MAX_READINGS) {
      data.air_velocity = data.air_velocity.slice(-MAX_READINGS);
    }
    if (data.co2.length > MAX_READINGS) {
      data.co2 = data.co2.slice(-MAX_READINGS);
    }
    if (data.temperature.length > MAX_READINGS) {
      data.temperature = data.temperature.slice(-MAX_READINGS);
    }
    if (data.humidity.length > MAX_READINGS) {
      data.humidity = data.humidity.slice(-MAX_READINGS);
    }
    
    // Save to data file
    writeData(data);
    
    // Log the received data
    console.log(`Received data from ${device_id || 'unknown'} at ${new Date(reading.timestamp).toLocaleString()}`);
    console.log(JSON.stringify(sensors, null, 2));
    
    return res.status(200).json({ success: true, message: 'Data received' });
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Maintaining backward compatibility for air velocity endpoint
app.post('/airvelocity', (req, res) => {
  try {
    const { air_velocity, device_id, unit } = req.body;
    
    // Validate required fields
    if (air_velocity === undefined) {
      return res.status(400).json({ error: 'Missing air_velocity data' });
    }
    
    // Create sensors object in the format expected by the /sensors endpoint
    const sensorData = {
      device_id: device_id || 'unknown',
      sensors: {
        air_velocity: {
          value: air_velocity,
          unit: unit || 'm/s'
        }
      }
    };
    
    // Forward to the main sensors endpoint handler
    req.body = sensorData;
    
    // Call the sensors endpoint
    app.handle(req, res);
    
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint to get all readings
app.get('/readings', (req, res) => {
  try {
    const data = readData();
    res.status(200).json(data.readings);
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint to get latest reading with all sensors
app.get('/readings/latest', (req, res) => {
  try {
    const data = readData();
    const latest = data.readings.length > 0 
      ? data.readings[data.readings.length - 1] 
      : null;
    
    res.status(200).json({ latest });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint to get air velocity readings (for backward compatibility)
app.get('/airvelocity', (req, res) => {
  try {
    const data = readData();
    res.status(200).json({ readings: data.air_velocity });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint to get latest air velocity (for backward compatibility)
app.get('/airvelocity/latest', (req, res) => {
  try {
    const data = readData();
    const latest = data.air_velocity.length > 0 
      ? data.air_velocity[data.air_velocity.length - 1] 
      : null;
    
    res.status(200).json({ latest });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// New endpoints for specific sensor types
app.get('/co2', (req, res) => {
  try {
    const data = readData();
    res.status(200).json({ readings: data.co2 });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/co2/latest', (req, res) => {
  try {
    const data = readData();
    const latest = data.co2.length > 0 
      ? data.co2[data.co2.length - 1] 
      : null;
    
    res.status(200).json({ latest });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/temperature', (req, res) => {
  try {
    const data = readData();
    res.status(200).json({ readings: data.temperature });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/temperature/latest', (req, res) => {
  try {
    const data = readData();
    const latest = data.temperature.length > 0 
      ? data.temperature[data.temperature.length - 1] 
      : null;
    
    res.status(200).json({ latest });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/humidity', (req, res) => {
  try {
    const data = readData();
    res.status(200).json({ readings: data.humidity });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/humidity/latest', (req, res) => {
  try {
    const data = readData();
    const latest = data.humidity.length > 0 
      ? data.humidity[data.humidity.length - 1] 
      : null;
    
    res.status(200).json({ latest });
  } catch (error) {
    console.error('Error retrieving data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve the dashboard HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});