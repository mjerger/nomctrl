const Utils   = require('./utils.js');
const Config  = require('./config.js');

class Device {
    setter = [ "on", "off", "flip" ];
    getter = [ "status" ];

    constructor(type, name) { 
        this.type = type;
        this.name = name;
    }

    has(id)    { return this.setter.includes(id) || this.getter.includes(id); }
    hasSet(id) { return this.setter.includes(id); }
    hasGet(id) { return this.getter.includes(id); }

    async set(id, val) { 
        if (val)
            console.log(`set ${this.name} ${id} ${val}`);
        else 
            console.log(`set ${this.name} ${id}`);

        if (this.setter.includes(id)) 
            if (val !== undefined)
                return this["set_" + id](val);
            else
                return this["set_" + id]();

        console.error(`Device ${this.name} of type ${this.type} has no setter "${id}"`);
    }

    async get(id) { 
        console.log(`get ${this.name} ${id}`);

        if (this.getter.includes(id))
            return this["get_" + id]();

        console.error(`Device ${this.name} of type ${this.type} has no getter "${id}"`);
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
        return type in drivers;
    }
}

module.exports = Devices;