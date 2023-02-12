const Utils   = require('./utils.js');
const config  = require('./config.json');

class Config {

    static app()     { return config.app;     }
    static ctrl()    { return config.ctrl;    }
    static devices() { return config.devices; }
    static groups()  { return config.groups;  }
    static nodes()   { return config.nodes;   }
    static actions() { return config.actions; }
    static timers()  { return config.timers;  }

    // recursively find all nodes in groups belonging to name
    static findNodes(name) {

        // recursive find, may return null, node, [node], or [node, node, ..], [node, null, ...]
        function find(name) {

            // go down into groups
            let group = config.groups.find(g => g.name === name);
            if (group) {
                let nodes = [];

                // group of groups
                if (group.groups) {
                    nodes = nodes.concat(group.groups.map(g => {let nodes = find(g);
                                                                if ([nodes].flat().includes(false))
                                                                    console.error(`Config Error: group ${group} contains invalid group ${g}`);
                                                                return nodes; })
                                                     .flat()
                                                     .filter(n => n !== false));
                }

                // groups of nodes
                if (group.nodes) {
                    nodes = nodes.concat(group.nodes.map(n => {let nodes = find(n);
                                                               if ([nodes].flat().includes(false))
                                                                   console.error(`Config Error: group ${group} contains invalid node ${n}`);
                                                               return nodes; })
                                                    .flat()
                                                    .filter(n => n !== false));
                }

                return nodes;
            }

            // at the end, everything must be a node
            let node = config.nodes.find(n => n.name === name);
            if (node)
                return node;

            // nothing not found
            return false;
        }

        let nodes = find(name);

        // flatten and remove not found nodes
        nodes = [nodes].flat();
        
        return nodes;
    }

    // get defined colors as RGB
    static getRGB(name) {
        
        // try to find it in config
        let color = config.colors.find(c => c.name === name);
        if (color) {
            if (color.rgb) 
                return color.rgb
            if (color.hex)
                return Utils.hexToRGB(color.hex);
        }

        // try raw hex value
        if (color = Utils.hexToRGB(name))
            return color;

        // not found
        return undefined;
    }
}

module.exports = Config;