const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Devices = require('./devices.js');
const Nodes   = require('./nodes.js');


const commands = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // execute on of our configured actions
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
}

const tokens = {
    ON      : /^(on|true|yes|bright|full|max.*|ein|an)$/,
    OFF     : /^(off|false|no|none|aus|min.*)$/,
    FLIP    : /^(flip|toggle)$/,
    PERCENT : /^(\d|\d{2}|100|0+)%?$/,
    VALUE   : /^\d+/,
    RGB     : /^\(\d+,\d+,\d+\)$/,
    HEX     : /^\#?[0-9a-fA-F]{6}$/
}

function next(list = []) {
    if (!list)
        return null;
    let item = list[0];
    list.shift()
    return item;
}

class Commands {

    static async execute(cmds, opts={}) {

        // does command a override command b?
        function overrides(a, b) {
            // same command
            if (a === b) return true;

            // off/on/flip has prio
            if (["on", "off", "flip"].includes(a) && 
                ["on", "off", "flip"].includes(b))
            {
                return true;
            }

            return false;
        }

        //
        // 1) PARSE
        //

        // make into list
        if (typeof cmds === "string") {
            if (cmds.indexOf(";") > -1)
                cmds = cmds.split(/;/);
            else
                cmds = [cmds];
        }

        // parse all cmds into todos
        let getter = [];
        let setter = [];
        let errors = [];
        for (const cmd of cmds) {
            const [get, set, err] = Commands.parse(cmd, opts);
            getter = getter.concat(get);
            setter = setter.concat(set);
            errors = errors.concat(err);
        }


        //
        // 2) EXECUTE GETTER
        //

        // remove duplicate getters
        if (getter.length > 1) {
            for (let i = 0; i < getter.length-1; i++) {
                for (let j = i+1; j < getter.length; j++) {
                    // same id
                    if (getter[i][0] === getter[j][0]) {
                        getter.splice(i, 1);
                    }
                }
            }
        }
        
        // call getters
        let get_results = {};
        for (const g of getter) {
            const [id, attr] = g;
            if (!(id in get_results))
                get_results[id] = {};
            get_results[id][attr] = Nodes.get(id).get(attr)
        }

        // await results
        for (const id in get_results) {
            for (const attr in get_results[id]) {
                get_results[id][attr] = await get_results[id][attr];
            }
        }
        
        //
        // 3) EXECUTE SETTER
        //

        // setter conflicts: last command in list overrides previous commands, sometimes
        if (setter.length > 1) {
            for (let i = 0; i < setter.length-1; i++) {
                for (let j = i+1; j < setter.length; j++) {
                    // same device
                    if (setter[i][0] === setter[j][0]) {
                        // next command in list overrides previous one 
                        if (overrides(setter[j][1], setter[i][1])) {
                            setter.splice(i, 1);
                        }
                    }
                }
            }
        }

        // call setter
        let set_results = []; 
        for (const s of setter) {
            if (s.length == 2) {
                const [id, attr] = s;
                set_results.push(Nodes.get(id).set(attr));
            } else if (s.length == 3) {
                const [id, attr, val] = s;
                set_results.push(Nodes.get(id).set(attr, val));
            }
        }
        set_results = await Promise.all(set_results);

        //
        // 4) OUTPUT
        //

        let response = {};
        if (getter.length > 0) {
            response["results"] = get_results;
        }

        if (errors.length > 0) {
            response["errors"] = errors;
            response["status"] = "error";
        } else {
            response["status"] = "success";
        }

        return JSON.stringify(response);
    }

    
    // parse one command
    static parse (cmd = "", opts = {}) {

        let args = cmd.split(/\s+/).filter(a => a);
        let arg = next(args);
        if (!arg)
            return [[],[], "Empty command"];

        let getter = [];
        let setter = [];
        let errors = [];
        
        // STATUS
        if (arg.match(commands.STATUS)) {
            [getter, errors] = Commands.parse_status(arg, args, opts);

        // DO
        } else if (arg.match(commands.DO)) {
            arg = next(args);
            while (arg) {
                let action = Config.actions().find(a => a.id === arg);
                if (!action) {
                    errors.push(`Action "${arg}" not found.`);
                    arg = next(args);
                    continue;
                }

                let cmds = action.do;
                if (cmds.constructor == [].constructor) {
                    for (let cmd of cmds) {
                        let [g,s,e] = Commands.parse(cmd, opts);
                        getter = getter.concat(g);
                        setter = setter.concat(s);
                        errors = errors.concat(e);
                    }
                } else {
                    let [g,s,e]= Commands.parse(cmd, opts);
                    getter = getter.concat(g);
                    setter = setter.concat(s);
                    errors = errors.concat(e);
                }
                arg = next(args);
            }

        // GET
        } else if (arg.match(commands.GET)) {
            [getter, errors] = Commands.parse_get(arg, args, opts);
            
            
        // SET
        } else if (arg.match(commands.SET)) {
            [setter, errors] = Commands.parse_set(arg, args, opts);
        }
            
        return [getter, setter, errors];
    }


