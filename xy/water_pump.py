# from machine import Pin, PWM
# import time
# 
# in1 = Pin(3, Pin.OUT)   # Control Pin 1
# in2 = Pin(4, Pin.OUT)   # Control Pin 2
# pwm = PWM(Pin(2))       # PWM Pin (ENA)
# pwm.freq(1000)          # Set frequency
# 
# def pump_on(speed=65535):  # 100% power
#     in1.value(1)
#     in2.value(0)
#     pwm.duty_u16(speed)
# 
# def pump_off():
#     in1.value(0)
#     in2.value(0)
#     pwm.duty_u16(0)
# 
# # Run the pump for 5 seconds at full power
# pump_on(65535)  # 100% power
# time.sleep(5)
# pump_off()
# Alt + 3 -- comment

from machine import Pin, PWM, ADC
import time
import xlsxwriter

# Define pins
moisture_sensor = ADC(28)  # Soil moisture sensor connected to ADC pin (GP28)
in1 = Pin(3, Pin.OUT)      # Motor driver control pin 1
in2 = Pin(4, Pin.OUT)      # Motor driver control pin 2
pwm = PWM(Pin(2))          # PWM Pin (ENA)
pwm.freq(1000)             # Set frequency

# Thresholds
MOISTURE_THRESHOLD = 40  # Adjust based on your soil and sensor readings
LOG_FILE = "moisture_log.xlsx"

# Initialize Excel file
workbook = xlsxwriter.Workbook(LOG_FILE)
worksheet = workbook.add_worksheet()
worksheet.write(0, 0, "Timestamp")
worksheet.write(0, 1, "Moisture Level (%)")
worksheet.write(0, 2, "Pump Status")
row = 1  # Row counter

def get_moisture_level():
    """Reads soil moisture sensor and returns a percentage."""
    raw_value = moisture_sensor.read_u16()  # ADC reads 0-65535
    moisture_percentage = round(100 - ((raw_value / 65535) * 100), 2)  # Invert the value
    return moisture_percentage

def pump_on(speed=65535):
    """Turns the water pump on."""
    in1.value(1)
    in2.value(0)
    pwm.duty_u16(speed)
    print("Pump ON")

def pump_off():
    """Turns the water pump off."""
    in1.value(0)
    in2.value(0)
    pwm.duty_u16(0)
    print("Pump OFF")

def log_data(moisture, pump_status):
    """Logs data into an Excel sheet."""
    global row
    timestamp = time.localtime()
    time_str = "{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}".format(*timestamp[:6])
    worksheet.write(row, 0, time_str)
    worksheet.write(row, 1, moisture)
    worksheet.write(row, 2, pump_status)
    row += 1
    workbook.close()  # Save the file

def check_moisture_and_control_pump():
    """Checks soil moisture level and controls the water pump accordingly."""
    moisture = get_moisture_level()
    print(f"Moisture Level: {moisture}%")

    if moisture < MOISTURE_THRESHOLD:
        print("Soil is dry, activating pump...")
        pump_on()
        log_data(moisture, "ON")
        # Wait for moisture to increase
        while get_moisture_level() < MOISTURE_THRESHOLD:
            time.sleep(10)  # Wait 10 seconds before rechecking
        print("Soil is sufficiently moist, turning pump off.")
        pump_off()
        log_data(get_moisture_level(), "OFF")
    else:
        print("Soil is moist, no need to water.")
        log_data(moisture, "OFF")

# Main loop: Check every 30 minutes
while True:
    check_moisture_and_control_pump()
    print("Waiting 30 minutes before next check...\n")
    time.sleep(1800)  # 30 minutes

