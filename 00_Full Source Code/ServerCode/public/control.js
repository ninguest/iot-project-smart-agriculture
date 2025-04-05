// public/control.js
document.addEventListener('DOMContentLoaded', () => {
    // Initialize socket connection
    const socket = io();
    
    // State
    let picoDevices = [];
    let selectedControlDevice = null;
    
    // DOM elements
    const controlDeviceList = document.getElementById('controlDeviceList');
    const deviceControlContent = document.getElementById('deviceControlContent');
    const noControlDeviceSelected = document.getElementById('noControlDeviceSelected');
    const selectedControlDeviceTitle = document.getElementById('selectedControlDeviceTitle');
    const controlConnectionDot = document.getElementById('controlConnectionDot');
    const controlConnectionStatus = document.getElementById('controlConnectionStatus');
    const deviceCapabilities = document.getElementById('deviceCapabilities');
    const refreshButton = document.getElementById('refreshDevices');
    const broadcastForm = document.getElementById('broadcastForm');
    const currentTime = document.getElementById('currentTime');
    const currentDate = document.getElementById('currentDate');
    
    // Initialize the control panel
    initControlPanel();
    
    function initControlPanel() {
        // Update clock
        updateClock();
        setInterval(updateClock, 1000);
        
        // Load connected Pico W devices
        loadPicoDevices();
        
        // Set up event listeners
        if (refreshButton) {
            refreshButton.addEventListener('click', loadPicoDevices);
        }
        
        if (broadcastForm) {
            broadcastForm.addEventListener('submit', handleBroadcast);
        }
        
        // Set up socket listeners
        socket.on('connect', () => {
            console.log('Connected to server');
            // Refresh data on reconnection
            loadPicoDevices();
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            showNotification('Server connection lost', 'error');
        });
        
        socket.on('picoDevices', handlePicoDevicesUpdate);
        socket.on('commandResult', handleCommandResult);
        socket.on('broadcastResult', handleBroadcastResult);
        
        // Request device updates periodically
        setInterval(() => {
            if (socket.connected) {
                socket.emit('getPicoDevices');
            }
        }, 30000); // Every 30 seconds
    }
    
    // Update the clock
    function updateClock() {
        const now = new Date();
        if (currentTime) {
            currentTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (currentDate) {
            currentDate.textContent = now.toLocaleDateString(undefined, { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
        }
    }
    
    // Load Pico W devices
    function loadPicoDevices() {
        if (socket.connected) {
            socket.emit('getPicoDevices');
            
            // Show loading state
            if (controlDeviceList) {
                controlDeviceList.innerHTML = '<div class="loading-indicator">Loading devices...</div>';
            }
        } else {
            showNotification('Not connected to server', 'error');
        }
    }
    
    // Handle update of Pico devices
    function handlePicoDevicesUpdate(devices) {
        picoDevices = devices;
        updateDeviceList();
        
        // If we have a selected device, refresh its control panel
        if (selectedControlDevice) {
            const device = picoDevices.find(d => d.device_id === selectedControlDevice);
            if (device) {
                updateControlPanel(device);
            } else {
                // Selected device is no longer available
                selectedControlDevice = null;
                showNoDeviceSelected();
            }
        }
    }
    
    // Update the device list
    function updateDeviceList() {
        if (!controlDeviceList) return;
        
        // Clear existing list
        controlDeviceList.innerHTML = '';
        
        const noDevicesElement = document.createElement('div');
        noDevicesElement.className = 'no-devices';
        noDevicesElement.textContent = 'No controllable devices connected';
        
        if (picoDevices.length === 0) {
            controlDeviceList.appendChild(noDevicesElement);
            return;
        }
        
        // Create a list item for each device
        picoDevices.forEach(device => {
            const deviceElement = document.createElement('div');
            deviceElement.classList.add('device-item');
            if (device.device_id === selectedControlDevice) {
                deviceElement.classList.add('selected');
            }
            
            const statusDot = document.createElement('div');
            statusDot.classList.add('device-status');
            statusDot.classList.add(device.status === 'online' ? 'status-online' : 'status-offline');
            
            const deviceInfo = document.createElement('div');
            deviceInfo.classList.add('device-info');
            
            const deviceName = document.createElement('div');
            deviceName.classList.add('device-name');
            deviceName.textContent = formatDeviceId(device.device_id);
            
            const lastSeen = document.createElement('div');
            lastSeen.classList.add('device-last-seen');
            lastSeen.textContent = `Last seen: ${formatTimestamp(device.lastSeen)}`;
            
            deviceInfo.appendChild(deviceName);
            deviceInfo.appendChild(lastSeen);
            
            deviceElement.appendChild(statusDot);
            deviceElement.appendChild(deviceInfo);
            
            // Add click event to select this device
            deviceElement.addEventListener('click', () => {
                selectControlDevice(device.device_id);
            });
            
            controlDeviceList.appendChild(deviceElement);
        });
    }
    
    // Select a device for control
    function selectControlDevice(deviceId) {
        // Update selected state in device list
        const deviceItems = controlDeviceList.querySelectorAll('.device-item');
        deviceItems.forEach(item => {
            item.classList.remove('selected');
            if (item.querySelector('.device-name').textContent === formatDeviceId(deviceId)) {
                item.classList.add('selected');
            }
        });
        
        selectedControlDevice = deviceId;
        
        // Find the device
        const device = picoDevices.find(d => d.device_id === deviceId);
        if (!device) return;
        
        // Update control panel
        updateControlPanel(device);
    }
    
    // Show the "no device selected" message
    function showNoDeviceSelected() {
        if (noControlDeviceSelected) noControlDeviceSelected.style.display = 'flex';
        if (deviceControlContent) deviceControlContent.style.display = 'none';
    }
    
    // Update the control panel for a device
    function updateControlPanel(device) {
        if (!deviceControlContent || !noControlDeviceSelected) return;
        
        // Hide the placeholder and show the control panel
        noControlDeviceSelected.style.display = 'none';
        deviceControlContent.style.display = 'block';
        
        // Update title and status
        if (selectedControlDeviceTitle) {
            selectedControlDeviceTitle.textContent = formatDeviceId(device.device_id);
        }
        
        // Update connection status
        updateControlConnectionStatus(device);
        
        // Update capabilities
        updateCapabilitiesPanel(device);
    }
    
    // Update the connection status indicator for the control panel
    function updateControlConnectionStatus(device) {
        if (!controlConnectionDot || !controlConnectionStatus) return;
        
        const isOnline = device.status === 'online';
        controlConnectionDot.className = isOnline ? 'online-dot' : 'offline-dot';
        controlConnectionStatus.textContent = isOnline ? 'Online' : 'Offline';
        
        if (!isOnline) {
            controlConnectionStatus.textContent += ` (Last seen: ${formatTimestamp(device.lastSeen)})`;
        }
    }
    
    // Update the capabilities control panel
    function updateCapabilitiesPanel(device) {
        if (!deviceCapabilities) return;
        
        // Clear existing controls
        deviceCapabilities.innerHTML = '';
        
        if (!device.capabilities || device.capabilities.length === 0) {
            deviceCapabilities.innerHTML = '<div class="no-capabilities">This device has no controllable components</div>';
            return;
        }
        
        // Create controls for each capability
        device.capabilities.forEach(capability => {
            const control = createCapabilityControl(device.device_id, capability, device.components?.[capability]);
            deviceCapabilities.appendChild(control);
        });
    }
    
    // Create controls for a specific capability
    function createCapabilityControl(deviceId, capability, currentState) {
        const controlContainer = document.createElement('div');
        controlContainer.className = 'capability-control';
        
        const label = document.createElement('label');
        label.textContent = formatCapabilityName(capability);
        
        controlContainer.appendChild(label);
        
        // Create appropriate control based on capability type
        switch (capability) {
            case 'fan':
                controlContainer.appendChild(createFanControl(deviceId, currentState));
                break;
                
            case 'led':
            case 'rgb_led':
                controlContainer.appendChild(createLedControl(deviceId, capability, currentState));
                break;
                
            case 'pump':
            case 'water_pump':
                controlContainer.appendChild(createPumpControl(deviceId, currentState));
                break;
                
            default:
                // Generic on/off control for unknown capabilities
                controlContainer.appendChild(createOnOffControl(deviceId, capability, currentState));
        }
        
        return controlContainer;
    }
    
    // Create fan control (speed slider + on/off)
    function createFanControl(deviceId, currentState) {
        const container = document.createElement('div');
        container.className = 'fan-control';
        
        // On/Off toggle
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'toggle-container';
        
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Power:';
        
        const toggle = document.createElement('button');
        toggle.className = `toggle-button ${currentState?.power === 'on' ? 'active' : ''}`;
        toggle.textContent = currentState?.power === 'on' ? 'ON' : 'OFF';
        toggle.addEventListener('click', () => {
            const newState = toggle.classList.contains('active') ? 'off' : 'on';
            sendCommand(deviceId, 'fan', 'power', newState);
        });
        
        toggleContainer.appendChild(toggleLabel);
        toggleContainer.appendChild(toggle);
        
        // Speed slider
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'slider-container';
        
        const sliderLabel = document.createElement('span');
        sliderLabel.textContent = 'Speed:';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = currentState?.speed || '50';
        slider.addEventListener('change', () => {
            sendCommand(deviceId, 'fan', 'speed', parseInt(slider.value));
        });
        
        const sliderValue = document.createElement('span');
        sliderValue.className = 'slider-value';
        sliderValue.textContent = `${slider.value}%`;
        
        slider.addEventListener('input', () => {
            sliderValue.textContent = `${slider.value}%`;
        });
        
        sliderContainer.appendChild(sliderLabel);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(sliderValue);
        
        container.appendChild(toggleContainer);
        container.appendChild(sliderContainer);
        
        return container;
    }
    
    // Create LED control (color picker + brightness + on/off)
    function createLedControl(deviceId, capability, currentState) {
        const container = document.createElement('div');
        container.className = 'led-control';
        
        // On/Off toggle
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'toggle-container';
        
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Power:';
        
        const toggle = document.createElement('button');
        toggle.className = `toggle-button ${currentState?.power === 'on' ? 'active' : ''}`;
        toggle.textContent = currentState?.power === 'on' ? 'ON' : 'OFF';
        toggle.addEventListener('click', () => {
            const newState = toggle.classList.contains('active') ? 'off' : 'on';
            sendCommand(deviceId, capability, 'power', newState);
        });
        
        toggleContainer.appendChild(toggleLabel);
        toggleContainer.appendChild(toggle);
        
        // Only show color picker for RGB LEDs
        if (capability === 'rgb_led') {
            const colorContainer = document.createElement('div');
            colorContainer.className = 'color-container';
            
            const colorLabel = document.createElement('span');
            colorLabel.textContent = 'Color:';
            
            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.value = currentState?.color || '#ff0000';
            colorPicker.addEventListener('change', () => {
                sendCommand(deviceId, capability, 'color', colorPicker.value);
            });
            
            colorContainer.appendChild(colorLabel);
            colorContainer.appendChild(colorPicker);
            
            container.appendChild(colorContainer);
        }
        
        // Brightness slider
        const brightnessContainer = document.createElement('div');
        brightnessContainer.className = 'slider-container';
        
        const brightnessLabel = document.createElement('span');
        brightnessLabel.textContent = 'Brightness:';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = currentState?.brightness || '100';
        slider.addEventListener('change', () => {
            sendCommand(deviceId, capability, 'brightness', parseInt(slider.value));
        });
        
        const sliderValue = document.createElement('span');
        sliderValue.className = 'slider-value';
        sliderValue.textContent = `${slider.value}%`;
        
        slider.addEventListener('input', () => {
            sliderValue.textContent = `${slider.value}%`;
        });
        
        brightnessContainer.appendChild(brightnessLabel);
        brightnessContainer.appendChild(slider);
        brightnessContainer.appendChild(sliderValue);
        
        container.appendChild(toggleContainer);
        container.appendChild(brightnessContainer);
        
        return container;
    }
    
    // Create pump control (on/off + duration)
    function createPumpControl(deviceId, currentState) {
        const container = document.createElement('div');
        container.className = 'pump-control';
        
        // On/Off toggle
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'toggle-container';
        
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Power:';
        
        const toggle = document.createElement('button');
        toggle.className = `toggle-button ${currentState?.power === 'on' ? 'active' : ''}`;
        toggle.textContent = currentState?.power === 'on' ? 'ON' : 'OFF';
        toggle.addEventListener('click', () => {
            const newState = toggle.classList.contains('active') ? 'off' : 'on';
            sendCommand(deviceId, 'pump', 'power', newState);
        });
        
        toggleContainer.appendChild(toggleLabel);
        toggleContainer.appendChild(toggle);
        
        // Duration input for timed operation
        const durationContainer = document.createElement('div');
        durationContainer.className = 'duration-container';
        
        const durationLabel = document.createElement('span');
        durationLabel.textContent = 'Duration (s):';
        
        const durationInput = document.createElement('input');
        durationInput.type = 'number';
        durationInput.min = '1';
        durationInput.max = '3600';
        durationInput.value = '10';
        
        const durationButton = document.createElement('button');
        durationButton.textContent = 'Run';
        durationButton.addEventListener('click', () => {
            const duration = parseInt(durationInput.value);
            if (duration > 0) {
                sendCommand(deviceId, 'pump', 'run', duration);
            }
        });
        
        durationContainer.appendChild(durationLabel);
        durationContainer.appendChild(durationInput);
        durationContainer.appendChild(durationButton);
        
        container.appendChild(toggleContainer);
        container.appendChild(durationContainer);
        
        return container;
    }
    
    // Create a generic on/off control
    function createOnOffControl(deviceId, capability, currentState) {
        const container = document.createElement('div');
        container.className = 'toggle-container';
        
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Power:';
        
        const toggle = document.createElement('button');
        toggle.className = `toggle-button ${currentState?.power === 'on' ? 'active' : ''}`;
        toggle.textContent = currentState?.power === 'on' ? 'ON' : 'OFF';
        toggle.addEventListener('click', () => {
            const newState = toggle.classList.contains('active') ? 'off' : 'on';
            sendCommand(deviceId, capability, 'power', newState);
        });
        
        container.appendChild(toggleLabel);
        container.appendChild(toggle);
        
        return container;
    }
    
    // Format capability name for display
    function formatCapabilityName(capability) {
        return capability
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }
    
    // Format device ID for display
    function formatDeviceId(deviceId) {
        return deviceId
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }
    
    // Format timestamp for display
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        
        if (date.toDateString() === today.toDateString()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString() + ' ' + 
                date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }
    
    // Send command to a device
    function sendCommand(deviceId, component, action, value) {
        if (!socket.connected) {
            showNotification('Not connected to server', 'error');
            return;
        }
        
        socket.emit('sendCommand', { deviceId, component, action, value });
        
        // Show visual feedback
        showNotification(`Sending ${action} command to ${formatDeviceId(deviceId)}`);
    }
    
    // Handle command result
    function handleCommandResult(result) {
        console.log('Command result:', result);
        
        // Update UI based on result
        if (result.success) {
            showNotification(`Command sent to ${formatDeviceId(result.deviceId)}`);
            
            // Update local component state if we have the current_state
            if (result.current_state && result.component) {
                // Find the device in our local state
                const deviceIndex = picoDevices.findIndex(d => d.device_id === result.deviceId);
                if (deviceIndex >= 0) {
                    // Initialize components object if it doesn't exist
                    if (!picoDevices[deviceIndex].components) {
                        picoDevices[deviceIndex].components = {};
                    }
                    
                    // Update the component state
                    picoDevices[deviceIndex].components[result.component] = 
                        result.current_state;
                    
                    // If this is the selected device, update the UI immediately
                    if (selectedControlDevice === result.deviceId) {
                        updateCapabilitiesPanel(picoDevices[deviceIndex]);
                    }
                }
            }
        } else {
            showNotification(`Error sending command to ${formatDeviceId(result.deviceId)}`, 'error');
        }
        
        // Refresh devices to show updated state
        setTimeout(loadPicoDevices, 1000);
    }
    
    // Handle broadcast form submission
    function handleBroadcast(event) {
        event.preventDefault();
        
        if (!socket.connected) {
            showNotification('Not connected to server', 'error');
            return;
        }
        
        const component = document.getElementById('broadcastComponent').value;
        const action = document.getElementById('broadcastAction').value;
        let value = document.getElementById('broadcastValue').value;
        
        // Convert value to appropriate type based on action
        if (action === 'power') {
            // Keep as string ('on' or 'off')
        } else if (['brightness', 'speed'].includes(action)) {
            value = parseInt(value);
        } else if (action === 'color') {
            // Ensure color starts with # for hex colors
            if (value && !value.startsWith('#')) {
                value = '#' + value;
            }
        }
        
        console.log(`Broadcasting command: ${component} ${action} = ${value}`);
        
        // Send broadcast command
        socket.emit('broadcastCommand', { 
            component, 
            action, 
            value 
        });
        
        // Show visual feedback
        showNotification(`Broadcasting ${action} command to all ${component} devices`, 'success');
    }
    
    // Handle broadcast result
    function handleBroadcastResult(result) {
        console.log('Broadcast result:', result);
        
        if (result.success) {
            showNotification(`Command broadcasted to ${result.targetDevices.length} devices`);
        } else {
            showNotification('No devices available for this command', 'warning');
        }
        
        // Refresh devices to show updated state
        setTimeout(loadPicoDevices, 1000);
    }
    
    // Show notification
    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('visible');
        }, 10);
        
        // Automatically remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
});