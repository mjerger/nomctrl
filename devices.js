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
                    
                    get_status() { return Utils.get     (this.host, "/cm?cmnd=status")}
                    set_on    () { return Utils.getAsync(this.host, "/cm?cmnd=power+on") }
                    set_off   () { return Utils.getAsync(this.host, "/cm?cmnd=power+off") }
                    set_flip  () { return Utils.getAsync(this.host, "/cm?cmnd=power+toggle") }
                },
                
    "wled"    : class WLED extends HttpDevice {
                    constructor(config)  { 
                        super("wled", config.name, config.host);
                        this.setter.push(this.rgb.name, 
                                         this.brightness.name);
                    }
                    
                    static set_path = "/json/state";
                    get_status ()            { return Utils.get      (this.host, WLED.set_path) }
                    set_on     ()            { return Utils.postAsync(this.host, WLED.set_path, { "on" : true  }) }
                    set_off    ()            { return Utils.postAsync(this.host, WLED.set_path, { "on" : false }) }
                    set_flip   ()            { return Utils.postAsync(this.host, WLED.set_path, { "on" : "t"   }) }
                    set_rgb    (color)       { return Utils.postAsync(this.host, WLED.set_path, { "seg" : [ { "col" : color } ] }) }
                    set_brightness (percent) { return Utils.postAsync(this.host, WLED.set_path, { "on" : true, "bri" : (percent*2.55) }) }
                    
                    // helpers
                    rgb(color)          { return this.set("rgb", color); }
                    brightness(percent) { return this.set("brightness", percent); }
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