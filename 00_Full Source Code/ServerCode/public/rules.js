// rules.js - Client-side script for the IoT Rules Manager

// Connect to Socket.io server
const socket = io();

// DOM elements
const rulesList = document.getElementById('rulesList');
const noRuleSelected = document.getElementById('noRuleSelected');
const ruleEditorContent = document.getElementById('ruleEditorContent');
const ruleForm = document.getElementById('ruleForm');
const createRuleBtn = document.getElementById('createRuleBtn');
const cancelBtn = document.getElementById('cancelBtn');
const deleteRuleBtn = document.getElementById('deleteRuleBtn');
const searchRulesInput = document.getElementById('searchRules');
const filterCondition = document.getElementById('filterCondition');
const filterSchedule = document.getElementById('filterSchedule');
const ruleEnabledToggle = document.getElementById('ruleEnabledToggle');
const ruleName = document.getElementById('ruleName');
const ruleId = document.getElementById('ruleId');
const deviceId = document.getElementById('deviceId');
const actionType = document.getElementById('actionType');
const standardActionContent = document.getElementById('standardActionContent');
const customJsonActionSection = document.getElementById('customJsonActionSection');
const actionJsonEditor = document.getElementById('actionJsonEditor');
const formatJsonBtn = document.getElementById('formatJsonBtn');
const conditionRuleSection = document.getElementById('conditionRuleSection');
const scheduleRuleSection = document.getElementById('scheduleRuleSection');
const conditionSensor = document.getElementById('conditionSensor');
const conditionOperator = document.getElementById('conditionOperator');
const conditionValue = document.getElementById('conditionValue');
const schedulePattern = document.getElementById('schedulePattern');
const actionComponent = document.getElementById('actionComponent');
const actionCommand = document.getElementById('actionCommand');
const actionValue = document.getElementById('actionValue');
const ruleTypeOptions = document.querySelectorAll('.rule-type-option');
const ruleHistorySection = document.getElementById('ruleHistorySection');
const ruleHistory = document.getElementById('ruleHistory');
const notification = document.getElementById('notification');
const notificationMessage = document.getElementById('notificationMessage');
const currentTime = document.getElementById('currentTime');
const currentDate = document.getElementById('currentDate');

// State
let allRules = [];
let selectedRuleId = null;
let editMode = false;
let availableDevices = [];
let searchTimeout = null;

// Function to add debugging controls to the page (for development)
function addDebuggingTools() {
  // Create a debug panel
  const debugPanel = document.createElement('div');
  debugPanel.style.position = 'fixed';
  debugPanel.style.bottom = '10px';
  debugPanel.style.right = '10px';
  debugPanel.style.padding = '10px';
  debugPanel.style.background = 'rgba(0,0,0,0.7)';
  debugPanel.style.color = 'white';
  debugPanel.style.borderRadius = '5px';
  debugPanel.style.zIndex = '9999';
  debugPanel.style.fontSize = '12px';
  debugPanel.style.maxWidth = '300px';
  
  debugPanel.innerHTML = `
    <div style="margin-bottom:5px;font-weight:bold">Sensor Debugging</div>
    <div>
      <button id="debugFetchSensors" style="margin-right:5px">Manual Fetch</button>
      <button id="debugTogglePanel">Hide</button>
    </div>
    <div id="debugOutput" style="margin-top:10px;max-height:150px;overflow-y:auto;font-family:monospace;"></div>
  `;
  
  document.body.appendChild(debugPanel);
  
  // Function to log to debug panel
  window.debugLog = function(message) {
    const outputDiv = document.getElementById('debugOutput');
    if (outputDiv) {
      const time = new Date().toLocaleTimeString();
      outputDiv.innerHTML += `<div>[${time}] ${message}</div>`;
      outputDiv.scrollTop = outputDiv.scrollHeight;
    }
    console.log(`[DEBUG] ${message}`);
  };
  
  // Add event handlers
  document.getElementById('debugFetchSensors').addEventListener('click', () => {
    const device = deviceId.value;
    if (!device) {
      window.debugLog('No device selected');
      return;
    }
    
    window.debugLog(`Manually fetching sensors for ${device}...`);
    
    // Try both methods
    fetch(`/api/devices/${device}/sensors`)
      .then(res => res.json())
      .then(data => {
        window.debugLog(`API: Found ${data.sensors ? data.sensors.length : 0} sensors`);
        if (data.sensors && data.sensors.length > 0) {
          populateSensorDropdown(device, data.sensors);
          window.debugLog('Populated dropdown from API');
        }
      })
      .catch(err => {
        window.debugLog(`API Error: ${err.message}`);
      });
      
    // Also try socket
    socket.emit('getSensorsForDevice', device);
    window.debugLog('Socket request sent');
  });
  
  document.getElementById('debugTogglePanel').addEventListener('click', () => {
    const outputDiv = document.getElementById('debugOutput');
    const btn = document.getElementById('debugTogglePanel');
    
    if (outputDiv.style.display === 'none') {
      outputDiv.style.display = 'block';
      btn.textContent = 'Hide';
    } else {
      outputDiv.style.display = 'none';
      btn.textContent = 'Show';
    }
  });
  
  // Override socket handler for debugging
  const originalHandler = socket.on;
  socket.on = function(event, handler) {
    if (event === 'deviceSensors') {
      const wrappedHandler = function(data) {
        window.debugLog(`Socket received ${event}: ${data.sensors ? data.sensors.length : 0} sensors`);
        handler(data);
      };
      return originalHandler.call(this, event, wrappedHandler);
    }
    return originalHandler.call(this, event, handler);
  };
  
  window.debugLog('Debugging tools initialized');
}

