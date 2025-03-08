// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket connection
  const socket = io();
  
  // State
  let selectedDeviceId = null;
  let availableSensors = [];
  let currentChartSensor = null;
  let sensorChart = null;
  
  // DOM elements
  const deviceList = document.getElementById('deviceList');
  const noDeviceSelected = document.getElementById('noDeviceSelected');
  const deviceData = document.getElementById('deviceData');
  const selectedDeviceTitle = document.getElementById('selectedDeviceTitle');
  const connectionDot = document.getElementById('connectionDot');
  const connectionStatus = document.getElementById('connectionStatus');
  const sensorTiles = document.getElementById('sensorTiles');
  const sensorSelect = document.getElementById('sensorSelect');
  const timeRange = document.getElementById('timeRange');
  const currentTime = document.getElementById('currentTime');
  const currentDate = document.getElementById('currentDate');
  
  // Update the clock
  function updateClock() {
    const now = new Date();
    currentTime.textContent = now.toLocaleTimeString();
    currentDate.textContent = now.toLocaleDateString(undefined, { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
  
  // Update clock immediately and then every second
  updateClock();
  setInterval(updateClock, 1000);
  
  // Socket events
  socket.on('connect', () => {
    console.log('Connected to server');
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
  
  // Handle initial data when connecting
  socket.on('initialData', (data) => {
    console.log('Received initial data:', data);
    updateDeviceList(Object.keys(data), {});
    
    // If we have a previously selected device, update its data
    if (selectedDeviceId && data[selectedDeviceId]) {
      updateSensorData(data[selectedDeviceId]);
    }
  });
  
  // Handle device status updates
  socket.on('deviceStatus', (statusData) => {
    console.log('Device status update:', statusData);
    updateDeviceList(Object.keys(statusData), statusData);
    
    // Update connection status for selected device
    if (selectedDeviceId) {
      updateConnectionStatus(statusData[selectedDeviceId]);
    }
  });
  
  // Handle new sensor data
  socket.on('sensorUpdate', (update) => {
    console.log('Sensor update:', update);
    
    // Update UI if this is for the selected device
    if (selectedDeviceId === update.deviceId) {
      updateSensorData(update.data);
      updateChart();
    }
  });
  
  // Handle historical data response
  socket.on('historicalData', (history) => {
    console.log('Received historical data:', history);
    if (history.deviceId === selectedDeviceId) {
      updateChartWithHistoricalData(history.data);
    }
  });
  
  // Update the device list in the sidebar
  function updateDeviceList(deviceIds, statusData) {
    // Clear existing list except for the "no devices" message
    const noDevicesElement = deviceList.querySelector('.no-devices');
    deviceList.innerHTML = '';
    
    if (deviceIds.length === 0) {
      deviceList.appendChild(noDevicesElement);
      return;
    }
    
    deviceIds.forEach(deviceId => {
      const deviceElement = document.createElement('div');
      deviceElement.classList.add('device-item');
      if (deviceId === selectedDeviceId) {
        deviceElement.classList.add('selected');
      }
      
      const statusDot = document.createElement('div');
      statusDot.classList.add('device-status');
      
      if (statusData[deviceId]) {
        statusDot.classList.add(
          statusData[deviceId].status === 'online' ? 'status-online' : 'status-offline'
        );
      }
      
      const deviceInfo = document.createElement('div');
      deviceInfo.classList.add('device-info');
      
      const deviceName = document.createElement('div');
      deviceName.classList.add('device-name');
      deviceName.textContent = formatDeviceId(deviceId);
      
      const lastSeen = document.createElement('div');
      lastSeen.classList.add('device-last-seen');
      if (statusData[deviceId] && statusData[deviceId].lastSeen) {
        lastSeen.textContent = `Last seen: ${formatTimestamp(statusData[deviceId].lastSeen)}`;
      } else {
        lastSeen.textContent = 'No data yet';
      }
      
      deviceInfo.appendChild(deviceName);
      deviceInfo.appendChild(lastSeen);
      
      deviceElement.appendChild(statusDot);
      deviceElement.appendChild(deviceInfo);
      
      // Add click event to select this device
      deviceElement.addEventListener('click', () => {
        selectDevice(deviceId);
      });
      
      deviceList.appendChild(deviceElement);
    });
  }
  
  // Format device ID for display (make it more readable)
  function formatDeviceId(deviceId) {
    // Replace underscores with spaces and capitalize each word
    return deviceId
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }
  
  // Format timestamp for display
  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // Select a device and show its data
  function selectDevice(deviceId) {
    // Update selected state in device list
    const deviceItems = deviceList.querySelectorAll('.device-item');
    deviceItems.forEach(item => {
      item.classList.remove('selected');
      if (item.querySelector('.device-name').textContent === formatDeviceId(deviceId)) {
        item.classList.add('selected');
      }
    });
    
    selectedDeviceId = deviceId;
    selectedDeviceTitle.textContent = `${formatDeviceId(deviceId)} Data`;
    
    // Show the device data section and hide the placeholder
    noDeviceSelected.style.display = 'none';
    deviceData.style.display = 'block';
    
    // Reset sensors for this device
    availableSensors = [];
    sensorTiles.innerHTML = '';
    
    // Fetch latest data for this device
    fetch(`/api/current/${deviceId}`)
      .then(response => response.json())
      .then(data => {
        updateSensorData(data);
        // Request historical data for this device
        socket.emit('getHistoricalData', deviceId);
      })
      .catch(error => {
        console.error('Error fetching device data:', error);
      });
  }
  
  // Update connection status indicator
  function updateConnectionStatus(statusData) {
    if (!statusData) {
      connectionDot.className = '';
      connectionStatus.textContent = 'Unknown';
      return;
    }
    
    const isOnline = statusData.status === 'online';
    connectionDot.className = isOnline ? 'online-dot' : 'offline-dot';
    connectionStatus.textContent = isOnline ? 'Online' : 'Offline';
    
    if (!isOnline) {
      connectionStatus.textContent += ` (Last seen: ${formatTimestamp(statusData.lastSeen)})`;
    }
  }
  
  // Update sensor data display
  function updateSensorData(data) {
    if (!data || !data.sensors) {
      return;
    }
    
    // Clear existing tiles
    sensorTiles.innerHTML = '';
    
    // Reset available sensors
    availableSensors = [];
    
    // Create a tile for each sensor
    Object.entries(data.sensors).forEach(([sensorKey, sensorData]) => {
      // Add to available sensors list
      availableSensors.push(sensorKey);
      
      // Create tile
      const tile = document.createElement('div');
      tile.classList.add('sensor-tile');
      
      const nameElement = document.createElement('div');
      nameElement.classList.add('sensor-name');
      
      // Add icon based on sensor type
      const icon = document.createElement('i');
      if (sensorKey.includes('temperature')) {
        icon.className = 'fas fa-thermometer-half';
      } else if (sensorKey.includes('humidity')) {
        icon.className = 'fas fa-tint';
      } else if (sensorKey.includes('co2')) {
        icon.className = 'fas fa-cloud';
      } else if (sensorKey.includes('velocity') || sensorKey.includes('wind') || sensorKey.includes('air')) {
        icon.className = 'fas fa-wind';
      } else if (sensorKey.includes('pressure')) {
        icon.className = 'fas fa-compress-alt';
      } else if (sensorKey.includes('light')) {
        icon.className = 'fas fa-sun';
      } else {
        icon.className = 'fas fa-chart-line';
      }
      
      nameElement.appendChild(icon);
      nameElement.appendChild(document.createTextNode(formatSensorName(sensorKey)));
      
      const valueContainer = document.createElement('div');
      valueContainer.classList.add('value-container');
      
      const valueElement = document.createElement('span');
      valueElement.classList.add('sensor-value');
      valueElement.textContent = sensorData.value;
      
      const unitElement = document.createElement('span');
      unitElement.classList.add('sensor-unit');
      unitElement.textContent = sensorData.unit;
      
      valueContainer.appendChild(valueElement);
      valueContainer.appendChild(unitElement);
      
      tile.appendChild(nameElement);
      tile.appendChild(valueContainer);
      
      sensorTiles.appendChild(tile);
    });
    
    // Update sensor dropdown for chart
    updateSensorDropdown();
    
    // Initialize chart if we have sensors and no chart yet
    if (availableSensors.length > 0 && !currentChartSensor) {
      currentChartSensor = availableSensors[0];
      initializeChart();
    }
  }
  
  // Format sensor name for display
  function formatSensorName(sensorKey) {
    return sensorKey
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }
  
  // Update the sensor dropdown for the chart
  function updateSensorDropdown() {
    // Clear existing options
    sensorSelect.innerHTML = '';
    
    // Add an option for each available sensor
    availableSensors.forEach(sensor => {
      const option = document.createElement('option');
      option.value = sensor;
      option.textContent = formatSensorName(sensor);
      sensorSelect.appendChild(option);
    });
    
    // Set current selection if it exists
    if (currentChartSensor) {
      sensorSelect.value = currentChartSensor;
    } else if (availableSensors.length > 0) {
      currentChartSensor = availableSensors[0];
      sensorSelect.value = currentChartSensor;
    }
    
    // Add change event listener
    sensorSelect.addEventListener('change', () => {
      currentChartSensor = sensorSelect.value;
      updateChart();
    });
  }
  
  // Initialize the chart
  function initializeChart() {
    const ctx = document.getElementById('sensorChart').getContext('2d');
    
    sensorChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: formatSensorName(currentChartSensor),
          data: [],
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Value'
            },
            beginAtZero: false
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          }
        }
      }
    });
    
    // Add event listener for time range changes
    timeRange.addEventListener('change', updateChart);
    
    // Request historical data
    socket.emit('getHistoricalData', selectedDeviceId);
  }
  
  // Update chart with historical data
  function updateChartWithHistoricalData(historyData) {
    if (!sensorChart || !currentChartSensor) return;
    
    // Filter data based on the selected time range
    const filteredData = filterDataByTimeRange(historyData);
    
    // Extract time labels and values for the selected sensor
    const labels = [];
    const values = [];
    const units = [];
    
    filteredData.forEach(item => {
      if (item.sensors && item.sensors[currentChartSensor]) {
        const date = new Date(item.timestamp);
        labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        values.push(item.sensors[currentChartSensor].value);
        units.push(item.sensors[currentChartSensor].unit);
      }
    });
    
    // Update chart
    sensorChart.data.labels = labels;
    sensorChart.data.datasets[0].data = values;
    sensorChart.data.datasets[0].label = `${formatSensorName(currentChartSensor)} (${units[0] || ''})`;
    
    // Update y-axis title
    sensorChart.options.scales.y.title.text = units[0] || 'Value';
    
    sensorChart.update();
  }
  
  // Filter data by selected time range
  function filterDataByTimeRange(data) {
    const selectedRange = timeRange.value;
    const now = new Date();
    
    // Return all data if "all" is selected
    if (selectedRange === 'all') {
      return data;
    }
    
    // Filter based on selected time range
    return data.filter(item => {
      const itemDate = new Date(item.timestamp);
      const diffMs = now - itemDate;
      const diffHours = diffMs / (1000 * 60 * 60);
      
      if (selectedRange === 'hour') {
        return diffHours <= 1;
      } else if (selectedRange === 'day') {
        return diffHours <= 24;
      }
      
      // Default case, return all data
      return true;
    });
  }
  
  // Update chart based on selected sensor and time range
  function updateChart() {
    if (selectedDeviceId) {
      socket.emit('getHistoricalData', selectedDeviceId);
    }
  }
  
  // Format date for relative time display
  function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) {
      return 'just now';
    } else if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffSec / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  }
});