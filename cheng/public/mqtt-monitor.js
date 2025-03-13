// mqtt-monitor.js
document.addEventListener('DOMContentLoaded', () => {
    // Connect to Socket.IO
    const socket = io();
    
    // DOM Elements
    const mqttStatus = document.getElementById('mqtt-status');
    const brokerUrl = document.getElementById('broker-url');
    const topicPrefix = document.getElementById('topic-prefix');
    const connectedDevices = document.getElementById('connected-devices');
    const messagesReceived = document.getElementById('messages-received');
    const messagesSent = document.getElementById('messages-sent');
    const mqttConsole = document.getElementById('mqtt-console');
    const deviceSelect = document.getElementById('device-id');
    const componentSelect = document.getElementById('component');
    const actionSelect = document.getElementById('action');
    const valueInput = document.getElementById('value');
    const sendForm = document.getElementById('mqtt-send-form');
    const clearConsoleBtn = document.getElementById('clear-console');
    const messageFilter = document.getElementById('message-filter');
    const autoscrollCheck = document.getElementById('autoscroll');
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    const currentTime = document.getElementById('currentTime');
    const currentDate = document.getElementById('currentDate');
    const rawJsonEditor = document.getElementById('raw-json-editor');
    const formatJsonBtn = document.getElementById('format-json');
    const sendRawJsonBtn = document.getElementById('send-raw-json');
    
    // Counters
    let receivedCount = 0;
    let sentCount = 0;
    
    // MQTT Monitor State
    const state = {
        mqttConnected: false,
        devices: [],
        messages: []
    };
    
    // Initialize the MQTT Monitor
    initializeMqttMonitor();
    
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
    
    // Socket.IO Event Listeners
    socket.on('connect', () => {
        console.log('Connected to server');
        
        // Request MQTT status
        socket.emit('getMqttStatus');
        
        // Request device list
        socket.emit('getPicoDevices');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateMqttStatus(false);
    });
    
    // Handle MQTT Status
    socket.on('mqttStatus', (status) => {
        updateMqttStatus(status.connected);
        if (status.broker) {
            brokerUrl.textContent = status.broker;
        }
        if (status.topicPrefix) {
            topicPrefix.textContent = status.topicPrefix;
        }
    });
    
    // Handle device list
    socket.on('picoDevices', (devices) => {
        state.devices = devices;
        updateDeviceList();
        updateConnectedDevicesCount();
    });
    
    // Handle MQTT Messages
    socket.on('mqttMessage', (message) => {
        addMessageToConsole(message);
        
        // Increment counter
        receivedCount++;
        messagesReceived.textContent = receivedCount;
    });
    
    // Handle Command Result
    socket.on('commandResult', (result) => {
        // Create a message object for the console
        const message = {
            type: 'ack',
            topic: `${topicPrefix.textContent}${result.deviceId}/ack`,
            content: {
                deviceId: result.deviceId,
                commandId: result.commandId,
                success: result.success,
                message: result.message || (result.success ? 'Command executed successfully' : 'Command failed')
            },
            timestamp: new Date().toISOString()
        };
        
        addMessageToConsole(message);
    });
    
    // Send Command Form
    sendForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const deviceId = deviceSelect.value;
        const component = componentSelect.value;
        const action = actionSelect.value;
        const value = valueInput.value;
        
        // Validate input
        if (!deviceId || !component || !action || !value) {
            showNotification('Please fill all fields', true);
            return;
        }
        
        // Handle broadcast to all devices
        if (deviceId === 'broadcast') {
            // Create a broadcast message
            socket.emit('broadcastCommand', {
                component,
                action,
                value
            });
            
            // Create a message object for the console
            const message = {
                type: 'command',
                topic: `${topicPrefix.textContent}+/commands`,
                content: {
                    component,
                    action,
                    value
                },
                timestamp: new Date().toISOString()
            };
            
            addMessageToConsole(message);
            
            // Increment counter
            sentCount++;
            messagesSent.textContent = sentCount;
            
            showNotification('Broadcast command sent to all devices');
        } else {
            // Send to a specific device
            socket.emit('sendCommand', {
                deviceId,
                component,
                action,
                value
            });
            
            // Create a message object for the console
            const message = {
                type: 'command',
                topic: `${topicPrefix.textContent}${deviceId}/commands`,
                content: {
                    deviceId,
                    component,
                    action,
                    value
                },
                timestamp: new Date().toISOString()
            };
            
            addMessageToConsole(message);
            
            // Increment counter
            sentCount++;
            messagesSent.textContent = sentCount;
            
            showNotification(`Command sent to device ${deviceId}`);
        }
        
        // Reset the form
        valueInput.value = '';
    });
    
    // Clear Console Button
    clearConsoleBtn.addEventListener('click', () => {
        mqttConsole.innerHTML = '';
        state.messages = [];
    });
    
    // Message Filter Change
    messageFilter.addEventListener('change', () => {
        filterConsoleMessages();
    });
    
    // Format JSON button
    if (formatJsonBtn) {
        formatJsonBtn.addEventListener('click', () => {
            try {
                // Parse the JSON to validate it
                const jsonObj = JSON.parse(rawJsonEditor.value);
                // Format it with proper indentation and spacing
                rawJsonEditor.value = JSON.stringify(jsonObj, null, 2);
                showNotification('JSON formatted successfully');
            } catch (error) {
                showNotification('Invalid JSON: ' + error.message, true);
            }
        });
    }

    // Send Raw JSON button
    if (sendRawJsonBtn) {
        sendRawJsonBtn.addEventListener('click', () => {
            try {
                // Parse the JSON to validate it
                const commandObj = JSON.parse(rawJsonEditor.value);
                
                // Basic validation
                if (!commandObj.component || !commandObj.action) {
                    showNotification('JSON must include "component" and "action" fields', true);
                    return;
                }
                
                // Add auto-generated ID and timestamp if they don't exist
                if (!commandObj.id) {
                    commandObj.id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                }
                
                if (!commandObj.timestamp) {
                    commandObj.timestamp = Date.now();
                }
                
                // Update the editor with the complete object
                rawJsonEditor.value = JSON.stringify(commandObj, null, 2);
                
                // Send broadcast command using the object's fields
                socket.emit('broadcastCommand', {
                    component: commandObj.component,
                    action: commandObj.action,
                    value: commandObj.value
                });
                
                // Create a message object for the console
                const message = {
                    type: 'command',
                    topic: `${topicPrefix.textContent}all/commands`,
                    content: commandObj,
                    timestamp: new Date().toISOString()
                };
                
                addMessageToConsole(message);
                
                // Increment counter
                sentCount++;
                messagesSent.textContent = sentCount;
                
                showNotification('Raw JSON command broadcasted to all devices');
            } catch (error) {
                showNotification('Error: ' + error.message, true);
            }
        });
    }
    
    // Initialize MQTT Monitor
    function initializeMqttMonitor() {
        // Add server broadcast messages listener
        socket.on('sensorUpdate', (data) => {
            // Create a message object for the console
            const message = {
                type: 'telemetry',
                topic: `${topicPrefix.textContent}${data.deviceId}/telemetry`,
                content: data.data,
                timestamp: new Date().toISOString()
            };
            
            addMessageToConsole(message);
            
            // Increment counter
            receivedCount++;
            messagesReceived.textContent = receivedCount;
        });
        
        // Add device status update listener
        socket.on('deviceStatus', (statusData) => {
            Object.entries(statusData).forEach(([deviceId, status]) => {
                // Create a message object for the console
                const message = {
                    type: 'status',
                    topic: `${topicPrefix.textContent}${deviceId}/status`,
                    content: {
                        deviceId,
                        status: status.status,
                        lastSeen: status.lastSeen
                    },
                    timestamp: new Date().toISOString()
                };
                
                addMessageToConsole(message);
                
                // Increment counter
                receivedCount++;
                messagesReceived.textContent = receivedCount;
            });
            
            // Update device list if needed
            socket.emit('getPicoDevices');
        });
    }
    
    // Update MQTT Status
    function updateMqttStatus(connected) {
        state.mqttConnected = connected;
        
        if (connected) {
            mqttStatus.textContent = 'Connected';
            mqttStatus.className = 'status-badge connected';
        } else {
            mqttStatus.textContent = 'Disconnected';
            mqttStatus.className = 'status-badge disconnected';
        }
    }
    
    // Update Device List
    function updateDeviceList() {
        // Clear options except the first two
        while (deviceSelect.options.length > 2) {
            deviceSelect.remove(2);
        }
        
        // Add devices to select
        state.devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.device_id;
            option.textContent = device.device_id;
            deviceSelect.appendChild(option);
        });
    }
    
    // Update Connected Devices Count
    function updateConnectedDevicesCount() {
        connectedDevices.textContent = state.devices.length;
    }
    
    // Add Message to Console
    function addMessageToConsole(message) {
        // Add message to state
        state.messages.push(message);
        
        // Apply filter
        filterConsoleMessages();
    }
    
    // Filter Console Messages
    function filterConsoleMessages() {
        // Clear console
        mqttConsole.innerHTML = '';
        
        // Get filter value
        const filter = messageFilter.value;
        
        // Filter messages
        const filteredMessages = filter === 'all' 
            ? state.messages 
            : state.messages.filter(msg => msg.type === filter);
        
        // Add messages to console
        filteredMessages.forEach(message => {
            displayMessageInConsole(message);
        });
        
        // Scroll to bottom if auto-scroll is enabled
        if (autoscrollCheck.checked) {
            mqttConsole.scrollTop = mqttConsole.scrollHeight;
        }
    }
    
    // Display Message in Console
    function displayMessageInConsole(message) {
        const line = document.createElement('div');
        line.className = 'console-line';
        
        // Format timestamp
        const timestamp = new Date(message.timestamp);
        const timeStr = timestamp.toLocaleTimeString();
        
        // Create message content
        let contentHtml = '';
        
        switch (message.type) {
            case 'command':
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type command">COMMAND</span>`;
                contentHtml += `<span>Topic: ${message.topic}</span>`;
                contentHtml += `<div class="message-content">`;
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
                break;
                
            case 'status':
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type status">STATUS</span>`;
                contentHtml += `<span>Topic: ${message.topic}</span>`;
                contentHtml += `<div class="message-content">`;
                contentHtml += `<p>Device: ${message.content.deviceId} - Status: ${message.content.status}</p>`;
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
                break;
                
            case 'telemetry':
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type telemetry">TELEMETRY</span>`;
                contentHtml += `<span>Topic: ${message.topic}</span>`;
                contentHtml += `<div class="message-content">`;
                
                // Format sensors if available
                if (message.content.sensors) {
                    contentHtml += `<p>Device: ${message.content.device_id}</p>`;
                    contentHtml += `<p>Sensors:</p>`;
                    contentHtml += `<ul>`;
                    for (const [sensor, data] of Object.entries(message.content.sensors)) {
                        contentHtml += `<li>${sensor}: ${data.value} ${data.unit}</li>`;
                    }
                    contentHtml += `</ul>`;
                }
                
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
                break;
                
            case 'ack':
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type ack">ACK</span>`;
                contentHtml += `<span>Topic: ${message.topic}</span>`;
                contentHtml += `<div class="message-content">`;
                contentHtml += `<p>Device: ${message.content.deviceId} - ${message.content.success ? 'Success' : 'Failed'}</p>`;
                contentHtml += `<p>Message: ${message.content.message}</p>`;
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
                break;
                
            case 'error':
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type error">ERROR</span>`;
                contentHtml += `<span>Topic: ${message.topic || 'N/A'}</span>`;
                contentHtml += `<div class="message-content">`;
                contentHtml += `<p>${message.content.message || 'An error occurred'}</p>`;
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
                break;
                
            default:
                contentHtml = `<span class="timestamp">[${timeStr}]</span>`;
                contentHtml += `<span class="message-type">UNKNOWN</span>`;
                contentHtml += `<span>Topic: ${message.topic || 'N/A'}</span>`;
                contentHtml += `<div class="message-content">`;
                contentHtml += `<pre>${JSON.stringify(message.content, null, 2)}</pre>`;
                contentHtml += `</div>`;
        }
        
        line.innerHTML = contentHtml;
        mqttConsole.appendChild(line);
    }
    
    // Show Notification
    function showNotification(message, isError = false) {
        notificationMessage.textContent = message;
        notification.className = isError ? 'notification error show' : 'notification show';
        
        // Hide after 3 seconds
        setTimeout(() => {
            notification.className = isError ? 'notification error' : 'notification';
        }, 3000);
    }
    
    // Dynamic action options based on component
    componentSelect.addEventListener('change', () => {
        // Clear current options
        actionSelect.innerHTML = '';
        
        const component = componentSelect.value;
        let options = [];
        
        // Add appropriate actions based on component
        if (component === 'led') {
            options = [
                { value: 'power', text: 'Power' },
                { value: 'brightness', text: 'Brightness' }
            ];
        } else if (component === 'fan') {
            options = [
                { value: 'power', text: 'Power' },
                { value: 'speed', text: 'Speed' }
            ];
        } else if (component === 'pump') {
            options = [
                { value: 'power', text: 'Power' },
                { value: 'run', text: 'Run (timed)' }
            ];
        }
        
        // Add options to select
        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            actionSelect.appendChild(optionEl);
        });
        
        // Update value placeholder
        updateValuePlaceholder();
    });
    
    // Dynamic value placeholder based on action
    actionSelect.addEventListener('change', () => {
        updateValuePlaceholder();
    });
    
    // Update value input placeholder
    function updateValuePlaceholder() {
        const component = componentSelect.value;
        const action = actionSelect.value;
        
        if (action === 'power') {
            valueInput.placeholder = 'on, off';
        } else if (action === 'brightness' || action === 'speed') {
            valueInput.placeholder = '0-100';
        } else if (action === 'run') {
            valueInput.placeholder = 'duration in seconds';
        } else {
            valueInput.placeholder = 'value';
        }
    }
    
    // Initialize action select
    componentSelect.dispatchEvent(new Event('change'));
});