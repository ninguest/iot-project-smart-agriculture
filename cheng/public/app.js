// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  // Initialize socket connection
  const socket = io();
  
  // State
  let selectedDeviceId = null;
  let availableSensors = [];
  let currentChartSensor = null;
  let sensorChart = null;
  let historicalData = [];
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let chartInitialized = false;
  
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
  const chartWrapper = document.getElementById('chartWrapper');

  // Debug function to log element status
  function logElementStatus(id) {
    const el = document.getElementById(id);
    console.log(`Element '${id}': ${el ? 'found' : 'not found'}`);
    if (el) {
      console.log(`- Display: ${window.getComputedStyle(el).display}`);
      console.log(`- Visibility: ${window.getComputedStyle(el).visibility}`);
      console.log(`- Height: ${window.getComputedStyle(el).height}`);
    }
  }

  // Debug chart elements on load
  function debugChartElements() {
    console.log("Debugging chart elements:");
    logElementStatus('sensorChart');
    logElementStatus('chartWrapper');
    logElementStatus('deviceData');
  }
  
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
    reconnectAttempts = 0;
  
    // Refresh data after reconnection
    if (selectedDeviceId) {
      socket.emit('getHistoricalData', selectedDeviceId);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus({ status: 'server-disconnected' });
  });

  socket.on('connect_error', () => {
    reconnectAttempts++;
    console.log(`Connection error (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
    
    if (reconnectAttempts <= maxReconnectAttempts) {
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        socket.connect();
      }, 5000 * reconnectAttempts); // Progressively longer delays
    } else {
      updateConnectionStatus({ status: 'server-disconnected' });
    }
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

  // Add socket handler for extended data
  socket.on('dateRangeData', (response) => {
    console.log('Received date range data:', response);
    if (response.deviceId === selectedDeviceId) {
      updateChartWithHistoricalData(response.data);
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
      historicalData = history.data; // Store the data
      
      // Make sure the chart is initialized before updating it
      if (!chartInitialized && historicalData.length > 0) {
        initializeChart();
      } else {
        updateChartWithHistoricalData(historicalData);
      }
    }
  });

  // Add error handler
  socket.on('error', (error) => {
    console.error('Server error:', error);
    // Could add UI notification here
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
    // Include date if not today
    const today = new Date();
    
    if (date.toDateString() === today.toDateString()) {
      // Same day, just show time
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      // Different day, show date and time
      return date.toLocaleDateString() + ' ' + 
             date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
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
    showLoadingState(); // Show loading indicator

    // Reset chart data
    historicalData = [];
    chartInitialized = false;
    if (sensorChart) {
      sensorChart.destroy();
      sensorChart = null;
    }
    
    // Fetch latest data for this device
    fetch(`/api/current/${deviceId}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Device data not available');
        }
        return response.json();
      })
      .then(data => {
        updateSensorData(data);
        // Request historical data for this device
        socket.emit('getHistoricalData', deviceId);
      })
      .catch(error => {
        console.error('Error fetching device data:', error);
        sensorTiles.innerHTML = '<div class="error-message">Error loading sensor data. Please try again.</div>';
      });
  }
  
  // Update connection status indicator
  function updateConnectionStatus(statusData) {
    if (!statusData) {
      connectionDot.className = '';
      connectionStatus.textContent = 'Unknown';
      return;
    }

    if (statusData.status === 'server-disconnected') {
      connectionDot.className = 'server-offline-dot';
      connectionStatus.textContent = 'Server connection lost. Attempting to reconnect...';
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
    if (currentChartSensor && availableSensors.includes(currentChartSensor)) {
      sensorSelect.value = currentChartSensor;
    } else if (availableSensors.length > 0) {
      currentChartSensor = availableSensors[0];
      sensorSelect.value = currentChartSensor;
    }
    
    // Add change event listener (remove existing first to avoid duplicates)
    sensorSelect.removeEventListener('change', handleSensorChange);
    sensorSelect.addEventListener('change', handleSensorChange);
  }
  
  // Handle sensor change
  function handleSensorChange() {
    currentChartSensor = sensorSelect.value;
    console.log(`Selected sensor changed to: ${currentChartSensor}`);
  
    // If we already have historical data, just update the chart with existing data
    if (historicalData && historicalData.length > 0) {
      updateChartWithHistoricalData(historicalData); 
    } else {
      // Only request data from server if we don't have it
      updateChart();
    }
  }
  
  // Initialize the chart
  function initializeChart() {
    console.log('Initializing chart...');
    
    // First, ensure the chart canvas is available
    const canvas = document.getElementById('sensorChart');
    if (!canvas) {
      console.error('Chart canvas element not found');
      return;
    }
    
    // Ensure deviceData is visible
    deviceData.style.display = 'block';
    
    // Make sure the canvas is visible and has dimensions
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get canvas context');
      return;
    }
    
    // If there's an existing chart, destroy it
    if (sensorChart) {
      console.log('Destroying existing chart instance');
      sensorChart.destroy();
    }
    
    try {
      // Create new chart
      sensorChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: currentChartSensor ? formatSensorName(currentChartSensor) : 'Sensor Data',
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
            },
            tooltip: {
              enabled: true
            }
          }
        }
      });
      
      console.log('Chart initialized successfully');
      chartInitialized = true;
      
      // Add event listener for time range changes
      timeRange.removeEventListener('change', handleTimeRangeChange);
      timeRange.addEventListener('change', handleTimeRangeChange);
      
      // Update chart with historical data if available
      if (historicalData && historicalData.length > 0) {
        updateChartWithHistoricalData(historicalData);
      }
    } catch (error) {
      console.error('Error initializing chart:', error);
    }
  }
  
  // Handle time range change
  function handleTimeRangeChange() {
    console.log(`Time range changed to: ${timeRange.value}`);
    if (historicalData && historicalData.length > 0) {
      updateChartWithHistoricalData(historicalData);
    } else {
      updateChart();
    }
  }
  
  // Update chart with historical data
  function updateChartWithHistoricalData(historyData) {
    if (!sensorChart || !currentChartSensor) {
      console.log('Chart or sensor not initialized, initializing now...');
      if (!chartInitialized) {
        initializeChart();
      }
      return;
    }
    
    // Check if we have valid data
    if (!historyData || historyData.length === 0) {
      console.log('No historical data available');
      return;
    }
    
    // Filter data based on the selected time range
    const filteredData = filterDataByTimeRange(historyData);
    
    console.log(`Filtered data for chart: ${filteredData.length} points`);
    
    // Extract time labels and values for the selected sensor
    const labels = [];
    const values = [];
    let unit = '';
    
    filteredData.forEach(item => {
      if (item.sensors && item.sensors[currentChartSensor]) {
        const date = new Date(item.timestamp);
        labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        values.push(parseFloat(item.sensors[currentChartSensor].value));
        unit = item.sensors[currentChartSensor].unit;
      }
    });
    
    console.log(`Chart data points: ${values.length}`);
    
    try {
      // Update chart data
      sensorChart.data.labels = labels;
      sensorChart.data.datasets[0].data = values;
      
      // Update titles and unit
      sensorChart.data.datasets[0].label = `${formatSensorName(currentChartSensor)} (${unit || ''})`;
      sensorChart.options.scales.y.title.text = unit || 'Value';
      
      // Update the chart
      sensorChart.update();
      console.log('Chart updated successfully');
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }
  
  // Filter data by selected time range
  function filterDataByTimeRange(data) {
    const selectedRange = timeRange.value;
    const now = new Date();
    
    // Return all data if "all" is selected
    if (selectedRange === 'all') {
      return data;
    }
    
    // For newest 20 points, sort by timestamp and take the last 20
    if (selectedRange === 'newest20') {
      // Sort data by timestamp (oldest to newest)
      const sortedData = [...data].sort((a, b) => {
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      // Return the newest 20 points or all if less than 20
      return sortedData.slice(-20);
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
      } else if (selectedRange === 'week') {
        return diffHours <= 168; // 24 * 7 = 168 hours in a week
      } else if (selectedRange === 'month') {
        return diffHours <= 720; // Approximately 30 days
      }
      
      // Default case, return all data
      return true;
    });
  }
  
  // Update chart based on selected sensor and time range
  function updateChart() {
    console.log(`Requesting historical data for device: ${selectedDeviceId}`);
    if (selectedDeviceId) {
      socket.emit('getHistoricalData', selectedDeviceId);
    } else {
      console.error('No device selected');
    }
  }

  // Load extended date range data (for advanced charting)
  function loadExtendedData(startDate, endDate) {
    if (!selectedDeviceId) return;
    
    // Format dates as YYYY-MM-DD
    const formatDateParam = (date) => {
      return date.toISOString().split('T')[0];
    };
    
    // Either use socket or fetch API
    socket.emit('getDateRangeData', {
      deviceId: selectedDeviceId,
      startDate: formatDateParam(startDate),
      endDate: formatDateParam(endDate)
    });
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

  function showLoadingState() {
    sensorTiles.innerHTML = '<div class="loading-indicator">Loading sensor data...</div>';
  }
  
  // Run debug checks
  setTimeout(debugChartElements, 2000);
});