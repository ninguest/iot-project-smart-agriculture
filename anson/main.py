import network
import ubinascii
import ubluetooth
import urequests
import utime

SSID = "OPPO A96"
PASSWORD = "12345678"

API_URL = "https://iot.ycstation.work/sensors"

DEVICE_ID = "Xiaomi"
DEVICE_MAC_ADDRESS = "a4c1384d8de3"

CHARACTERISTIC_HANDLE = 0x0038
VALUE_TO_WRITE = b'\x01\x00'

WLAN = network.WLAN(network.STA_IF)


class XiaoMiTemp:
    def __init__(self, device_id):
        self.DEVICE_ID = device_id
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

        self.send_to_api(temp, humid, battery)

    def send_to_api(self, temp, humid, battery):
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
    xiaomi = XiaoMiTemp(DEVICE_ID)

    try:
        connect_wifi()
        xiaomi.start_scan()

        while True:
            utime.sleep(1)

    except KeyboardInterrupt:
        disconnect_wifi()
        xiaomi.disconnect()


if __name__ == "__main__":
    main()