// Initialize the page
function initPage() {
  // Update time and date
  updateDateTime();
  setInterval(updateDateTime, 1000);
  
  // Load rules from server
  loadRules();
  
  // Load available devices
  loadDevices();
  
  // Set up event listeners
  setupEventListeners();
}

// Update the current date and time in the header
function updateDateTime() {
  const now = new Date();
  currentTime.textContent = now.toLocaleTimeString();
  currentDate.textContent = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

// Load rules from the server
function loadRules() {
  socket.emit('getRules');
}

// Load available devices
function loadDevices() {
  fetch('/api/devices')
    .then(response => response.json())
    .then(devices => {
      availableDevices = devices;
      
      // Populate device dropdown
      deviceId.innerHTML = '<option value="broadcast">Broadcast to All Devices</option>';
      devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device;
        option.textContent = device;
        deviceId.appendChild(option);
      });
    })
    .catch(error => {
      console.error('Error loading devices:', error);
      showNotification('Error loading devices', true);
    });
}

// Set up event listeners
function setupEventListeners() {
  // Rule creation
  createRuleBtn.addEventListener('click', createNewRule);
  
  // Rule form submission
  ruleForm.addEventListener('submit', saveRule);
  
  // Cancel button
  cancelBtn.addEventListener('click', cancelEditing);
  
  // Delete button
  deleteRuleBtn.addEventListener('click', deleteRule);
  
  // Enable/disable toggle
  ruleEnabledToggle.addEventListener('change', toggleRuleEnabled);
  
  // Rule type selection
  ruleTypeOptions.forEach(option => {
    option.addEventListener('click', () => {
      selectRuleType(option.dataset.type);
    });
  });
  
  // Search input
  searchRulesInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterRules, 300);
  });
  
  // Filters
  filterCondition.addEventListener('change', filterRules);
  filterSchedule.addEventListener('change', filterRules);
  
  // Device selection (to load sensors)
  deviceId.addEventListener('change', function(){
    const broadcastHint = document.getElementById('broadcastHint');
    if (this.value === 'broadcast') {
      broadcastHint.style.display = 'block';
    } else {
      broadcastHint.style.display = 'none';
    }
    
    // Also load sensors and components as before
    loadDeviceSensors();
    loadDeviceComponents();
  });
  
  // Action type selection
  actionType.addEventListener('change', () => {
    if (actionType.value === 'custom') {
      standardActionContent.style.display = 'none';
      customJsonActionSection.style.display = 'block';
    } else {
      standardActionContent.style.display = 'block';
      customJsonActionSection.style.display = 'none';
    }
  });
  
  // Format JSON button
  formatJsonBtn.addEventListener('click', formatJsonAction);
  
  // Action component selection (to load available commands)
  actionComponent.addEventListener('change', loadComponentCommands);
  
  // Socket events
  socket.on('rules', handleRules);
  socket.on('deviceSensors', handleDeviceSensors);
  socket.on('deviceComponents', handleDeviceComponents);
  socket.on('ruleExecuted', handleRuleExecution);
}

// Handle rules data from server
function handleRules(rules) {
  allRules = rules;
  renderRulesList();
}

