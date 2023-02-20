const Config  = require('./config.js');
const Devices = require('./devices.js');


class Node {
    
    constructor(cfg_node) { 
        this.id = cfg_node.id;
        this.device = cfg_node.device;
        this.class = cfg_node.class;
        this.parent = cfg_node.parent;
    }

    async get (attr) {
        console.log(`get ${this.id} ${attr}${val !== undefined ? " " + val : ""}`);

        let device = Devices.get(this.device);
        if (device.multi_node)
            return device.call(this, "get", attr, val);
        else
            return device.call(null, "get", attr, val);
    }

    async set (attr, val) {
        console.log(`set ${this.id} ${attr}${val !== undefined ? " " + val : ""}`);

        let device = Devices.get(this.device);
        if (device.multi_node)
            return device.call(this, "set", attr, val);
        else
            return device.call(null, "set", attr, val);
    }

    is_online () {
        return Devices.get(this.device).online;
    }
}


class Nodes
{
    static nodes = {};
    static groups = {};

    // Note: load after devices
    static load(cfg_nodes, cfg_groups) {
        console.log ("Loading nodes...");

        let error = false;
        
        // load nodes
        Nodes.nodes = {};
        for (let cfg of cfg_nodes) {

            // device must exist
            let device = Devices.get(cfg.device);
            if (device) {
                Nodes.nodes[cfg.id] = new Node(cfg);
            }
            else
            {
                console.log (`Config Error: Node "${cfg.id}" has unknown device "${cfg.device}"`)
            }
        }

        // helper to recursively resolve one group config item into a list of all referenced nodes
        function resolve(cfg_group, group_ids = []) {

            let node_ids = [];

            // group references
            if (cfg_group.groups) {
                for (let id of cfg_group.groups) {
                    let cfg = Config.groups().find(g => g.id === id);
                    if (!cfg) {
                        console.log(`Config Error: Group "${cfg_group.id}" contains reference to invalid group "${id}"`)
                    } else if (group_ids.includes(id)) {
                        console.log(`Config Error: Circular reference with group id "${id}"`);
                    } else if (cfg_group.id === id) {
                        console.log(`Config Error: Group "${id}" references itself"`);
                    } else {
                        group_ids.push(id);
                        let sub_nodes = resolve(cfg, group_ids);
                        node_ids = node_ids.concat(sub_nodes);
                    }
                }
            }

            // node references
            if (cfg_group.nodes) {
                for (let id of cfg_group.nodes) {
                    if (!Nodes.get(id)) {
                        console.log(`Config Error: Group "${cfg.id}" contains reference to invalid node "${id}"`)
                        error = true;
                    } else {
                        node_ids.push(id);
                    }
                }
            }


            return node_ids;
        }

        // Load groups
        console.log ("Loading groups...");
        Nodes.groups = {};
        for (let cfg of cfg_groups) {
            Nodes.groups[cfg.id] = resolve(cfg);
        }
    }

    static all() {
        return Object.entries(Nodes.nodes);
    }

    static get(id) {
        return Nodes.nodes[id];
    }

    // get list of nodes, either by node id or by group id; use opts for filtering
    static getNodes(id, opts={}) {

        let found_nodes = [];

        // simple node id
        let node = Nodes.nodes[id];
        if (node) {
            found_nodes.push(node);

        // maybe a group id
        } else {
            let group_nodes = Nodes.groups[id];
            if (group_nodes)
                found_nodes = found_nodes.concat(group_nodes);
        }

        // filter
        if (!("include_timed" in opts)) {
            found_nodes.filter(Config.timers().find(t => t.node == id && t.strict && t.strict === true))
        }

        return found_nodes;
    }

}

module.exports = Nodes;