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

app.post("/do/:action", async (req, res) => {
    res.send(await execute(`do ${req.params.action}`));
 });


// COMMANDS

const commands = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // execute on of our configured actions
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
}

// executes one command
async function execute (cmd = "") {

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
        PERCENT : /^(\d{2}|100|0+)%?$/,
        VALUE   : /^\d+/,
        RGB     : /^\(\d+,\d+,\d+\)$/,
        HEX     : /^\#?[0-9a-fA-F]{6}$/
    }

    let done = false;

    let args = cmd.split(/\s+/).filter(a => a);
    let arg = next(args);
    if (!arg)
        return "Error: empty command";
    
    // STATUS
    if (arg.match(commands.STATUS)) {
        arg = next(args);

        // status of all devices
        if (!arg) {
            let result = {};
            for await (let device of Config.devices()) {
                result[device.name] = await devices.list[device.name].status();
            }
            return result;
        }

        // status of a single device
        if (arg in devices.list)
            return devices.list[arg].status();
        
        // status of nodes
        let nodes = Config.findNodes(arg);
        if (nodes.length > 0)
            return nodes.map(n => devices.list[n.device].status());

        return jsonError(`Error: ${arg} is neither a known device nor a known node`);

    // DO
    } else if (arg.match(commands.DO)) {
        while (action = Config.getAction(arg = next(args))) {
            action.trigger();
            done = true;
        } 

    // GET
    } else if (arg.match(commands.GET)) {
        // TODO get commands
        
    // SET
    } else if (arg.match(commands.SET)) {

        let errors = [];

        // read args until its not a node or group
        let nodes = [];
        let nodesForArg;
        while (nodesForArg = Config.findNodes(arg = next(args))) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
        } 

        if (nodes.length == 0)
            return "Error: No nodes found."
        
        // ON / OFF / FLIP
        if (arg && (arg.match(tokens.ON) || arg.match(tokens.OFF) || arg.match(tokens.FLIP) )) {
            for await (let node of nodes) {
                let device = devices.list[node.device];
                if (device.has(arg)) {
                    await device.set(arg);
                    done = true;
                } else if (nodes.length == 1) {
                    errors.push(`Device ${device.name} of type ${device.type} has no setter ${arg}.`);
                }
            };
            arg = next(args)
        }
        
        // COLOR is optional
        if (arg && (arg.match(tokens.RGB) || arg.match(tokens.HEX))) {
            var color = Config.getRGB(arg);
            arg = next(args)
            for await (let node of nodes) {
                let name = ndoe.device;
                let device = devices.list[name];

                // set rgb only if device supports it
                if (device.has("rgb")) {
                    await device.rgb(color);
                    done = true;
                } else if (nodes.length == 1) { 
                    errors.push(`Device ${name} of type ${device.type} does not support RGB.`);
                }
            };
        }
            
        // allow brightness percentage and on/off commands
        if (arg) {
            var percent = color ? color.map(v => v/2.5).reduce((a,b) => a+b, 0) / 3 : null;
            if (arg.match(tokens.PERCENT)) {
                percent = parseInt(arg);
                if (percent < 0 || percent > 100)
                    errors.push(`Brightness must be a value between 0 and 100`)
                arg = next(args);
            } else if (arg.match(tokens.ON)) {
                percent = 100;
                arg = next(args);
            } else if (arg.match(tokens.OFF)) {
                percent = 0;
                arg = next(args);
            }

            // set brightness on all nodes
            if (percent !== null) {
                percent = Math.max(Math.min(Math.round(percent), 100), 0);

                for await (let node of nodes) {
                    let name = n.device;
                    let device = devices.list[name];

                    // set brightness if device supports it
                    if (device.has("brightness")) {
                        await device.brightness(percent);
                        done = true;

                        // additionally set on/off
                        if (percent == 100 && device.has("on"))  device.on();
                        if (percent == 0   && device.has("off")) device.off();

                    // no brightness, but has "on": use threshold
                    } else if (percent >= Config.ctrl().brightness_threshold && device.has("on")) {
                        await device.on();
                        done = true;

                    // no brightness, but has "off": use threshold
                    } else if (percent < Config.ctrl().brightness_threshold && device.has("off")) {
                        await device.off();
                        done = true;

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${name} does not support brightness control.`);
                    }
                };
            }
        }

        if (errors.length > 0)
            return error(errors);
    }

    if (arg)
        return jsonWarning(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`);

    if (!done)
        return jsonWarning("Nothing to do");

    return jsonInfo("success");
}


// HELPERS

function jsonError(messages) {
    return JSON.stringify({"error" : message});
}

function jsonWarning(messages) {
    return JSON.stringify({"warning" : message});
}

function jsonInfo(message) {
    return JSON.stringify({"info" : message});
}