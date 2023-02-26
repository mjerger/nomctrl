const Config  = require('./config.js');
const Devices = require('./devices.js');

class Node 
{
    constructor(cfg_node) { 
        this.id = cfg_node.id;
        this.device = cfg_node.device;
        this.class = cfg_node.class;
        this.parent = cfg_node.parent;
    }

    getter() {
        return Devices.get(this.device).getter;
    }
    
    setter() {
        return Devices.get(this.device).setteer;
    }
    
    hasSet(attr) {
        const device = Devices.get(this.device);
        return device && device.hasSet(attr);
    }

    hasGet(attr) {
        const device = Devices.get(this.device);
        return device && device.hasGet(attr);
    }

    async get (attr) {
        console.log(`get ${this.id} ${attr}`);
        const device = Devices.get(this.device);
        return device.call(this, 'get', attr, null);
    }

    async set (attr, val=null) {
        console.log(`set ${this.id} ${attr}${val ? ' ' + val : ''}`);
        const device = Devices.get(this.device);
        return device.call(this, 'set', attr, val);
    }

    is_online () {
        return Devices.get(this.device).online;
    }
}


class Nodes
{
    static nodes = new Map();
    static groups = new Map();

    // Note: load after devices
    static init(cfg_nodes, cfg_groups) {
        console.log ('Loading nodes...');

        let error = false;
        
        // load nodes
        Nodes.nodes.clear();
        for (const cfg of cfg_nodes) {

            // device must exist
            let device = Devices.get(cfg.device);
            if (device) {
                Nodes.nodes.set(cfg.id, new Node(cfg));
            }
            else
            {
                console.log (`Config Error: Node '${cfg.id}' has unknown device '${cfg.device}'`)
            }
        }

        // helper to recursively resolve one group config item into a list of all referenced nodes
        function resolve(cfg_group, group_ids = []) {
            let node_ids = [];

            // group references
            if (cfg_group.groups) {
                for (const id of cfg_group.groups) {
                    const cfg = Config.groups().find(g => g.id === id);
                    if (!cfg) {
                        console.log(`Config Error: Group '${cfg_group.id}' contains reference to invalid group '${id}'`)
                    } else if (group_ids.includes(id)) {
                        console.log(`Config Error: Circular reference with group id '${id}'`);
                    } else if (cfg_group.id === id) {
                        console.log(`Config Error: Group '${id}' references itself'`);
                    } else {
                        group_ids.push(id);
                        const sub_nodes = resolve(cfg, group_ids);
                        node_ids = node_ids.concat(sub_nodes);
                    }
                }
            }

            // node references
            if (cfg_group.nodes) {
                for (const id of cfg_group.nodes) {
                    if (!Nodes.get(id)) {
                        console.log(`Config Error: Group '${cfg_group.id}' contains reference to invalid node '${id}'`)
                        error = true;
                    } else {
                        node_ids.push(id);
                    }
                }
            }

            return node_ids;
        }

        // Load groups
        console.log ('Loading groups...');
        Nodes.groups.clear();
        for (const cfg of cfg_groups) {
            Nodes.groups.set(cfg.id,  resolve(cfg));
        }
    }

    static all() {
        const values =  Nodes.nodes.values();
        return values;
    }

    static get(id) {
        return Nodes.nodes.get(id);
    }

    
    // get list of nodes, either by node id or by group id; use opts for filtering
    static getNodes(id, opts={}) {
        let found_nodes = [];

        // simple node id
        const node = Nodes.nodes.get(id);
        if (node) {
            found_nodes.push(node);

        // maybe a group id
        } else {
            const group_nodes = Nodes.groups.get(id);
            if (group_nodes)
                found_nodes = found_nodes.concat(group_nodes.map(id => Nodes.nodes.get(id)));
        }

        // filter
        if (!('include_timed' in opts)) {
            found_nodes = found_nodes.filter(n => !Config.timers().find(t => t.node === n.id && t.strict && t.strict === true))
        }

        return found_nodes;
    }

}

module.exports = Nodes;