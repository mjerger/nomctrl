# nomctrl

nomctrl is a simple home automation command center written in Node.js

## Features
 - Configure the whole setup in one nice json
 - Devices, Nodes, Groups, Colors, Patterns, Actions, Triggers, Timers
 - Simple but powerful command language `set apartment cozy-color fade 0% to 100% for 30m`
 - understands dependent nodes (e.g. a light plugged into switchable socket)
 - timers for fixed-scheduled devices, understands `sunset`, `sunrise` etc
 - Actions (groups of commands), triggered by events or time
 - programmable conditions in JS (e.g. turn on light only if movement && dark)

### Supported Devices
 - Tasmota
 - WLED

### Commands
Examples of understood commands

#### Setter
 `set amplifier lamp desk on`
 `set apartment off; set bedroom 20%`
 `set nightstand on for 30m`
 `set livingroom fade from 0 (255,0,0) to 100 #0000FF for 60s`
 `set apartment fireplace` (pattern)
 
 #### Getter
 `get amplifier state`
 `get max apartment power`
 `get sum livingroom bedroom energy_today`

#### Actions
 `do leave_house`
 
 
## TODO
- Logger
- Device monitoring
- cmd: "set .. for 5m"
- cmd: "fade hallway 100.. over 3s for 5m"
- handle dependent nodes
- Events
- Devices
  - ELV power meter via CUL (433/866 usb receiver)
  - nomnodes
  - Mobile device presence via MAC
- Web UI
 - json config with simple nested grid layouts
   - one json per screen (use separate mobile + desktop layout)
 - outputs
   - value with unit
   - graphs
 - inputs
   - switch
   - slider
   - color wheel
   - list select / dropdown for actions
