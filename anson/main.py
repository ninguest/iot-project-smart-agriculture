import network
import ubinascii
import ubluetooth
import urequests
import utime

SSID = "OPPO A96"
PASSWORD = "123456789"

API_URL = "https://iot.ycstation.work/sensors"

DEVICE_ID = "Xiaomi"
DEVICE_MAC_ADDRESS = "a4c1384d8de3"

CHARACTERISTIC_HANDLE = 0x0038
VALUE_TO_WRITE = b'\x01\x00'

class XiaoMiTemp:
    def __init__(self, device_id):
        self.DEVICE_ID = device_id
        self.ble = ubluetooth.BLE()
        self.ble.active(True)
        self.ble.irq(self.ble_irq)
        self.conn_handle = None

    def ble_irq(self, event, data):
        if event == 5:
            # Handle scan result
            addr_type, addr, adv_type, rssi, adv_data = data
            addr_str = ubinascii.hexlify(addr).decode('utf-8')
            # print(addr_str)
            if addr_str == DEVICE_MAC_ADDRESS:
                print("Device found:", addr_str)
                self.ble.gap_scan(None)
                self.connect_to_device(addr)

        elif event == 7:
            print("Connected to device")
            self.conn_handle = data[0]
            self.ble.gattc_discover_characteristics(self.conn_handle, 0x0001, 0xFFFF)

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
        data1 = "{}, temperature={}".format(self.DEVICE_ID, temp)
        data2 = "{}, humidity={}".format(self.DEVICE_ID, humid)
        data3 = "{}, battery={}".format(self.DEVICE_ID, battery)
        print(data1)
        print(data2)
        print(data3)

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
        self.ble.gap_scan(2000, 30000, 30000)


def connect_wifi() -> bool:
    """Connect to Wi-Fi network"""
    connection_attempts = 0
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    
    print(f"Connecting to {SSID}...")
    wlan.connect(SSID, PASSWORD)
    
    # Wait for connection with timeout
    while True:
        if wlan.status() == 3:
            break

        connection_attempts += 1
        print(f"Connecting... ({connection_attempts} Attempts)")
        utime.sleep(1)

    print(f"Connected with IP address: {wlan.ifconfig()[0]} ({connection_attempts} Attempts)")
    return True


def main():
    if not connect_wifi():
        return

    xiaomi = XiaoMiTemp(DEVICE_ID)
    xiaomi.start_scan()

    while True:
        utime.sleep(1)


if __name__ == "__main__":
    main()

