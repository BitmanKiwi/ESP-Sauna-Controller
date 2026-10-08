# ESP Sauna Controller

ESPHome firmware for a DIY sauna controller on a **JC3248W535** touchscreen board (ESP32-S3).
It switches the heater through an SSR, runs a timed session, controls the lights, and serves its own web page.

Shamelessly built using Claude's assistance. 
ESP touch screen via the included link on AliExpress, Also used KICad to build a breakout PCB.
You will need 2x 4 pin JST 1.25 pigtails and 1x 8 pin JST 1.25 pigtail to access the boards IO.

## Features

- Thermostat with an adjustable setpoint and deadband (hysteresis)
- Thermocouple reading (K-type through a MAX31855) with spike rejection and averaging
- Run timer: a fresh run starts when the "enabled" input goes live, and heating stops when it runs out
- Reset and End buttons for the run, on the touchscreen and on the web page
- Lights output, with a separate temperature correction while the lights are on
- Switched supply for an internal thermometer
- Custom web page (mobile friendly): temperature, 60-minute chart, countdown, controls and settings
- Safety: an implausible or missing temperature reading switches the heater off

## Files

| File | Purpose |
|------|---------|
| `sauna-controller.yaml` | The ESPHome configuration |
| `www/sauna-page.js` | The custom web page, built into the firmware |
| `secrets.example.yaml` | Template for `secrets.yaml` (copy and fill in) |
| `docs/JC3248W535/` | Board specification, pin map, slot drawings, chip datasheets, user manual |

## Pins (as wired)

| Function | GPIO | Notes |
|----------|------|-------|
| Heater SSR | 15 | Firmware-controlled only |
| Lights SSR | 16 | |
| Thermometer supply | 9 | |
| Enable input | 17 | Silkscreened "IO18" on the interface PCB (labels swapped) |
| MAX31855 | 5 (DO), 6 (CS), 7 (CLK) | Separate SPI bus |

## Setup

1. Copy `secrets.example.yaml` to `secrets.yaml` and fill in your own values. `secrets.yaml` is git-ignored.
2. From the folder containing the yaml, build and flash:

   ```
   esphome run sauna-controller.yaml
   ```

3. Open the controller's address in a browser and sign in as `admin` with your `web_password`.

The web login is plain HTTP, so keep the controller off the internet.

## Using it

### Install and first flash

1. Install ESPHome (needs Python): `pip install esphome`. Check it with `esphome version`.
2. Create `secrets.yaml` (see above), then connect the board by USB and run `esphome run sauna-controller.yaml`. Pick the serial port when it asks.
3. After that first flash, `esphome run sauna-controller.yaml` can update it over WiFi (OTA). It asks for the `ota_password` from `secrets.yaml`.
4. The first build takes a few minutes. Later ones are faster because ESPHome keeps a build cache in `.esphome/`. That folder is generated, so it is git-ignored and safe to delete. The next build recreates it.

If a change doesn't seem to take effect, check the end of the `esphome run` output for a successful upload, and confirm the file you edited is the one you ran.

### How a run works

- The controller only heats while the **enable input** (GPIO17) is on, for example from a smart switch in series with the element power.
- When the input goes on, a fresh run starts (75 minutes by default, set by `run_time_minutes` at the top of the yaml) and the sauna heats to the setpoint.
- When the time runs out, heating stops and the status shows **Times Up**. **Reset** starts a fresh run if the input is still on. **End** stops the run immediately.
- If the input goes off, the run is cleared. The next time it goes on, you get a full new run.
- The status shows **Ready** (input on), **Not Ready** (input off) or **Times Up**.

### Web page

Open the controller's address in a browser and sign in as `admin`.

- The page shows the temperature, a heating indicator, a 60-minute chart (dashed line is the setpoint, shaded bands are heating), and the time left.
- **Reset** and **End** are side by side. Use the **−** and **+** buttons or type a number for the setpoint.
- The lights button turns the lights on and off.
- **Settings** holds the deadband (how far below the setpoint before the heater turns back on), the calibration offset, the offset with the lights on, the thermometer supply switch, and a two-decimal reading for calibration.
- The footer says when data last arrived. If it reports missing items, an entity name in the yaml has changed and the page needs updating to match.
- Add `?stock` to the address to load ESPHome's stock page instead. That needs internet on the device you're browsing from.

### Touchscreen

- Tap the lights circle (centre) to toggle the lights.
- Tap the time remaining to reset the run.
- Tap the heating LED (right of the timer) to end the run.
- **−** and **+** at the bottom change the setpoint.

### Calibration

1. Set **Calibration offset** so the reading matches a reference thermometer. Use a stable temperature and wait about 20 seconds for the filters to settle.
2. If the reading shifts when the lights come on, note the difference between lights off and lights on, and enter it (with the opposite sign) in **Offset with lights on**.
3. Check at a second, hotter temperature. If the shift changes, it isn't a fixed offset.

### Temperature filtering and safety

Readings pass through a plausibility check (below −20 °C or above 160 °C raw is discarded), a median filter, a moving average, and then the calibration offset. If no valid reading arrives for 30 seconds, the controller treats the temperature as unknown and keeps the heater off.

### Troubleshooting

- **Page is blank or shows the stock list:** the browser may be caching it. Hard-refresh (Ctrl+F5) after a flash.
- **Noisy or jumping temperature:** keep the thermocouple cable apart from other wiring, ground its screen at the controller end only, and use a clean 12 V supply for the lights.
- **Heater won't turn on:** check the enable input, that the status isn't **Times Up**, and that the temperature is below the setpoint minus the deadband.

## Parts

- [Product page (AliExpress)](https://www.aliexpress.com/item/1005007566332450.html)
