const Config  = require('./config.js');
const Devices = require('./devices.js');
const devices = new Devices();

const express = require("express");
const app = express();

// ROUTES

app.listen(Config.app().port, function () {
    console.log(`nomctrl listening on port ${Config.app().port}!`);
});

app.get("/", function (req, res) {
    res.send("nomctrl up");
});

app.get("/status", function (req, res) {
    res.send(execute("status"));
});

app.get("/status/:args", function (req, res) {
    res.send(execute(`status ${req.params.args}`));
});

app.post("/cmd", function (req, res) {  
    res.send(execute(req.body));
});

app.get("/cmd/:cmd", function (req, res) {  
    res.send(execute(req.params.cmd));
});

app.post("/do/:action", function (req, res) { 
    res.send(execute(`do ${req.params.action}`));
 });


// COMMANDS

const commands = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // execute on of our configured actions
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
}

// executes one command
function execute (cmd = "") {

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
        if (!arg) 
            return Config.devices().map(device => { return devices.list[device.name].status() });

        // status of a single device
        if (arg in devices.list)
            return devices.list[arg].status();
        
        // status of nodes
        let nodes = Config.findNodes(arg);
        if (nodes.length > 0)
            return nodes.map(n => devices.list[n.device].status());

        return `Error: ${arg} is neither a known device nor a known node`;

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
            nodes.forEach(n => { 
                let device = devices.list[n.device];
                if (device.has(arg)) {
                    device.set(arg);
                    done = true;
                } else if (nodes.length == 1) {
                    errors.push(`Device ${device.name} of type ${device.type} has no setter ${arg}.`);
                }
            });
            arg = next(args)
        }
        
        // COLOR is optional
        if (arg && (arg.match(tokens.RGB) || arg.match(tokens.HEX))) {
            let color = Config.getRGB(arg);
            arg = next(args)
            nodes.forEach(n => {
                let name = n.device;
                let device = devices.list[name];

                // set rgb only if device supports it
                if (device.has("rgb")) {
                    device.rgb(color);
                    done = true;
                } else if (nodes.length == 1) { 
                    errors.push(`Device ${name} of type ${device.type} does not support RGB.`);
                }
            });
        }
            
        // allow brightness percentage and on/off commands
        if (arg) {
            let percent = 100;
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
            nodes.forEach(n => {
                let name = n.device;
                let device = devices.list[name];

                // set brightness only if device supports it; try to use on/off alternatively
                if (device.has("brightness")) {
                    device.brightness(percent);
                    done = true;
                } else if (percent >= Config.ctrl().brightness_threshold && device.has("on")) {
                    device.on();
                    done = true;
                } else if (percent < Config.ctrl().brightness_threshold && device.has("off")) {
                    device.off();
                    done = true;
                } else if (nodes.length == 1) {
                    errors.push(`Device ${name} does not support brightness control.`);
                }

            });
        }

        if (errors.length > 0)
            return `${errors.length} Errors:\n` + errors.join("\n");
    }

    if (arg)
        return `Warning: Did not parse all arguments. Remaining: ${[arg].concat(args.join(" ")).join(" ")}`;

    if (!done)
        return "Warning: Nothing to do";

    return "OK";
}
