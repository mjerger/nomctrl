const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Devices = require('./devices.js');
const devices = new Devices();

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

        // make into list
        if (typeof cmds === "string") {
            if (cmds.indexOf(";") > -1)
                cmds = cmds.split(/;/);
            else
                cmds = [cmds];
        }

        // parse all cmds into todos
        let to_execute = [];
        let errors = [];
        for (let cmd of cmds) {
            let [todo, e] = Commands.parse(cmd, opts);
            to_execute = to_execute.concat(todo);
            errors = errors.concat(e);
        }

        // conflict filter:: last command in list overrides previous commands
        if (to_execute.length > 1) {
            for (let i = 0; i < to_execute.length-1; i++) {
                for (let j = i+1; j < to_execute.length; j++) {
                    // same device
                    console.log(to_execute[i][0], to_execute[j][0]);
                    console.log(to_execute[i][1], to_execute[j][1]);
                    if (to_execute[i][0] === to_execute[j][0]) {
                        // next command in list overrides previous one
                        if (overrides(to_execute[j][1], to_execute[i][1])) {
                            to_execute.splice(i, 1);
                            break;
                        }
                    }
                }
            }
        }
        
        // execute everything
        let results = [];
        for await (let todo of to_execute) {
            if (todo.length == 2) {
                let [id, cmd] = todo;
                results.push(devices.do(id, cmd));
            } else if (todo.length == 3) {
                let [id, cmd, val] = todo;
                results.push(devices.do(id, cmd, val));
            }
        }

        if (errors.length > 0)
            return Utils.jsonError(errors);

        return Utils.jsonInfo("success");
    }


    // parse one command
    static parse (cmd = "", opts = {}) {

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

        let args = cmd.split(/\s+/).filter(a => a);
        let arg = next(args);
        if (!arg)
            return Utils.jsonError("empty command");

        let todo = [];
        let errors = [];
        
        // STATUS
        if (arg.match(commands.STATUS)) {
            arg = next(args);

            // status of all devices
            if (!arg) {
                for (let device of Config.devices()) {
                    todo.push([device.id, "status"]);
                }
            }

            // status of a single device
            if (arg in devices.list)
                todo.push([arg, "status"]);
            
            // status of nodes
            let nodes = Config.findNodes(arg, opts);
            if (nodes.length > 0)
                todo = nodes.map(n => [n.device, "status"]);

            // nothing found
            if (todo.length == 0) {
                errors.push(`"${arg}" is neither a known device nor a known node`);
            }

            return [todo, errors];

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
                        let [t,e] = Commands.parse(cmd, opts);
                        todo = todo.concat(t);
                        errors = errors.concat(e);
                    }
                } else {
                    let [t,e]= Commands.parse(cmd, opts);
                    todo = todo.concat(t);
                    errors = errors.concat(e);
                }
                arg = next(args);
            }
            
            return [todo, errors];

        // GET
        } else if (arg.match(commands.GET)) {
            // TODO get commands
            
        // SET
        } else if (arg.match(commands.SET)) {

            // read args until its not a node or group
            let nodes = [];
            let nodesForArg;
            while (nodesForArg = Config.findNodes(arg = next(args), opts)) {
                if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                    break;
                nodes = nodes.concat(nodesForArg.filter(n => n !== null))
            } 

            if (nodes.length == 0) {
                errors.push("No nodes found.");
                return [todo, errors];
            }
            
            // ON / OFF / FLIP
            if (arg && (arg.match(tokens.ON) || arg.match(tokens.OFF) || arg.match(tokens.FLIP) )) {
                for (let node of nodes) {
                    let device = devices.list[node.device];
                    if (device.has(arg)) {
                        todo.push([node.id, arg])
                    } else if (nodes.length == 1) {
                        errors.push(`Device ${device.id} type ${device.type} of node ${node.id} has no setter ${arg}.`);
                    }
                };
                arg = next(args)
            }
            
            // COLOR arg is optional
            let color;
            if (arg) {
                color = Config.getRGB(arg);
                if (color) {
                    arg = next(args)
                    for (let node of nodes) {
                        let id = node.device;
                        let device = devices.list[id];

                        // set rgb only if device supports it
                        if (device.has("rgb")) {
                            todo.push([node.id, "rgb", color]);
                            // also turn on if cmd has no more args
                            if (!arg)
                                todo.push([node.id, "on"])
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
                        let device = devices.list[id];

                        // set brightness if device supports it
                        if (device.has("brightness")) {
                            todo.push([node.id, "brightness", percent]);

                            // additionally set on/off
                            if (percent == 100 && device.has("on"))  todo.push([node.id, "on"]);
                            if (percent == 0   && device.has("off")) todo.push([node.id, "off"]);

                        // no brightness, but has "on": use threshold
                        } else if (node.thresh && percent >= node.thresh && device.has("on") && node.class !== "power") {
                            todo.push([node.id, "on"]);

                        // no brightness, but has "off": use threshold
                        } else if (node.thresh && percent < node.thresh && device.has("off") && node.class !== "power") {
                            todo.push([node.id, "off"]);

                        } else if (nodes.length == 1) {
                            errors.push(`Device ${id} of node ${node.id} does not support brightness control.`);
                        }
                    };
                }
            }
        }
            
        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);

        return [todo, errors];
    }



}

module.exports = Commands;