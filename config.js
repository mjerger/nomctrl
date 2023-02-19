const Utils   = require('./utils.js');
const config  = require('./config.json');

class Config {

    static app()     { return config.app;     }
    static ctrl()    { return config.ctrl;    }
    static devices() { return config.devices; }
    static nodes()   { return config.nodes;   }
    static groups()  { return config.groups;  }
    static actions() { return config.actions; }
    static timers()  { return config.timers;  }
    static colors()  { return config.colors;  }

    static validate() {
        
        // unique ids for devices, nodes, groups and colors
        let ids = new Set();
        let unique = true;
        function check(item) { 
            if(ids.has(item.id)) {
                unique = false;
                console.log(`Config Error: duplicate id ${item.id}`);
            } else {
                ids.add(item.id);
            }
        }

        this.devices().forEach(check);
        this.nodes  ().forEach(check);
        this.groups ().forEach(check);
        this.colors ().forEach(check);

        return unique;
    }

    // get defined colors as RGB
    static toColor(str) {

        // alias resolver
        function resolve(color) {
            if (color.color) 
                return resolve(config.colors.find(c => c.id === color.color));
            else
                return color;
        }
        
        // try to find it in config
        let color = config.colors.find(c => c.id === str);
        if (color) {
            color = resolve(color);
            if (color.rgb) 
                return color.rgb
            else if (color.hex) 
                return Utils.hexToRGB(color.hex);
        }

        // try raw hex value kast
        if (color = Utils.hexToRGB(str))
            return color;

        // not found
        return undefined;
    }
}

module.exports = Config;