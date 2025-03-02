import time

# Configuration
NUM_LEDS = 10  # Simulate a 10-LED strip for testing

# Function to simulate setting colors (instead of lighting up LEDs)
def set_color(color):
    print(f"Setting all {NUM_LEDS} LEDs to {color}")

# Function for a basic color cycle (Red → Green → Blue)
def color_cycle():
    while True:
        set_color((255, 0, 0))  # Simulated Red
        time.sleep(1)

        set_color((0, 255, 0))  # Simulated Green
        time.sleep(1)

        set_color((0, 0, 255))  # Simulated Blue
        time.sleep(1)

# Function for a rainbow effect (Simulated)
def rainbow_cycle(wait=0.05):
    for j in range(255):
        simulated_leds = [(i * j % 255, (i * 5) % 255, (j * 10) % 255) for i in range(NUM_LEDS)]
        print(f"Simulated LED Colors: {simulated_leds}")  # Print the LED colors instead of lighting them up
        time.sleep(wait)

# Run the rainbow simulation
rainbow_cycle()
