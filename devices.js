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

    set(id, val) { 
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

    get(id) { 
        console.log(`get ${this.name} ${id}`);

        if (this.getter.includes(id))
            return this["get_" + id]();

        console.error(`Device ${this.name} of type ${this.type} has no getter "${id}"`);
    }

    // helpers
    status() { return this.get("on");   }
    on()     { return this.set("on");   }
    off()    { return this.set("off");  }
    flip()   { return this.set("flip"); }
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
                        super("tasmota", config.name, config.host);
                    }
                    
                    async get_status() { return Utils.get(this.host, "/cm?cmnd=status")}
                    async set_on    () { return Utils.get(this.host, "/cm?cmnd=power+on") }
                    async set_off   () { return Utils.get(this.host, "/cm?cmnd=power+off") }
                    async set_flip  () { return Utils.get(this.host, "/cm?cmnd=power+toggle") }
                },
                
    "wled"    : class WLED extends HttpDevice {
                    constructor(config)  { 
                        super("wled", config.name, config.host);
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
}

class Devices
{
    list = {};
    constructor() {
        Config.devices().forEach( cfg => {
            if (!cfg.type in drivers) {
                console.error(`Config Error: Device ${cfg.name} has unknown device type ${cfg.type}.`);
            } else {
                this.list[cfg.name] = new drivers[cfg.type](cfg);
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