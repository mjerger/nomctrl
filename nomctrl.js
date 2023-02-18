const Config  = require('./config.js');
const Devices = require('./devices.js');
const devices = new Devices();

const express = require("express");
const app = express();

// ROUTES

app.listen(Config.app().port, function () {
    console.log(`nomctrl listening on port ${Config.app().port}!`);
});

app.get("/", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/status", async (req, res) => {
    res.send(await execute("status"));
});

app.get("/status/:args", async (req, res) => {
    res.send(await execute(`status ${req.params.args}`));
});

app.post("/cmd", async (req, res) => {
    res.send(await execute(req.body));
});

app.get("/cmd/:cmd", async (req, res) => {
    res.send(await execute(req.params.cmd));
});

app.post("/do", async (req, res) => {
    res.send(await execute(`do ${req.body}`));
 });

app.get("/do/:action", async (req, res) => {
    res.send(await execute(`do ${req.params.action}`));
 });

// COMMANDS

const commands = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // execute on of our configured actions
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
}

// does command a override command b?
function overrides(a, b) {
    // same command
    if (a === b) return true;

    // off/on/flip has prio
    if (a in ["on", "off", "flip"] && b in ["on", "off", "flip"]) {
        return true;
    }

    return false;
}

async function execute(cmds) {

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
        let [todo, e] = parse_cmd(cmd);
        to_execute = to_execute.concat(todo);
        errors = errors.concat(e);
    }

    // conflict filter:: last command in list overrides previous commands
    if (to_execute.length > 1) {
        for (let i = 0; i < to_execute.length-1; i++) {
            for (let j = i+1; j < to_execute.length; j++) {
                // same device
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
    for await (let todo of to_execute) {
        if (todo.length == 2)
            devices.list[todo[0]][todo[1]]();
        else if (todo.length == 3)
            devices.list[todo[0]][todo[1]](todo[2]);
    }

    if (errors.length > 0)
        return jsonError(errors);

    return jsonInfo("success");
}

// parse one command
function parse_cmd (cmd = "") {

    function next(list = []) {
        if (!list)
            return null;
        let item = list[0];
        list.shift()
        return item;
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

    let args = cmd.split(/\s+/).filter(a => a);
    let arg = next(args);
    if (!arg)
        return jsonError("empty command");

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
        let nodes = Config.findNodes(arg);
        if (nodes.length > 0)
            todo = nodes.map(n => [n.device, "status"]);

        // nothing found
        if (todo.length == 0) {
            errors.push(`"${arg}" is neither a known device nor a known node`);
        }

        return [todo, errors];

    // DO
    } else if (arg.match(commands.DO)) {
        arg = next(args)
        while (arg) {
            let action = Config.actions().find(a => a.id === arg);
            if (!action)
                errors.push(`Action "${arg}" not found.`);

            let cmds = action.do;
            if (cmds.constructor == [].constructor) {
                for (let cmd of cmds) {
                    let [t,e] = parse_cmd(cmd);
                    todo = todo.concat(t);
                    errors = errors.concat(e);
                }
            } else {
                let [t,e]= parse_cmd(cmd);
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
        while (nodesForArg = Config.findNodes(arg = next(args))) {
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
                    todo.push([node.device, arg])
                } else if (nodes.length == 1) {
                    errors.push(`Device ${device.id} of type ${device.type} has no setter ${arg}.`);
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
                        todo.push([id, "rgb", color]);
                        // also turn on if cmd has no more args
                        if (!arg)
                            todo.push([id, "on"])
                    } else if (nodes.length == 1) { 
                        errors.push(`Device ${id} of type ${device.type} does not support RGB.`);
                    }
                }
            }
        }
        
        // BRIGHTNESS percentage and on/off commands
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
                        todo.push([id, "brightness", percent]);

                        // additionally set on/off
                        if (percent == 100 && device.has("on"))  todo.push([id, "on"]);
                        if (percent == 0   && device.has("off")) todo.push([id, "off"]);

                    // no brightness, but has "on": use threshold
                    } else if (percent >= Config.ctrl().brightness_threshold && device.has("on")) {
                        todo.push([id, "on"]);

                    // no brightness, but has "off": use threshold
                    } else if (percent < Config.ctrl().brightness_threshold && device.has("off")) {
                        todo.push([id, "off"]);

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${id} does not support brightness control.`);
                    }
                };
            }
        }

    }
        
    if (arg)
        errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);

    return [todo, errors];
}


// HELPERS

function jsonError(messages) {
    return JSON.stringify({"error" : messages});
}

function jsonWarning(messages) {
    return JSON.stringify({"warning" : messages});
}

function jsonInfo(messages) {
    return JSON.stringify({"info" : messages});
}