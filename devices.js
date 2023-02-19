const Config  = require('./config.js');
const Utils   = require('./utils.js');

class Device {
    setter = [ "on", "off", "flip" ];
    getter = [ "status" ];

    constructor(type, name) { 
        this.type = type;
        this.name = name;
    }

    has(action)    { return this.setter.includes(action) || this.getter.includes(action); }
    hasSet(action) { return this.setter.includes(action); }
    hasGet(action) { return this.getter.includes(action); }

    async set(action, val) { 
        if (val)
            console.log(`set ${this.name} ${action} ${val}`);
        else 
            console.log(`set ${this.name} ${action}`);

        if (this.hasSet(action)) 
            if (val !== undefined)
                return this["set_" + action](val);
            else
                return this["set_" + action]();

        console.error(`Device ${this.name} of type ${this.type} has no setter "${action}"`);
    }

    async get(action) { 
        console.log(`get ${this.name} ${action}`);

        if (this.hasGet(action))
            return this["get_" + action]();

        console.error(`Device ${this.name} of type ${this.type} has no getter "${action}"`);
    }

    async do(action, val) {
        if (this.hasSet(action)) return this.set(action, val);
        if (this.hasGet(action)) return this.get(action, val);
    }

    // helpers
    async status() { return this.get("status"); }
    async on()     { return this.set("on");     }
    async off()    { return this.set("off");    }
    async flip()   { return this.set("flip");   }
}

class HttpDevice extends Device {
    constructor(type, name, host) { 
        super(type, name);
        this.host = host; 
    }
}

const drivers = {
    "tasmota" : class Tasmota extends HttpDevice {
                    constructor(config) { 
                        super("tasmota", config.id, config.host);
                    }
                    
                    async get_status() { return Utils.get(this.host, "/cm?cmnd=status")}
                    async get_state () { return { "state" : (Utils.get(this.host, "/cm?cmnd=status").Status.Power === 1) };}
                    async set_on    () { return Utils.get(this.host, "/cm?cmnd=power+on") }
                    async set_off   () { return Utils.get(this.host, "/cm?cmnd=power+off") }
                    async set_flip  () { return Utils.get(this.host, "/cm?cmnd=power+toggle") }
                },
                
    "wled"    : class WLED extends HttpDevice {
                    constructor(config)  { 
                        super("wled", config.id, config.host);
                        this.setter.push(this.rgb.name, 
                                         this.brightness.name);
                    }
                    
                    static set_path = "/json/state";
                    async get_status ()            { return Utils.get (this.host, WLED.set_path) }
                    async set_on     ()            { return Utils.post(this.host, WLED.set_path, { "on" : true  }) }
                    async set_off    ()            { return Utils.post(this.host, WLED.set_path, { "on" : false }) }
                    async set_flip   ()            { return Utils.post(this.host, WLED.set_path, { "on" : "t"   }) }
                    async set_rgb    (color)       { return Utils.post(this.host, WLED.set_path, { "seg" : [ { "col" : [color] } ] }) }
                    async set_brightness (percent) { return Utils.post(this.host, WLED.set_path, { "on" : true, "bri" : Math.floor(percent*2.55) }) }
                    
                    // helpers
                    async rgb(color)          { return this.set("rgb", color); }
                    async brightness(percent) { return this.set("brightness", percent); }
                },

    "nomframe" : class NomFrame extends HttpDevice {
                    constructor(config) { 
                        super("nomframe", config.id, config.host);
                        this.setter.push(this.brightness.name);
                    }
                    async get_status()             { return "NOT IMPLEMENTED"; }
                    async set_on    ()             { return Utils.get(this.host, "/r/on") }
                    async set_off   ()             { return Utils.get(this.host, "/r/off") }
                    async set_flip  ()             { return Utils.get(this.host, "/r/flip") }
                    async set_brightness (percent) { return Utils.get(this.host, "/r/brightness?val=" + percent) }

                    // helpers
                    async brightness(percent) { return this.set("brightness", percent); }
                },                
}

class Devices
{
    list = {};
    constructor() {
        Config.devices().forEach( cfg => {
            if (!cfg.type in drivers) {
                console.error(`Config Error: Device ${cfg.id} has unknown device type ${cfg.type}.`);
            } else {
                this.list[cfg.id] = new drivers[cfg.type](cfg);
            }
        });
    }

    static getDriver(type, host) {
        return new drivers[type](host);
    }

    static hasDriver(type) {
        return drivers.includes(type);
    }

    find(nodeOrDeviceid) {
        let device = this.list[nodeOrDeviceid];
        if (device)
            return device;
        
        let node = Config.nodes().find(n => n.id === nodeOrDeviceid);
        if (node && node.device in this.list)
            return this.list[node.device];
    }

    async set(id, action, val) {
        let device = this.find(id);
        if (device)
            return device.set(action, val);
    }

    async get(id, action, val) {
        let device = this.find(id);
        if (device) 
            return device.get(action, val);
    }

    async do(id, action, val) {
        let device = this.find(id);
        if (device)
            return device.do(action, val);
    }
}

module.exports = Devices;