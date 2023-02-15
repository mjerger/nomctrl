# nomctrl

## TODO
- cmd: "set .. for 5m"
- cmd: "fade hallway 100.. over 3s for 5m"
- handle dependent nodes
- cancel out conflicting device states when chaining dos
- detect circular group definitions
- Triggers
- Timers
  * on/off
  * fading brightness + color
  * timer commands
- Node status json format
- Logging based on status json
- Device status
- Web UI
 - json config with simple nested grid layouts
   * one json per screen (use separate mobile + desktop layout)
 - outputs
   - value with unit
   - graphs
 - inputs
   - switch
   - slider
   - color wheel
   - list select / dropdown for actions
 - Devices
   * ELV power meter via CUL (433/866 usb receiver)
