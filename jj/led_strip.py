import machine
import neopixel
import time

# Configuration
LED_PIN = 0       # GPIO0 (Change if using another pin)
NUM_LEDS = 30     # Adjust based on your LED strip length
BRIGHTNESS = 0.5  # Adjust brightness (0.0 to 1.0)

# Initialize WS2812 LED strip
np = neopixel.NeoPixel(machine.Pin(LED_PIN), NUM_LEDS)

# Function to set all LEDs to a specific color
def set_color(color):
    for i in range(NUM_LEDS):
        np[i] = color  # Set each LED to the given color (R, G, B)
    np.write()

# Function for a basic color cycle (Red → Green → Blue)
def color_cycle():
    while True:
        set_color((255, 0, 0))  # Red
        time.sleep(1)

        set_color((0, 255, 0))  # Green
        time.sleep(1)

        set_color((0, 0, 255))  # Blue
        time.sleep(1)

# Function for a rainbow effect
def rainbow_cycle(wait=0.05):
    for j in range(255):
        for i in range(NUM_LEDS):
            np[i] = (i * j % 255, (i * 5) % 255, (j * 10) % 255)  # Dynamic rainbow colors
        np.write()
        time.sleep(wait)

# Run the rainbow effect
rainbow_cycle()
