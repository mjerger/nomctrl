const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Devices = require('./devices.js');
const Nodes   = require('./nodes.js');
const Timers  = require('./timers.js');


const CMDS = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // execute on of our configured actions
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
    FADE   : 'fade',        // fade something
}

const TOKENS = {
    ON       : /^(on|true|yes|bright|full|max.*|ein|an)$/,
    OFF      : /^(off|false|no|none|aus|min.*)$/,
    FLIP     : /^(flip|toggle)$/,
    PERCENT  : /^(\d|\d{2}|100|0+)%?$/,
    INT      : /^\d+/,
    RGB      : /^\(\d+,\d+,\d+\)$/,
    HEX      : /^\#?[0-9a-fA-F]{6}$/,
    FOR      : /^for$/,
    DURATION : /^\d+[m|s|h|d]$/,
    FOR_OVER : /^(for|over)$/,
    TO       : /^to$/
}

const FUNCS = {
    SUM : /^sum$/,
    AVG : /^(avg|average)$/,
    MIN : /^(min|minimum)$/,
    MAX : /^(max|maximum)$/
}

function next(list = []) {
    if (!list)
        return null;
    let item = list[0];
    list.shift()
    return item;
}

// does command a override command b?
function overrides(a, b) {
    // same command
    if (a === b) return true;

    // off/on/flip has prio
    if (['on', 'off', 'flip'].includes(a) && 
        ['on', 'off', 'flip'].includes(b))
    {
        return true;
    }

    return false;
}

class Commands {

    // helpers
    static parse_nodes(arg, args, opts = {}) {
        let nodes = [];

        let nodesForArg;
        while (arg && (nodesForArg = Nodes.getNodes(arg, opts)).length > 0) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
            arg = next(args)
        } 

        if (nodes.length == 0) {
            return {errors : ['No nodes found.']};
        }