// Render the rules list
function renderRulesList() {
  // Clear the list
  rulesList.innerHTML = '';
  
  // Apply filters
  let filteredRules = allRules;
  
  // Apply search filter
  const searchTerm = searchRulesInput.value.toLowerCase();
  if (searchTerm) {
    filteredRules = filteredRules.filter(rule => 
      rule.name.toLowerCase().includes(searchTerm) || 
      rule.deviceId.toLowerCase().includes(searchTerm)
    );
  }
  
  // Apply type filters
  if (!filterCondition.checked || !filterSchedule.checked) {
    if (filterCondition.checked) {
      filteredRules = filteredRules.filter(rule => rule.type === 'condition');
    } else if (filterSchedule.checked) {
      filteredRules = filteredRules.filter(rule => rule.type === 'schedule');
    }
  }

  // Debug: Log any rules without names
  const invalidRules = filteredRules.filter(rule => !rule.name);
  if (invalidRules.length > 0) {
    console.warn('Found rules without names:', invalidRules);
  }
  
  // Sort rules (enabled first, then by name)
  filteredRules.sort((a, b) => {
    // First sort by enabled status
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    
    // Check if both rules have valid name properties
    if (!a.name && !b.name) {
      return 0; // Both have no names, consider them equal
    }
    if (!a.name) {
      return 1; // Sort rules without names after named ones
    }
    if (!b.name) {
      return -1; // Sort rules without names after named ones
    }
    
    // If both have names, compare them
    return a.name.localeCompare(b.name);
  });
  
  // Show empty state if no rules
  if (filteredRules.length === 0) {
    rulesList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-tasks"></i>
        <p>No rules found</p>
        <p>Click 'New Rule' to create your first rule</p>
      </div>
    `;
    return;
  }
  
  // Render each rule
  filteredRules.forEach(rule => {
    const ruleElement = document.createElement('div');
    ruleElement.className = `rule-item ${selectedRuleId === rule.id ? 'selected' : ''}`;
    ruleElement.dataset.id = rule.id;
    
    const ruleIcon = rule.type === 'condition' ? 'fa-code-branch' : 'fa-calendar-alt';
    const statusClass = rule.enabled ? 'active' : 'inactive';
    const statusText = rule.enabled ? 'Active' : 'Inactive';
    
    let details = '';
    if (rule.type === 'condition' && rule.condition) {
      details = `When ${rule.condition.sensor} ${rule.condition.operator} ${rule.condition.value}`;
    } else if (rule.type === 'schedule' && rule.schedule) {
      details = `Schedule: ${rule.schedule.pattern}`;
    }
    
    const lastExecuted = rule.lastExecuted 
      ? `Last run: ${new Date(rule.lastExecuted).toLocaleString()}`
      : 'Never executed';
    
    ruleElement.innerHTML = `
      <div class="rule-header">
        <div class="rule-name">
          <i class="fas ${ruleIcon}"></i>
          ${rule.name}
        </div>
        <div class="rule-device">${rule.deviceId}</div>
      </div>
      <div class="rule-details">${details}</div>
      <div class="rule-status">
        <span class="rule-last-execution">${lastExecuted}</span>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
    `;
    
    ruleElement.addEventListener('click', () => selectRule(rule.id));
    rulesList.appendChild(ruleElement);
  });
}

// Filter rules based on search and filters
function filterRules() {
  renderRulesList();
}

// Create a new rule
function createNewRule() {
  // Reset the form
  ruleForm.reset();
  ruleId.value = '';
  selectedRuleId = null;
  editMode = false;
  
  // Show the rule editor
  noRuleSelected.style.display = 'none';
  ruleEditorContent.style.display = 'block';
  
  // Set the title
  document.getElementById('ruleEditorTitle').innerHTML = '<i class="fas fa-plus"></i> Create Rule';
  
  // Set default rule type
  selectRuleType('condition');
  
  // Hide history section
  ruleHistorySection.style.display = 'none';
  
  // Enable the form
  enableFormFields(true);
  
  // Set default action type
  actionType.value = 'standard';
  standardActionContent.style.display = 'block';
  customJsonActionSection.style.display = 'none';
  
  // Set enabled by default
  ruleEnabledToggle.checked = true;
}

// Select a rule to edit
function selectRule(id) {
  // Get the rule data
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  
  // Update selected rule
  selectedRuleId = id;
  editMode = true;
  
  // Highlight in the list
  const ruleElements = document.querySelectorAll('.rule-item');
  ruleElements.forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  
  // Show the rule editor
  noRuleSelected.style.display = 'none';
  ruleEditorContent.style.display = 'block';
  
  // Set the title
  document.getElementById('ruleEditorTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Rule';
  
  // Fill in the form with rule data
  ruleId.value = rule.id;
  ruleName.value = rule.name;
  deviceId.value = rule.deviceId;
  ruleEnabledToggle.checked = rule.enabled;
  
  // Set rule type
  selectRuleType(rule.type);
  
  // Load sensors for this device (which will populate dropdowns)
  loadDeviceSensors();
  
  // Load components for this device (which will populate dropdowns)
  loadDeviceComponents();
  
  // Set condition or schedule values after dropdowns are populated
  setTimeout(() => {
    if (rule.type === 'condition' && rule.condition) {
      conditionSensor.value = rule.condition.sensor || '';
      conditionOperator.value = rule.condition.operator || '>';
      conditionValue.value = rule.condition.value || '';
    } else if (rule.type === 'schedule' && rule.schedule) {
      schedulePattern.value = rule.schedule.pattern || '';
    }
  }, 500);
  
  // Set action values
  if (rule.action) {
    if (rule.action.isCustomJson) {
      actionType.value = 'custom';
      standardActionContent.style.display = 'none';
      customJsonActionSection.style.display = 'block';
      
      // Set custom JSON content
      try {
        const jsonObj = {
          component: rule.action.component || '',
          action: rule.action.action || rule.action.command || '',
          value: rule.action.value || '',
          broadcast: !!rule.action.broadcast
        };
        actionJsonEditor.value = JSON.stringify(jsonObj, null, 2);
      } catch (e) {
        actionJsonEditor.value = '{\n  "component": "led",\n  "action": "power",\n  "value": "on",\n  "broadcast": false\n}';
      }
    } else {
      actionType.value = 'standard';
      standardActionContent.style.display = 'block';
      customJsonActionSection.style.display = 'none';
      
      // Set standard action fields after dropdowns are populated
      setTimeout(() => {
        actionComponent.value = rule.action.component || '';
        
        // Trigger change to load commands
        const event = new Event('change');
        actionComponent.dispatchEvent(event);
        
        // Set remaining values after commands are loaded
        setTimeout(() => {
          actionCommand.value = rule.action.command || '';
          actionValue.value = rule.action.value || '';
        }, 300);
      }, 500);
    }
  }
  
  // Load rule history
  loadRuleHistory(id);
}

// Select rule type (condition or schedule)
function selectRuleType(type) {
  // Update UI
  ruleTypeOptions.forEach(option => {
    option.classList.toggle('selected', option.dataset.type === type);
  });
  
  // Show/hide appropriate sections
  if (type === 'condition') {
    conditionRuleSection.style.display = 'block';
    scheduleRuleSection.style.display = 'none';
  } else if (type === 'schedule') {
    conditionRuleSection.style.display = 'none';
    scheduleRuleSection.style.display = 'block';
  }
}

// Load sensors for a device
function loadDeviceSensors() {
  const device = deviceId.value;
  if (!device) return;
  
  // Clear existing options
  conditionSensor.innerHTML = '<option value="">Select a sensor</option>';
  
  // If broadcast is selected, disable the condition rule type and switch to schedule
  if (device === 'broadcast') {
    // Disable condition type for broadcast (since we can't specify a single sensor)
    document.querySelector('.rule-type-option[data-type="condition"]').classList.add('disabled');
    document.querySelector('.rule-type-option[data-type="condition"]').style.opacity = '0.5';
    
    // Switch to schedule type if condition was selected
    if (document.querySelector('.rule-type-option[data-type="condition"]').classList.contains('selected')) {
      selectRuleType('schedule');
    }
    
    return; // No need to load sensors for broadcast
  } else {
    // Re-enable condition type for specific devices
    document.querySelector('.rule-type-option[data-type="condition"]').classList.remove('disabled');
    document.querySelector('.rule-type-option[data-type="condition"]').style.opacity = '1';
  }
  
  // Show loading indicator
  conditionSensor.innerHTML = '<option value="">Loading sensors...</option>';
  
  // First try fetching via the REST API directly (more reliable)
  fetchSensorsViaAPI(device)
    .then(sensors => {
      if (sensors && sensors.length > 0) {
        populateSensorDropdown(device, sensors);
      } else {
        // If API returns no sensors, try socket as fallback
        socket.emit('getSensorsForDevice', device);
        
        // Set a timeout to check if we got a response
        setTimeout(() => {
          if (conditionSensor.options.length <= 1 || 
              conditionSensor.options[0].text === 'Loading sensors...') {
            // No response from socket either, show error
            conditionSensor.innerHTML = '<option value="">No sensors found</option>';
            showNotification('Could not load sensors for this device', true);
          }
        }, 3000);
      }
    })
    .catch(error => {
      console.error('Error fetching sensors:', error);
      // Try socket as fallback
      socket.emit('getSensorsForDevice', device);
    });
}

// New function to fetch sensors via REST API
async function fetchSensorsViaAPI(device) {
  try {
    // Changed to directly call an endpoint that will query Redis without checking online status
    const response = await fetch(`/api/devices/${device}/sensors?skipOnlineCheck=true`);
    if (!response.ok) {
      throw new Error(`Failed to fetch device data: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Device data from API:', data);
    
    if (!data || !data.sensors) {
      console.warn('No sensor data in API response');
      return [];
    }
    
    return data.sensors;
  } catch (error) {
    console.error('Error in fetchSensorsViaAPI:', error);
    return [];
  }
}

