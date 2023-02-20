const Config  = require('./config.js');
const Utils   = require('./utils.js');

class Device {
    setter = [];
    getter = [];
    
    has(attr)    { return this.setter.includes(attr) || this.getter.includes(attr); }
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

    async get(attr) {
        return this.get_n(null, attr);
    }

    async set(attr, val) {
        return this.set_n(null, attr, val);
    }

    async call(node, prefix, attr, val) {
        if (node) {
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
                        this.getter = ["status", "state"/*,"power"*/];
                    }
                    
                    async get_status() { return Utils.get(this.host, "/cm?cmnd=status")}
                    async get_state () { return { "state" : (Utils.get(this.host, "/cm?cmnd=status").Status.Power === 1) };}
                    async set_on    () { return Utils.get(this.host, "/cm?cmnd=power+on") }
                    async set_off   () { return Utils.get(this.host, "/cm?cmnd=power+off") }
                    async set_flip  () { return Utils.get(this.host, "/cm?cmnd=power+toggle") }
                },
                
    "wled"    : class WLED extends HttpDevice {
                    constructor(config)  { 
                        super(config);
                        this.setter = ["status", "on", "off", "flip", "rgb", "brightness"];
                    this.getter = ["status", "state"/*, "rgb", "brightness"*/];
                    }
                    
                    static set_path = "/json/state";
                    async get_status ()            { return Utils.get (this.host, WLED.set_path) }
                    async get_state  ()            { return Utils.get (this.host, WLED.set_path) }
                    async set_on     ()            { return Utils.post(this.host, WLED.set_path, { "on" : true  }) }
                    async set_off    ()            { return Utils.post(this.host, WLED.set_path, { "on" : false }) }
                    async set_flip   ()            { return Utils.post(this.host, WLED.set_path, { "on" : "t"   }) }
                    async set_rgb    (color)       { return Utils.post(this.host, WLED.set_path, { "seg" : [ { "col" : [color] } ] }) }
                    async set_brightness (percent) { return Utils.post(this.host, WLED.set_path, { "on" : true, "bri" : Math.floor(percent*2.55) }) }
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
    static devices = {};

    static load(cfg_devices) {
        console.log ("Loading devices...");
        Devices.device = {};
        let error = false;

        for (let cfg of cfg_devices) {
            if (cfg.type in drivers) {
                Devices.devices[cfg.id] = new drivers[cfg.type](cfg);
            } else {
                console.error(`Config Error: Device ${cfg.id} has unknown device type ${cfg.type}.`);
                error = true;
            }
        }
        
        return error;
    }

    static all() {
        return Object.entries(Devices.devices);
    }

    static get(id) {
        return Devices.devices[id];
    }

    static mark_online(id) {
        Devices.devices[id].online = true;
    }

    static getDriver(type, host) {
        return new drivers[type](host);
    }

    static hasDriver(type) {
        return drivers.includes(type);
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