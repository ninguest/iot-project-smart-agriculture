import network
import ubinascii
import ubluetooth
import urequests
import utime
from machine import ADC, I2C, Pin


SSID = "T"
PASSWORD = "thisispassword123"

API_URL = "https://iot.ycstation.work/sensors"

DEVICE_ID = "Xiaomi"
DEVICE_MAC_ADDRESS = "a4c1384d8de3"

CHARACTERISTIC_HANDLE = 0x0038
VALUE_TO_WRITE = b'\x01\x00'

WLAN = network.WLAN(network.STA_IF)

moisture_sensor = ADC(26)

# Define FS3000 constants
FS3000_ADDRESS = 0x28  # Default I2C address for FS3000
FS3000_VELOCITY_REG = 0x00  # Register to read air velocity

# I2C setup for sensors
I2C_SDA_PIN = 4  # GP4 on the Pico W
I2C_SCL_PIN = 5  # GP5 on the Pico W

# Initialize I2C with lower frequency for better compatibility with both sensors
i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)


class XiaoMiTemp:
    def __init__(self, device_id, moisture_sensor, i2c):
        self.DEVICE_ID = device_id
        self.moisture_sensor = moisture_sensor
        self.i2c = i2c
        self.ble = ubluetooth.BLE()
        self.ble.active(True)
        self.ble.irq(self.ble_irq)
        self.conn_handle = None
        self.disconnect_flag = False

    def ble_irq(self, event, data):
        if event == 5:
            addr_type, addr, adv_type, rssi, adv_data = data
            addr_str = ubinascii.hexlify(addr).decode('utf-8')
            if addr_str == DEVICE_MAC_ADDRESS:
                print("Device found:", addr_str)
                self.ble.gap_scan(None)
                self.connect_to_device(addr)

        elif event == 7:
            print("Connected to device")
            self.conn_handle = data[0]
            self.ble.gattc_discover_characteristics(self.conn_handle, 0x0001, 0xFFFF)
            
        elif event == 8 and not self.disconnect_flag:
            print("Disconnected from the bluetooth device. Attempting to reconnect...")
            self.start_scan()

        elif event == 12:
            print("Characteristic discovery completed.")
            self.ble.gattc_write(self.conn_handle, CHARACTERISTIC_HANDLE, VALUE_TO_WRITE)

        elif event == 18:
            conn_handle, value_handle, notify_data = data
            self.handle_notification(notify_data)

    def handle_notification(self, data):
        databytes = bytearray(data)
        print("Raw data:", ubinascii.hexlify(databytes))
        temp = int.from_bytes(databytes[0:2], "little") / 100
        humid = int.from_bytes(databytes[2:3], "little")
        battery = int.from_bytes(databytes[3:5], "little") / 1000
        print(f"Temperature: {temp} C")
        print(f"Humidity: {humid}%")
        print(f"Battery: {battery} V")
        payload = {
            "device_id": self.DEVICE_ID,
            "sensors": {
                "temperature": {
                    "value": temp,
                    "unit": "C"
                },
                "humidity": {
                    "value": humid,
                    "unit": "%"
                },
                "battery": {
                    "value": battery,
                    "unit": "V"
                },
            }
        }

        self.send_to_api(payload)

    def read_moisture(self):
        """Read moisture sensor data"""
        # Read analog value (0-65535)
        raw_value = self.moisture_sensor.read_u16()
        
        # Convert to percentage (adjust min/max as needed for your sensor)
        # Most soil moisture sensors read lower values when soil is wet
        # You may need to calibrate these values for your specific sensor
        moisture_min = 0      # Adjust based on your sensor's dry reading
        moisture_max = 65535  # Adjust based on your sensor's wet reading
        
        # Invert the percentage calculation if needed
        # Some sensors give high readings when wet, others when dry
        moisture_percentage = 100 - (((raw_value - moisture_min) / (moisture_max - moisture_min)) * 100)
        
        # Ensure value is within 0-100 range
        moisture_percentage = max(0, min(100, moisture_percentage))

        print(f"Moisture Raw Data: {raw_value}")
        print(f"Moisture Percent: {moisture_percentage}")

        payload = {
            "device_id": "Soil Moisture Sensor",
            "sensors": {
                "moisture_raw": {
                    "value": raw_value,
                    "unit": "raw"
                },
                "moisture": {
                    "value": round(moisture_percentage, 1),
                    "unit": "%"
                },
            }
        }

        self.send_to_api(payload)

    def read_fs3000(self):
        # Read 2 bytes from the velocity register
        data = self.i2c.readfrom_mem(FS3000_ADDRESS, FS3000_VELOCITY_REG, 2)
        
        # Convert the 2 bytes to a 16-bit integer (big-endian)
        raw_value = (data[0] << 8) | data[1]
        
        # Calculate velocity in meters per second
        # Note: This conversion may need adjustment based on your specific sensor configuration
        velocity_mps = self.convert_raw_to_velocity(raw_value)
        payload = {
            "device_id": "FS3000 Air Velocity Sensor",
            "sensors": {
                "air_velocity_raw": {
                    "value": raw_value,
                    "unit": "raw"
                },
                "air_velocity": {
                    "value": velocity_mps,
                    "unit": "mps"
                },
            }
        }
        self.send_to_api(payload)

    def convert_raw_to_velocity(self, raw_value):
        # Check which version of sensor (7.5 m/s or 15 m/s)
        MAX_VELOCITY = 7.5  # Change to 15 if you have the 15 m/s version
        
        # Handle special cases
        if raw_value == 0 or raw_value == 65535:  # 0 or 0xFFFF
            return 0
        
        # Proper conversion formula for FS3000
        # The raw values are non-linear and need lookup or formula
        if raw_value < 1024:
            # Low velocity formula - values from datasheet
            velocity = raw_value / 1024 * 1.25
        elif raw_value < 8192:
            # Mid velocity formula
            velocity = (raw_value - 1024) / 7168 * 3.75 + 1.25
        else:
            # High velocity formula
            velocity = (raw_value - 8192) / 57343 * 2.5 + 5.0
        
        # Scale to the maximum velocity of your sensor
        velocity = min(velocity, MAX_VELOCITY)    
        return velocity

    def send_to_api(self, payload):
        try:
            response = urequests.post(API_URL, json=payload)
            print("API response:", response.status_code, response.text)
            response.close()
        except Exception as e:
            print("Failed to send data to API:", e)

    def connect_to_device(self, addr):
        self.ble.gap_connect(0, addr)

    def start_scan(self):
        self.ble.gap_scan(0, 30000, 30000)

    def disconnect(self):
        self.disconnect_flag = True
        self.ble.gap_disconnect(self.conn_handle)
        self.ble.active(False)
        print("Gracefully disconnected from the bluetooth device.")


def connect_wifi():
    connection_attempts = 0
    WLAN.active(True)
    
    print(f"Connecting to {SSID}...")
    WLAN.connect(SSID, PASSWORD)

    while True:
        if WLAN.status() == 3:
            break

        connection_attempts += 1
        print(f"Connecting... ({connection_attempts} Attempts)")
        utime.sleep(1)

    print(f"Connected with IP address: {WLAN.ifconfig()[0]} ({connection_attempts} Attempts)")
    return True


def disconnect_wifi():
    WLAN.active(False)
    print("Gracefully disconnected from the Wifi.")


def main():
    xiaomi = XiaoMiTemp(DEVICE_ID, moisture_sensor, i2c)

    try:
        connect_wifi()
        xiaomi.start_scan()

        while True:
            xiaomi.read_moisture()
            xiaomi.read_fs3000()
            utime.sleep(1)

    except KeyboardInterrupt:
        disconnect_wifi()
        xiaomi.disconnect()


if __name__ == "__main__":
    main()