// New function to populate the sensor dropdown
function populateSensorDropdown(deviceId, sensors) {
  // Clear dropdown first
  conditionSensor.innerHTML = '<option value="">Select a sensor</option>';
  
  if (!sensors || sensors.length === 0) {
    conditionSensor.innerHTML = '<option value="">No sensors available</option>';
    return;
  }
  
  // Add each sensor to the dropdown
  sensors.forEach(sensor => {
    const option = document.createElement('option');
    option.value = sensor.id;
    option.textContent = `${sensor.name} (${sensor.unit})`;
    conditionSensor.appendChild(option);
  });
  
  console.log(`Added ${sensors.length} sensors to dropdown for device ${deviceId}`);
  
  // Select previously selected sensor if editing
  if (editMode && selectedRuleId) {
    const rule = allRules.find(r => r.id === selectedRuleId);
    if (rule && rule.condition && rule.condition.sensor) {
      conditionSensor.value = rule.condition.sensor;
    }
  }
}

// Handle device sensors from server
function handleDeviceSensors({ deviceId, sensors }) {
  if (deviceId !== document.getElementById('deviceId').value) return;
  populateSensorDropdown(deviceId, sensors);
}

// Load components for a device
function loadDeviceComponents() {
  const device = deviceId.value;
  if (!device) return;
  
  // Clear existing options
  actionComponent.innerHTML = '<option value="">Select a component</option>';
  
  // Request components from server
  socket.emit('getComponentsForDevice', device);
}