        args.unshift(arg);
        return nodes;
    }
    
    static parse_percent(arg) {
        if (arg !== undefined) {
            if (arg.match(TOKENS.PERCENT)) {
                return parseInt(arg);
            } else if (arg.match(TOKENS.ON)) {
                return 100;
            } else if (arg.match(TOKENS.OFF)) {
                return 0;
            }
        }
        return null;
    }

    static parse_duration(arg) {
        if (arg !== undefined) {
            if (arg.match(TOKENS.DURATION)) {
                const val = parseInt(arg);
                if (val < 0) return 0;
                switch (arg.slice(-1)) {
                    case 's' : return val;
                    case 'm' : return val * 60;
                    case 'h' : return val * 3600;
                    case 'd' : return val * 3600*24;
                }
            }
        }
        return 0;
    }

    static parse_color(arg) {

        // alias resolver
        function resolve(color) {
            if (color.color) 
                return resolve(Config.colors().find(c => c.id === color.color));
            else
                return color;
        }
        
        // try to find it in config
        let color = Config.colors().find(c => c.id === arg);
        if (color) {
            color = resolve(color);
            if (color.rgb) 
                return color.rgb
            else if (color.hex) 
                return Utils.hexToRGB(color.hex);
        }

        // try raw hex value
        if (color = Utils.hexToRGB(arg))
            return color;

        // not found
        return null;
    }
    
    // parse one command
    static parse (cmd = '', opts = {}) {

        let args = cmd.split(/\s+/).filter(a => a);
        let arg = next(args);
        let results;
        if (!arg)
            return { errors: ['Empty command'] };

        // STATUS
        if (arg.match(CMDS.STATUS)) {
            arg = next(args);
            results = Commands.parse_status(arg, args, opts);
e
        // DO
        } else if (arg.match(CMDS.DO)) {
            arg = next(args);
            results = Commands.parse_do(arg, args, opts);

        // GET
        } else if (arg.match(CMDS.GET)) {
            arg = next(args);
            results = Commands.parse_get(arg, args, opts);
            
        // SET
        } else if (arg.match(CMDS.SET)) {
            arg = next(args);
            results = Commands.parse_set(arg, args, opts);

        // FADE
        } else if (arg.match(CMDS.FADE)) {
            arg = next(args);
            results = Commands.parse_fade(arg, args, opts);
        }

        if (arg)
            results = Utils.merge(results, { errors : `Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}` });

        if (results.faders && results.faders.length > 0 || 
            results.setter && results.setter.length > 0 || 
            results.getter && results.getter.length > 0) 
        {
            return results;
        }
     
        return { errors : ['Nothing to do'] };
    }

    static parse_status(arg, args, opts = {}) {
        let getter = [];
        let errors = [];

        // status of all devices
        arg = next(args);
        if (!arg) {
            const nodes = Nodes.all();
            for (const node of Nodes.all()) {
                if (node.hasGet('status'))
                    getter.push([node.id, 'status']);
            }
        } else {

            // status of nodes
            const nodes = Nodes.getNodes(arg, opts).filter(node => node.hasGet('status'));
            if (nodes.length > 0)
                getter = getter.concat(nodes.map(node => [node.id, 'status']));
            else
                errors.push(`'${arg}' is not a node or status command`); 

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
                todo.errors.push(`Action '${arg}' not found.`);
                arg = next(args);
                continue;
            }

            const cmds = action.do;
            if (cmds.constructor == [].constructor) {
                for (const cmd of cmds) {
                    todo = Utils.merge(todo, Commands.parse(cmd, opts));
                }
            } else {
                todo = Utils.merge(todo, Commands.parse(cmds, opts));
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
        if (arg) {
            for (const func of Object.entries(FUNCS)) {
                if (arg.match(func[1])) {
                    calc = func[0].toLowerCase();
                    arg = next(args);
                    break;
                }
            }
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
                        errors.push(`Node '${node.id}' does not have a getter '${arg}'`);
                }
                arg = next(args);
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}`);

        let results = {}
        if (getter.length > 0) results.getter = getter;
        if (errors.length > 0) results.errors = errors;
        if (calc) results.calc = calc;

        return results;
    }


    static parse_set (arg, args, opts = {}) {
        let setter = [];
        let errors = [];

        // read nodesZ
        let nodes = Commands.parse_nodes(arg, args, opts);
        arg = next(args);
        if (nodes.length == 0) {
            return {errors : ['No nodes found.']};
        }

        // ON / OFF / FLIP
        if (arg) {
            let matched = false;
            for (const token of [ [TOKENS.ON, 'on'], [TOKENS.OFF, 'off'], [TOKENS.FLIP, 'flip']]) {
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
            color = Commands.parse_color(arg);
            if (color) {
                arg = next(args)
                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set rgb only if device supports it
                    if (device.hasSet('color')) {
                        setter.push([node.id, 'color', color]);
                        // also turn on if cmd has no more args
                        if (!arg)
                            setter.push([node.id, 'on'])
                    } else if (nodes.length == 1) { 
                        errors.push(`Device ${id} type ${device.type} of node ${node.id} does not support color.`);
                    }
                }
            }
        }
        
        // BRIGHTNESS percentage and on/off commands for lights
        if (arg)  {
            var percent = Commands.parse_percent(arg);

            // set brightness on all nodes
            if (percent !== null) {

                // Clamp
                percent = Math.max(Math.min(Math.round(percent), 100), 0);

                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set brightness if device supports it
                    if (device.hasSet('brightness')) {
                        setter.push([node.id, 'brightness', percent]);

                        // additionally set on/off
                        if (percent == 100 && device.hasSet('on'))  setter.push([node.id, 'on']);
                        if (percent == 0   && device.hasSet('off')) setter.push([node.id, 'off']);

                    // no brightness, but has 'on': use threshold
                    } else if (node.thresh && percent >= node.thresh && device.hasSet('on') && node.class !== 'power') {
                        setter.push([node.id, 'on']);

                    // no brightness, but has 'off': use threshold
                    } else if (node.thresh && percent < node.thresh && device.hasSet('off') && node.class !== 'power') {
                        setter.push([node.id, 'off']);

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${id} of node ${node.id} does not support brightness control.`);
                    }
                };
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}`);

        let results = {}
        if (setter.length > 0) results.setter = setter;
        if (errors.length > 0) results.errors = errors;

        return results;
    }


    static parse_fade (arg, args, opts = {}) {

        let faders = [];
        let errors = [];

        // read nodes
        let nodes = Commands.parse_nodes(arg, args, opts);
        if (nodes.length == 0) {
            return {errors : ['No nodes found.']};
        }

        // first color and or brightness
        arg = next(args);
        const color1 = Commands.parse_color(arg, args);
        const brightness1 = Commands.parse_percent(arg, args);

        if (color1 == null && brightness1 == null)
        {
            return { errors : [`Invalid color or brightness ${arg}`] };
        }
        
        // to
        arg = next(args);
        if (arg && arg.match(TOKENS.TO)) 
            arg = next(args);

        let color2 = null;
        let brightness2 = null;
        if (arg) {
            color2 = Commands.parse_color(arg, args);
            brightness2 = Commands.parse_percent(arg, args);

            if (color2 != null || brightness2 != null)
            {
                arg = next(args);
            }
        }

        // for / over
        if (arg && arg.match(TOKENS.FOR_OVER)) 
            arg = next(args);

        // duration
        const duration = Commands.parse_duration(arg, args);

        if (duration <= 0) {
            errors.push("Missing duration");
        }
        else
        {
            // results
            if (color1 !== null && color2 !== null) {
                for (const node of nodes) {
                    faders.push([node.id, 'color', color1, color2, duration]);
                }
            } 
            
            if (brightness1 !== null && brightness2 !== null) {
                for (const node of nodes) {
                    faders.push([node.id, 'brightness', brightness1, brightness2, duration]);
                }
            }
        }

        let results = {}
        if (faders.length > 0) results.faders = faders;
        if (errors.length > 0) results.errors = errors;

        return results;
    }
}

module.exports = Commands;