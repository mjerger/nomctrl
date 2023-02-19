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

    // recursively find all nodes in groups belonging to id
    static findNodes(id, opts={}) {

        // recursive find, may return null, node, [node], or [node, node, ..], [node, null, ...]
        function find(id, opts={}) {

            // go down into groups
            let group = config.groups.find(g => g.id === id);
            if (group) {
                let nodes = [];

                // group of groups
                if (group.groups) {
                    nodes = nodes.concat(group.groups.map(g => {let nodes = find(g, opts);
                                                                if ([nodes].flat().includes(false))
                                                                    console.error(`Config Error: group ${group} contains invalid group ${g}`);
                                                                return nodes; })
                                                     .flat()
                                                     .filter(n => n !== false));
                }

                // groups of nodes
                if (group.nodes) {
                    nodes = nodes.concat(group.nodes.map(n => {let nodes = find(n, opts);
                                                               if ([nodes].flat().includes(false))
                                                                   console.error(`Config Error: group ${group} contains invalid node ${n}`);
                                                               return nodes; })
                                                    .flat()
                                                    .filter(n => n !== false));
                }

                return nodes;
            }

            // at the end, everything must be a node
            let node = config.nodes.find(n => n.id === id);
            if (node) {
                // don't include strictly timer controlled nodes
                if (!("include_timed" in opts)) {
                    if (config.timers.find(t => t.node == id && t.strict && t.strict === true))
                        return false;
                }
                return node;
            }
                

            // nothing not found
            return false;
        }

        let nodes = find(id, opts);

        // flatten and remove not found nodes
        nodes = [nodes].flat();
        
        return nodes;
    }

    // get defined colors as RGB
    static getRGB(str) {
        
        // try to find it in config
        let color = config.colors.find(c => c.id === str);
        if (color) {
            if (color.rgb) 
                return color.rgb
            if (color.hex)
                return Utils.hexToRGB(color.hex);
            if (color.color) {
                color = config.colors.find(c => c.id === color.color);
                if (color)
                    return color;
            }
        }

        // try raw hex value
        if (color = Utils.hexToRGB(str))
            return color;

        // not found
        return undefined;
    }
}

module.exports = Config;