// Handle device components from server
function handleDeviceComponents({ deviceId, components }) {
  if (deviceId !== document.getElementById('deviceId').value) return;
  
  components.forEach(component => {
    const option = document.createElement('option');
    option.value = component.id;
    option.textContent = component.name;
    actionComponent.appendChild(option);
  });
  
  // Select previously selected component if editing
  if (editMode && selectedRuleId) {
    const rule = allRules.find(r => r.id === selectedRuleId);
    if (rule && rule.action && rule.action.component) {
      actionComponent.value = rule.action.component;
      
      // Trigger change to load commands
      const event = new Event('change');
      actionComponent.dispatchEvent(event);
    }
  }
}

// Load commands for a component
function loadComponentCommands() {
  const component = actionComponent.value;
  if (!component) return;
  
  // Clear existing options
  actionCommand.innerHTML = '<option value="">Select a command</option>';
  
  // Add standard commands based on component
  switch (component) {
    case 'led':
      addCommandOption('power', 'Power (on/off)');
      addCommandOption('brightness', 'Brightness (0-100)');
      addCommandOption('color', 'Color (hex)');
      break;
    case 'fan':
      addCommandOption('power', 'Power (on/off)');
      addCommandOption('speed', 'Speed (0-100)');
      break;
    case 'pump':
      addCommandOption('power', 'Power (on/off)');
      addCommandOption('flow', 'Flow Rate (0-100)');
      break;
    default:
      addCommandOption('power', 'Power (on/off)');
      addCommandOption('setValue', 'Set Value');
  }
  
  // Select previously selected command if editing
  if (editMode && selectedRuleId) {
    const rule = allRules.find(r => r.id === selectedRuleId);
    if (rule && rule.action && rule.action.command) {
      actionCommand.value = rule.action.command;
    }
  }
}

