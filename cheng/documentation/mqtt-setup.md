# Setting Up MQTT with Mosquitto and TLS/SSL

This guide walks through the process of installing and configuring a secure MQTT broker using Mosquitto with TLS/SSL encryption.

## 1. Installation

First, install Mosquitto and client tools:

```bash
sudo apt install -y mosquitto mosquitto-clients
```

## 2. Initial Service Setup

Enable and start the Mosquitto service:

```bash
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

## 3. Authentication Setup

Create a password file for MQTT authentication:

```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd mqtt_user
# Enter your password when prompted
```

## 4. SSL/TLS Certificate Creation

Create the certificates directory and generate self-signed certificates:

```bash
# Create certificates directory
sudo mkdir -p /etc/mosquitto/certs

# Generate a self-signed certificate
sudo openssl req -new -x509 -days 365 -nodes \
  -out /etc/mosquitto/certs/server.crt \
  -keyout /etc/mosquitto/certs/server.key \
  -subj "/CN=mqtt.yourdomain.com"

# Copy server certificate as CA certificate
sudo cp /etc/mosquitto/certs/server.crt /etc/mosquitto/certs/ca.crt

# Set proper permissions
sudo chown mosquitto:mosquitto -R /etc/mosquitto/certs
sudo chmod 600 /etc/mosquitto/certs/server.key
```

## 5. Mosquitto Configuration

Create a configuration file with local, TLS, and WebSocket support:

```bash
sudo sh -c 'cat > /etc/mosquitto/conf.d/default.conf << EOF
# Basic configuration
listener 1883 localhost
allow_anonymous false
password_file /etc/mosquitto/passwd

# TLS/SSL configuration
listener 8883
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
cafile /etc/mosquitto/certs/ca.crt
require_certificate false

# WebSocket configuration
listener 9001
protocol websockets
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
EOF'
```

## 6. Apply Configuration

Restart the service to apply the configuration:

```bash
sudo systemctl restart mosquitto
```

Verify that the service is running:

```bash
sudo systemctl status mosquitto
```

## 7. Firewall Configuration (Optional)

If you have a firewall enabled, allow the MQTT ports:

```bash
sudo ufw allow 8883/tcp  # MQTT over TLS
sudo ufw allow 9001/tcp  # MQTT over WebSockets
```

## 8. Testing the Connection

### Test with mosquitto_pub and mosquitto_sub:

In one terminal:
```bash
mosquitto_sub -h localhost -t "test/topic" -u mqtt_user -P your_password
```

In another terminal:
```bash
mosquitto_pub -h localhost -t "test/topic" -m "Hello MQTT" -u mqtt_user -P your_password
```

### Test TLS connection:

```bash
mosquitto_sub -h localhost -p 8883 --cafile /etc/mosquitto/certs/ca.crt -t "test/topic" -u mqtt_user -P your_password
```

## Configuration Summary

Your MQTT broker is now configured with:

- **Local MQTT** (port 1883): Only accessible from localhost
- **MQTT over TLS** (port 8883): Secure encrypted connections
- **MQTT over WebSockets** (port 9001): For web browser clients
- **Authentication**: Required using password file
- **Encryption**: TLS/SSL for secure communication

You can now connect IoT devices, applications, and services securely to your MQTT broker.