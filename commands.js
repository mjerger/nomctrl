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

const funcs = ['sum', 'max', 'min', 'avg'];

function next(list = []) {
    if (!list)
        return null;
    let item = list[0];
    list.shift()
    return item;
}

// merge arrays of object b into arrays of object a and return a
function merge(a, b) {
    for (let x in b) {
        if (!(x in a)) a[x] = b[x];
        else           a[x] = a[x].concat(b[x]);
    }

    return a;
}

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

class Commands {

    static async execute(cmds, opts={}) {
        let results = {};


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
        let todo = {};
        for (const cmd of cmds) {
             let res = Commands.parse(cmd, opts);
             todo = merge(todo, res);
        }

        //
        // 2) EXECUTE GETTER
        //

        if (todo.getter) {

            // remove duplicate getters
            const count = todo.getter.length;
            if (count > 1) {
                for (let i = 0; i < count-1; i++) {
                    for (let j = i+1; j < count; j++) {
                        // same id
                        if (todo.getter[i][0] === todo.getter[j][0]) {
                            todo.getter.splice(i, 1);
                        }
                    }
                }
            }
            
            // call getters
            let get_results = {};
            for (const g of todo.getter) {
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

            // apply calc funcs
            if (todo.calc) {

                // collect attributes
                let attrs = [];
                for (const id in get_results)
                    for (const attr in get_results[id])
                        if (!attrs.includes(attr)) 
                            attrs.push(attr);


                // calc
                for (const attr of attrs) {
                    // pre
                    let res_val = 0;
                    switch (todo.calc) {
                        case "min": res_val = Number.MAX_SAFE_INTEGER; break; 
                        case "max": res_val = Number.MIN_SAFE_INTEGER; break;
                    }
                    // iter
                    let count = 0;
                    for (const id in get_results) {
                        if (attr in get_results[id]) {
                            count += 1;
                            const val = get_results[id][attr]; 
                            switch (todo.calc) {
                                case "sum": res_val += val; break;
                                case "avg": res_val += val; break;
                                case "min": res_val = Math.min(res_val, val); break;
                                case "max": res_val = Math.max(res_val, val); break;
                            }
                        }
                    }
                    // post
                    switch (todo.calc) {
                        case "avg" : res_val /= count; break;
                    }

                    results[attr + "_" + todo.calc] = res_val;
                }
            } else {
                results = get_results;
            }
        }
        
        //
        // 3) EXECUTE SETTER
        //

        if (todo.setter) {
            // setter conflicts: last command in list overrides previous commands, sometimes
            if (todo.setter.length > 1) {
                for (let i = 0; i < todo.setter.length-1; i++) {
                    for (let j = i+1; j < todo.setter.length; j++) {
                        // same device
                        if (todo.setter[i][0] === todo.setter[j][0]) {
                            // next command in list overrides previous one 
                            if (overrides(todo.setter[j][1], todo.setter[i][1])) {
                                todo.setter.splice(i, 1);
                            }
                        }
                    }
                }
            }

            // call setter
            let set_results = []; 
            for (const s of todo.setter) {
                if (s.length == 2) {
                    const [id, attr] = s;
                    set_results.push(Nodes.get(id).set(attr));
                } else if (s.length == 3) {
                    const [id, attr, val] = s;
                    set_results.push(Nodes.get(id).set(attr, val));
                }
            }
            set_results = await Promise.all(set_results);
            // TODO do something with result?
        }

        //
        // 4) OUTPUT
        //

        if (results.errors && results.errors.length > 0) {
            results.status = "error";
        }
        else {
            results.status = "success";
        }

        return JSON.stringify(results);
    }

    
    // parse one command
    static parse (cmd = "", opts = {}) {

        let args = cmd.split(/\s+/).filter(a => a);
        let arg = next(args);
        if (!arg)
            return { errors: ["Empty command"] };

        // STATUS
        if (arg.match(commands.STATUS)) {
            return Commands.parse_status(arg, args, opts);

        // DO
        } else if (arg.match(commands.DO)) {
            return Commands.parse_do(arg, args, opts);

        // GET
        } else if (arg.match(commands.GET)) {
            return Commands.parse_get(arg, args, opts);
            
        // SET
        } else if (arg.match(commands.SET)) {
            return Commands.parse_set(arg, args, opts);
        }
            
        return { errors : ["Nothing to do"] };
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

        
        let results = {}
        if (getter.length > 0) results.getter = getter;
        if (errors.length > 0) results.errors = errors;

        return results;
    }

    static parse_do (arg, args, opts = {})  {
        let todo = {};

        arg = next(args);
        while (arg) {
            const action = Config.actions().find(a => a.id === arg);
            if (!action) {
                if (!(errors in todo)) errors.todo = {};
                todo.errors.push(`Action "${arg}" not found.`);
                arg = next(args);
                continue;
            }

            const cmds = action.do;
            if (cmds.constructor == [].constructor) {
                for (const cmd of cmds) {
                    todo = merge(todo, Commands.parse(cmd, opts));
                }
            } else {
                todo = merge(todo, Commands.parse(cmds, opts));
            }
            arg = next(args);
        }

        return todo;
    }


    static parse_get (arg, args, opts = {}) {
        let getter = [];
        let errors = [];
        let calc;
        arg = next(args)

        // optional calc function comes first
        if (arg && funcs.includes(arg)) {
            calc = arg;
            arg = next(args);
        }

        // read args until its not a node or group
        let nodes = [];
        let nodesForArg;
        while ( (nodesForArg = Nodes.getNodes(arg, opts)).length > 0) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
            arg = next(args);
        } 

        // no nodes? use all nodes
        if (nodes.length == 0) {
            nodes = Nodes.all();
        }

        // No attribute arg? get all getters of all nodes
        if (!arg) {
            for (const node of nodes) {
                for (const g of node.getter()) {
                    getter.push([node.id, g]);
                }
            }
        } else {
            while (arg)
            {
                for (const node of nodes) {
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

        let results = {}
        if (getter.length > 0) results.getter = getter;
        if (errors.length > 0) results.errors = errors;
        if (calc) results.calc = calc;

        return results;
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
            return {errors : ["No nodes found."]};
        }
        
        // ON / OFF / FLIP
        if (arg) {
            let matched = false;
            for (const token of [ [tokens.ON, "on"], [tokens.OFF, "off"], [tokens.FLIP, "flip"]]) {
                if (arg.match(token[0])) {
                    for (const node of nodes) {
                        const device = Devices.get(node.device);
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
                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set rgb only if device supports it
                    if (device.hasSet("color")) {
                        setter.push([node.id, "color", color]);
                        // also turn on if cmd has no more args
                        if (!arg)
                            setter.push([node.id, "on"])
                    } else if (nodes.length == 1) { 
                        errors.push(`Device ${id} type ${device.type} of node ${node.id} does not support color.`);
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

                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set brightness if device supports it
                    if (device.hasSet("brightness")) {
                        setter.push([node.id, "brightness", percent]);

                        // additionally set on/off
                        if (percent == 100 && device.hasSet("on"))  setter.push([node.id, "on"]);
                        if (percent == 0   && device.hasSet("off")) setter.push([node.id, "off"]);

                    // no brightness, but has "on": use threshold
                    } else if (node.thresh && percent >= node.thresh && device.hasSet("on") && node.class !== "power") {
                        setter.push([node.id, "on"]);

                    // no brightness, but has "off": use threshold
                    } else if (node.thresh && percent < node.thresh && device.hasSet("off") && node.class !== "power") {
                        setter.push([node.id, "off"]);

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${id} of node ${node.id} does not support brightness control.`);
                    }
                };
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);

        let results = {}
        if (setter.length > 0) results.setter = setter;
        if (errors.length > 0) results.errors = errors;

        return results;
    }
}

module.exports = Commands;