// Add a command option to the select element
function addCommandOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  actionCommand.appendChild(option);
}

// Format the JSON in the editor
function formatJsonAction() {
  try {
    const json = JSON.parse(actionJsonEditor.value);
    actionJsonEditor.value = JSON.stringify(json, null, 2);
  } catch (error) {
    showNotification('Invalid JSON format', true);
  }
}

// Save a rule
function saveRule(event) {
  event.preventDefault();
  
  // Validate form
  if (!ruleName.value || !deviceId.value) {
    showNotification('Please fill in all required fields', true);
    return;
  }
  
  // Determine rule type
  const type = document.querySelector('.rule-type-option.selected').dataset.type;
  
  // Build rule object
  const rule = {
    id: ruleId.value || null, // Null for new rules
    name: ruleName.value,
    deviceId: deviceId.value,
    type: type,
    enabled: ruleEnabledToggle.checked
  };
  
  // Add condition or schedule based on type
  if (type === 'condition') {
    if (!conditionSensor.value || !conditionOperator.value || conditionValue.value === '') {
      showNotification('Please fill in all condition fields', true);
      return;
    }
    
    rule.condition = {
      sensor: conditionSensor.value,
      operator: conditionOperator.value,
      value: parseFloat(conditionValue.value)
    };
  } else if (type === 'schedule') {
    if (!schedulePattern.value) {
      showNotification('Please enter a schedule pattern', true);
      return;
    }
    
    rule.schedule = {
      pattern: schedulePattern.value
    };
  }
  
  // Add action based on type
  if (actionType.value === 'custom') {
    try {
      const actionJson = JSON.parse(actionJsonEditor.value);
      
      // Validate JSON structure
      if (!actionJson.component || (!actionJson.action && !actionJson.command) || actionJson.value === undefined) {
        showNotification('Invalid action JSON. Required fields: component, action/command, value', true);
        return;
      }
      
      rule.action = {
        ...actionJson,
        isCustomJson: true
      };
      
      // For broadcast mode, set the broadcast flag explicitly
      if (deviceId.value === 'broadcast') {
        rule.action.broadcast = true;
      }

      // Ensure we have either action or command (standardize on action)
      if (!rule.action.action && rule.action.command) {
        rule.action.action = rule.action.command;
      } else if (!rule.action.command && rule.action.action) {
        rule.action.command = rule.action.action;
      }
    } catch (error) {
      showNotification('Invalid JSON format', true);
      return;
    }
  } else {
    if (!actionComponent.value || !actionCommand.value || actionValue.value === '') {
      showNotification('Please fill in all action fields', true);
      return;
    }
    
    rule.action = {
      component: actionComponent.value,
      command: actionCommand.value,
      value: actionValue.value
    };

    // For broadcast mode, set the broadcast flag
    if (deviceId.value === 'broadcast') {
      rule.action.broadcast = true;
    }
  }
  
  // Send rule to server
  fetch('/api/rules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(rule)
  })
  .then(response => {
    if (!response.ok) {
      // Parse error details if available
      return response.json().then(data => {
        throw new Error(data.error || 'Failed to save rule');
      });
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Show success notification
      showNotification('Rule saved successfully');
      
      // Reload rules
      loadRules();
      
      // If creating a new rule, clear the form
      if (!editMode) {
        cancelEditing();
      } else {
        // Update the selected rule ID in case this was a new rule
        selectedRuleId = data.ruleId || rule.id;
        
        // Load rule history for refreshed data
        loadRuleHistory(selectedRuleId);
      }
    } else {
      showNotification('Error saving rule', true);
    }
  })
  .catch(error => {
    console.error('Error saving rule:', error);
    showNotification(error.message || 'Error saving rule', true);
  });
}

// Cancel editing a rule
function cancelEditing() {
  // Clear the form
  ruleForm.reset();
  
  // Hide the editor
  ruleEditorContent.style.display = 'none';
  noRuleSelected.style.display = 'flex';
  
  // Clear selection
  selectedRuleId = null;
  editMode = false;
  
  // Update rule list UI
  renderRulesList();
}

