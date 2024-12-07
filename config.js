const Utils   = require('./utils.js');
const config  = require('./config.json');

class Config {

    static app()     { return config.app;     }
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
}

module.exports = Config;