    static parse_status(arg, args, opts = {}) {
        let getter = [];
        let errors = [];

        // status of all devices
        arg = next(args);
        if (!arg) {
            const nodes = Nodes.all();
            for (const node of Nodes.all()) {
                if (node.hasGet("status"))
                    getter.push([node.id, "status"]);
            }
        } else {

            // status of nodes
            const nodes = Nodes.getNodes(arg, opts).filter(node => node.hasGet("status"));
            if (nodes.length > 0)
                getter = getter.concat(nodes.map(node => [node.id, "status"]));
            else
                errors.push(`"${arg}" is not a node or status command`); 

            // TODO other special status commands
        }

        return [getter, errors];
    }


    static parse_get (arg, args, opts = {}) {
        let getter = [];
        let errors = [];

        // read args until its not a node or group
        let nodes = [];
        let nodesForArg;
        while ( (nodesForArg = Nodes.getNodes(arg = next(args), opts)).length > 0) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
        } 

        if (nodes.length == 0) {
            errors.push("No nodes found.");
            return [getter, errors];
        }

        // No further arg? get status
        if (!arg) {
            arg = "state"
        } else {
            while (arg)
            {
                for (let node of nodes) {
                    if (node.hasGet(arg))
                        getter.push([node.id, arg]);
                    else if(nodes.length == 1)
                        errors.push(`Node "${node.id}" does not have a getter "${arg}"`);
                }
                arg = next(args);
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);


        return [getter, errors];
    }
    

    static parse_set (arg, args, opts = {}) {
        let setter = [];
        let errors = [];

        // read args until its not a node or group
        let nodes = [];
        let nodesForArg;
        while ( (nodesForArg = Nodes.getNodes(arg = next(args), opts)).length > 0) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
        } 

        if (nodes.length == 0) {
            errors.push("No nodes found.");
            return [setter, errors];
        }
        
        // ON / OFF / FLIP
        if (arg) {
            let matched = false;
            for (let token of [ [tokens.ON, "on"], [tokens.OFF, "off"], [tokens.FLIP, "flip"]]) {
                if (arg.match(token[0])) {
                    for (let node of nodes) {
                        let device = Devices.get(node.device);
                        if (device.hasSet(token[1])) {
                            setter.push([node.id, token[1]])
                        } else if (nodes.length == 1) {
                            errors.push(`Device ${device.id} type ${device.type} of node ${node.id} has no setter ${arg}.`);
                        }
                    };
                    matched = true;
                    break;
                }
            }
            if (matched)
                arg = next(args)
        }
        
        // COLOR arg is optional
        let color;
        if (arg) {
            color = Config.toColor(arg);
            if (color) {
                arg = next(args)
                for (let node of nodes) {
                    let id = node.device;
                    let device = Devices.get(id);

                    // set rgb only if device supports it
                    if (device.hasSet("color")) {
                        setter.push([node.id, "rgb", color]);
                        // also turn on if cmd has no more args
                        if (!arg)
                            setter.push([node.id, "on"])
                    } else if (nodes.length == 1) { 
                        errors.push(`Device ${id} type ${device.type} of node ${node.id} does not support RGB.`);
                    }
                }
            }
        }
        
        // BRIGHTNESS percentage and on/off commands for lights
        if (arg)  {
            var percent;
            if (arg.match(tokens.PERCENT)) {
                percent = parseInt(arg);
                if (percent < 0 || percent > 100)
                    errors.push(`Brightness must be a value between 0 and 100.`)
                arg = next(args);
            } else if (arg.match(tokens.ON)) {
                percent = 100;
                arg = next(args);
            } else if (arg.match(tokens.OFF)) {
                percent = 0;
                arg = next(args);
            } else {
                errors.push(`Unknown argument "${arg}`);
            }

            // set brightness on all nodes
            if (percent) {
                percent = Math.max(Math.min(Math.round(percent), 100), 0);

                for (let node of nodes) {
                    let id = node.device;
                    let device = Devices.get(id);

                    // set brightness if device supports it
                    if (device.has("brightness")) {
                        setter.push([node.id, "brightness", percent]);

                        // additionally set on/off
                        if (percent == 100 && device.hasSet("on"))  setter.push([node.id, "on"]);
                        if (percent == 0   && device.hasSet("off")) setter.push([node.id, "off"]);

                    // no brightness, but has "on": use threshold
                    } else if (node.thresh && percent >= node.thresh && device.has("on") && node.class !== "power") {
                        setter.push([node.id, "on"]);

                    // no brightness, but has "off": use threshold
                    } else if (node.thresh && percent < node.thresh && device.has("off") && node.class !== "power") {
                        setter.push([node.id, "off"]);

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${id} of node ${node.id} does not support brightness control.`);
                    }
                };
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);

        return [setter, errors];
    }

}

module.exports = Commands;