// Delete a rule
function deleteRule() {
  if (!selectedRuleId) return;
  
  // Confirm deletion
  if (!confirm('Are you sure you want to delete this rule?')) {
    return;
  }
  
  // Send delete request to server
  fetch(`/api/rules/${selectedRuleId}`, {
    method: 'DELETE'
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to delete rule');
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Show success notification
      showNotification('Rule deleted successfully');
      
      // Close editor and reload rules
      cancelEditing();
      loadRules();
    } else {
      showNotification('Error deleting rule', true);
    }
  })
  .catch(error => {
    console.error('Error deleting rule:', error);
    showNotification('Error deleting rule', true);
  });
}

// Toggle rule enabled state
function toggleRuleEnabled() {
  if (!selectedRuleId) return;
  
  const enabled = ruleEnabledToggle.checked;
  
  // Send toggle request to server
  fetch(`/api/rules/${selectedRuleId}/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to update rule status');
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Show success notification
      showNotification(`Rule ${enabled ? 'enabled' : 'disabled'} successfully`);
      
      // Reload rules
      loadRules();
    } else {
      showNotification('Error updating rule status', true);
      
      // Revert toggle state
      ruleEnabledToggle.checked = !enabled;
    }
  })
  .catch(error => {
    console.error('Error toggling rule:', error);
    showNotification('Error updating rule status', true);
    
    // Revert toggle state
    ruleEnabledToggle.checked = !enabled;
  });
}

// Load rule execution history
function loadRuleHistory(ruleId) {
  // Show history section
  ruleHistorySection.style.display = 'block';
  
  // Clear history
  ruleHistory.innerHTML = '<div class="history-item">Loading history...</div>';
  
  // Fetch history from server
  fetch(`/api/rules/${ruleId}/history`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to load rule history');
      }
      return response.json();
    })
    .then(history => {
      renderRuleHistory(history);
    })
    .catch(error => {
      console.error('Error loading rule history:', error);
      ruleHistory.innerHTML = '<div class="history-item">Error loading history</div>';
    });
}

// Render rule execution history
function renderRuleHistory(history) {
  if (!history || history.length === 0) {
    ruleHistory.innerHTML = '<div class="history-item">No execution history yet</div>';
    return;
  }
  
  // Clear history
  ruleHistory.innerHTML = '';
  
  // Sort by timestamp (newest first)
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Render each history item
  history.forEach(item => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    const timestamp = new Date(item.timestamp).toLocaleString();
    
    historyItem.innerHTML = `
      <div class="history-timestamp">${timestamp}</div>
      <div class="history-action">${item.action}</div>
      <div class="history-device">Device: ${item.device}</div>
    `;
    
    ruleHistory.appendChild(historyItem);
  });
}

// Handle rule execution update from server
function handleRuleExecution({ ruleId, execution }) {
  // If this is the currently selected rule, update history
  if (selectedRuleId === ruleId) {
    // Add to the top of history
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    const timestamp = new Date(execution.timestamp).toLocaleString();
    
    historyItem.innerHTML = `
      <div class="history-timestamp">${timestamp}</div>
      <div class="history-action">${execution.action}</div>
      <div class="history-device">Device: ${execution.device}</div>
    `;
    
    // Check if we need to replace the "no history" message
    if (ruleHistory.querySelector('.history-item')?.textContent === 'No execution history yet') {
      ruleHistory.innerHTML = '';
    }
    
    // Add at the beginning
    ruleHistory.insertBefore(historyItem, ruleHistory.firstChild);
    
    // Limit to 50 entries
    const historyItems = ruleHistory.querySelectorAll('.history-item');
    if (historyItems.length > 50) {
      ruleHistory.removeChild(historyItems[historyItems.length - 1]);
    }
  }
  
  // Reload rules to update last execution time
  loadRules();
}

// Enable or disable all form fields
function enableFormFields(enabled) {
  const formElements = ruleForm.querySelectorAll('input, select, textarea, button');
  formElements.forEach(element => {
    if (element !== cancelBtn) {
      element.disabled = !enabled;
    }
  });
}

// Show notification
function showNotification(message, isError = false) {
  notificationMessage.textContent = message;
  notification.className = isError ? 'notification error show' : 'notification show';
  
  // Hide after 3 seconds
  setTimeout(() => {
    notification.className = isError ? 'notification error' : 'notification';
  }, 3000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', ()=>{
  initPage();
  
  // Add debugging tools if in development
  // addDebuggingTools();
});