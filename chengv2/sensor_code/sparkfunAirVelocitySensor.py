from machine import Pin, I2C
import time

# Define FS3000 constants
FS3000_ADDRESS = 0x28  # Default I2C address for FS3000
FS3000_VELOCITY_REG = 0x00  # Register to read air velocity

# I2C setup for sensors
I2C_SDA_PIN = 4  # GP4 on the Pico W
I2C_SCL_PIN = 5  # GP5 on the Pico W

# Initialize I2C with lower frequency for better compatibility with both sensors
i2c = I2C(0, sda=Pin(I2C_SDA_PIN), scl=Pin(I2C_SCL_PIN), freq=10000)

def read_fs3000():
    # Read 2 bytes from the velocity register
    data = i2c.readfrom_mem(FS3000_ADDRESS, FS3000_VELOCITY_REG, 2)
    
    # Convert the 2 bytes to a 16-bit integer (big-endian)
    raw_value = (data[0] << 8) | data[1]
    
    # Calculate velocity in meters per second
    # Note: This conversion may need adjustment based on your specific sensor configuration
    velocity_mps = convert_raw_to_velocity(raw_value)
    
    return velocity_mps

def convert_raw_to_velocity(raw_value):
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

# Main loop
while True:
    try:
        velocity = read_fs3000()
        print(f"Air Velocity: {velocity:.2f} m/s")
    except Exception as e:
        print(f"Error: {e}")
    
    time.sleep(1)
