const Config  = require('./config.js');
const Utils   = require('./utils.js');

class Device {
    setter = [];
    getter = [];
    
    hasSet(attr) { return this.setter.includes(attr); }
    hasGet(attr) { return this.getter.includes(attr); }

    online = false;
    last_seen = 0;
    state = {};

    constructor(cfg_device, is_multi_node = false) { 
        this.id   = cfg_device.id;
        this.type = cfg_device.type;
        this.name = cfg_device.name;
        this.multi_node = is_multi_node;
    }

    async call(node, prefix, attr, val) {
        if (this.is_multi_node) {
            assert(node);
            if (val !== undefined)
                return this[prefix + "_" + attr](node, val);
            else
                return this[prefix + "_" + attr](node);
        } else {
            if (val !== undefined)
                return this[prefix + "_" + attr](val);
            else
                return this[prefix + "_" + attr]();
        }
    }

}

class HttpDevice extends Device {
    constructor(cfg_device) { 
        super(cfg_device);
        this.host = cfg_device.host; 
    }
}

const drivers = {
    "tasmota" : class Tasmota extends HttpDevice {
                    constructor(config) { 
                        super(config);
                        this.setter = ["status", "on", "off", "flip",];
                        this.getter = ["status", "state", "power"];
                    }
                    
                    async get_status() { return Utils.get(this.host, "/cm?cmnd=status")}
                    async get_state () { return { "state" : (Utils.get(this.host, "/cm?cmnd=status").Status.Power === 1) };} 
                    async get_power () { Utils.get(this.host, "cm?cmnd=Status+10"); } // TODO convert defined power object
                    async set_on    () { return Utils.get(this.host, "/cm?cmnd=power+on") }
                    async set_off   () { return Utils.get(this.host, "/cm?cmnd=power+off") }
                    async set_flip  () { return Utils.get(this.host, "/cm?cmnd=power+toggle") }
                },
                
    "wled"    : class WLED extends HttpDevice {
                    constructor(config)  { 
                        super(config);
                        this.setter = ["status", "on", "off", "flip", "color", "brightness"];
                        this.getter = ["status", "state", "color", "brightness"];
                    }
                    
                    static set_path = "/json/state";
                    async get_status     ()            { return Utils.get (this.host, WLED.set_path) }
                    async get_state      ()            { return (await Utils.get (this.host, WLED.set_path)).on; }
                    async get_brightness ()            { return (await Utils.get (this.host, WLED.set_path)).bri / 2.55 }
                    async get_color      ()            { return (await Utils.get (this.host, WLED.set_path)).seg[0].col[0]; }
                    async set_on         ()            { return Utils.post(this.host, WLED.set_path, { "on" : true  }) }
                    async set_off        ()            { return Utils.post(this.host, WLED.set_path, { "on" : false }) }
                    async set_flip       ()            { return Utils.post(this.host, WLED.set_path, { "on" : "t"   }) }
                    async set_color      (color)       { return Utils.post(this.host, WLED.set_path, { "seg" : [ { "col" : [color] } ] }) }
                    async set_brightness (percent)     { return Utils.post(this.host, WLED.set_path, { "on" : true, "bri" : Math.floor(percent*2.55) }) }
                },

    "nomframe" : class NomFrame extends HttpDevice {
                    constructor(config) { 
                        super(config);
                        this.setter = ["status", "on", "off", "flip", "brightness"];
                        this.getter = ["status"/*,"brightness"*/];
                    }
                    async get_status()             { return "NOT IMPLEMENTED"; }
                    async set_on    ()             { return Utils.get(this.host, "/r/on") }
                    async set_off   ()             { return Utils.get(this.host, "/r/off") }
                    async set_flip  ()             { return Utils.get(this.host, "/r/flip") }
                    async set_brightness (percent) { return Utils.get(this.host, "/r/brightness?val=" + percent) }
                },                
}

class Devices
{
    static devices = new Map();

    static load(cfg_devices) {
        console.log ("Loading devices...");
        Devices.devices.clear();
        let error = false;

        for (const cfg of cfg_devices) {
            if (cfg.type in drivers) {
                Devices.devices.set(cfg.id, new drivers[cfg.type](cfg));
            } else {
                console.error(`Config Error: Device ${cfg.id} has unknown device type ${cfg.type}.`);
                error = true;
            }
        }
        
        return error;
    }

    static all() {
        return Devices.devices.values();
    }

    static get(id) {
        return Devices.devices.get(id);
    }

    static mark_online(id) {
        Devices.devices.get(id).online = true;
    }

    static async start() {
        console.log ("Starting device monitor");
        Devices.monitor();
    }

    static async monitor() {
        setTimeout(this.monitor.bind(this), /* JS is weird */ Config.ctrl().device_monitor_seconds * 1000);

        // TODO monitoring stuff
        // 1) get state
        // 2) set online state, device state, last seen date
    }
}

module.exports = Devices;