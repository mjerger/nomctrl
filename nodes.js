const Config  = require('./config.js');
const Devices = require('./devices.js');

class Node 
{
    values = new Map();

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

        // call
        const device = Devices.get(this.device);
        let val = await device.call(this, 'get', attr, null);

        // on success, update value
        if (val) {
            this.values.set(attr, val);
        }

        return val;
    }

    get_current(attr) {
        return this.values[attr];
    }

    async set (attr, val) {
        console.log(`set ${this.id} ${attr}${val !== undefined & val !== null ? ' ' + val : ''}`);

        // call
        const device = Devices.get(this.device);
        let result = await device.call(this, 'set', attr, val);
        
        // on success, cache value if we have a getter for this attribute
        if (result) {
            if (this.hasGet(attr)) {
                this.values.set(attr, val);
            }
        }
        
        return result;
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
        console.log ('Loading Timers...');

        let error = false;
        
        // load nodes
        this.nodes.clear();
        for (const cfg of cfg_nodes) {

            // device must exist
            let device = Devices.get(cfg.device);
            if (device) {
                this.nodes.set(cfg.id, new Node(cfg));
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
        this.groups.clear();
        for (const cfg of cfg_groups) {
            this.groups.set(cfg.id,  resolve(cfg));
        }
    }

    static all() {
        const values =  this.nodes.values();
        return values;
    }

    static get(id) {
        return this.nodes.get(id);
    }

    
    // get list of nodes, either by node id or by group id; use opts for filtering
    static getNodes(id, opts={}) {
        let found_nodes = [];

        // simple node id
        const node = this.nodes.get(id);
        if (node) {
            found_nodes.push(node);

        // maybe a group id
        } else {
            const group_nodes = this.groups.get(id);
            if (group_nodes)
                found_nodes = found_nodes.concat(group_nodes.map(id => this.nodes.get(id)));
        }

        // filter
        if (!('include_timed' in opts)) {
            found_nodes = found_nodes.filter(n => !Config.timers().find(t => t.node === n.id && t.strict && t.strict === true))
        }

        return found_nodes;
    }

}

module.exports = Nodes;