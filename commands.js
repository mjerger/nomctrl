const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Devices = require('./devices.js');
const Nodes   = require('./nodes.js');
const Timers  = require('./timers.js');

const CMDS = {
    STATUS : 'status',      // return full status of a node
    DO     : 'do',          // trigger an action
    GET    : 'get',         // get something from nodes
    SET    : 'set',         // set something on nodes
    FADE   : 'fade',        // fade something
}

const TOKENS = {
    ON        : /^(on|true|yes|bright|full|maxi.*|ein|an)$/,
    OFF       : /^(off|false|no|none|aus|mini.*)$/,
    FLIP      : /^(flip|toggle)$/,
    STATE     : /^(state)$/,
    COLOR     : /^color$/,
    BRIGHTNESS: /^brightness$/,

    PERCENT   : /^(\d|\d{2}|100|0+)%?$/,
    INT       : /^\d+/,
    RGB       : /^\(\d+,\d+,\d+\)$/,
    HEX       : /^\#?[0-9a-fA-F]{6}$/,
    DURATION  : /^\d+[m|s|h|d]$/,
    TIME      : /^(((?:[01]?\d|2[0-3])(?::[0-5]\d){1,2})|sunrise|sunriseEnd|sunsetStart|sunset)$/,

    TO        : /^to$/,
    AT        : /^at$/,
    IN        : /^in$/,
    FOR       : /^for$/,
    UNTIL     : /^until$/,
    FOR_OVER  : /^(for|over)$/,
}

const FUNCS = {
    SUM : /^sum$/,
    AVG : /^(avg|average)$/,
    MIN : /^(min|minimum)$/,
    MAX : /^(max|maximum)$/,
}

function next(list = []) {
    if (!list)
        return null;
    let item = list[0];
    list.shift()
    return item;
}

class Commands {

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
            results = this.parse_status(arg, args, opts);
e
        // DO
        } else if (arg.match(CMDS.DO)) {
            arg = next(args);
            results = this.parse_do(arg, args, opts);

        // GET
        } else if (arg.match(CMDS.GET)) {
            arg = next(args);
            opts['include_timed'] = true;
            results = this.parse_get(arg, args, opts);
            
        // SET
        } else if (arg.match(CMDS.SET)) {
            arg = next(args);
            results = this.parse_set(arg, args, opts);

        // FADE
        } else if (arg.match(CMDS.FADE)) {
            arg = next(args);
            results = this.parse_fade(arg, args, opts);
        }

        if (args.length > 0)
            results = Utils.merge(results, { errors : `Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}` });

        return results;
    }


    static parse_status(arg, args, opts = {}) {
        let getter = [];
        let errors = [];

        // status of all devices
        if (!arg) {
            const nodes = Nodes.all();
            for (const node of Nodes.all()) {
                if (node.hasGet('status'))
                    getter.push([node.id, 'status']);
            }
        } else {
            // status of nodes
            let nodes = this.parse_node(arg, args, opts);
            nodes = nodes.filter(n => n.hasSet('status'));
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
                    todo = Utils.merge(todo, this.parse(cmd, opts));
                }
            } else {
                todo = Utils.merge(todo, this.parse(cmds, opts));
            }
            arg = next(args);
        }

        return todo;
    }


    static parse_get (arg, args, opts = {}) {
        let getter = [];
        let errors = [];
        let calc;

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
        let nodes = this.parse_nodes(arg, args, opts);
        arg = next(args);
        if (!nodes || nodes.length == 0) {
            return {errors : ['No nodes found.']};
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
        let set_at = [];
        let errors = [];

        // read nodes
        let nodes = this.parse_nodes(arg, args, opts);
        arg = next(args);
        if (!nodes || nodes.length == 0) {
            return {errors : ['No nodes found.']};
        }

        // STATE arg is optional
        let state;
        if (arg && arg.match(TOKENS.STATE))
            arg = next(args);

        // ON / OFF / FLIP
        if (arg) {
            let attr, val;
            if (arg.match(TOKENS.ON)) {
                attr = 'state';
                val = true;
            } else if (arg.match(TOKENS.OFF)) {
                attr = 'state';
                val = false;
            } else if (arg.match(TOKENS.FLIP)) {
                attr = 'flip';
            }

            if (attr) {
                for (const node of nodes) {
                    const device = Devices.get(node.device);
                    if (node.hasSet(attr)) {
                        setter.push([node.id, attr, val]);
                    }
                }
                arg = next(args);
            }
        }
        
        // COLOR arg is optional
        let color;
        if (arg && arg.match(TOKENS.COLOR))
            arg = next(args);
        if (arg) {
            color = this.parse_color(arg);
            if (color) {
                arg = next(args)
                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set rgb only if device supports it
                    if (device.hasSet('color')) {
                        setter.push([node.id, 'color', color]);
                    } else if (nodes.length == 1) { 
                        errors.push(`Device ${id} type ${device.type} of node ${node.id} does not support color.`);
                    }
                }
            }
        }
        
        // BRIGHTNESS percentage and on/off commands for lights
        if (arg && arg.match(TOKENS.BRIGHTNESS))
            arg = next(args);
        if (arg)  {
            var percent = this.parse_percent(arg);

            // set brightness on all nodes
            if (percent !== null) {
                arg = next(args);

                // Clamp
                percent = Math.max(Math.min(Math.round(percent), 100), 0);

                for (const node of nodes) {
                    const id = node.device;
                    const device = Devices.get(id);

                    // set brightness if device supports it
                    if (device.hasSet('brightness')) {
                        setter.push([node.id, 'brightness', percent]);

                    // no brightness, but has 'on': use threshold
                    } else if (node.thresh && percent >= node.thresh && device.hasSet('state') && node.class !== 'power') {
                        setter.push([node.id, 'state', true]);

                    // no brightness, but has 'off': use threshold
                    } else if (node.thresh && percent < node.thresh && device.hasSet('state') && node.class !== 'power') {
                        setter.push([node.id, 'state', false]);

                    } else if (nodes.length == 1) {
                        errors.push(`Device ${id} of node ${node.id} does not support brightness control.`);
                        console.log(node.thresh, percent >= node.thresh, device.hasSet('state'), node.class);
                    }
                };
            }

            // timed setters
            if (arg) {

                // execute setter at specified time
                if (arg.match(TOKENS.AT)) {
                    arg = next(args);
                    if (arg && arg.match(TOKENS.TIME)) {
                        const time = Utils.parseTime(arg);
                        arg = next(args);
                        
                        // move setters to set_at, with time
                        for (const set of setter) {
                            set.push(time);
                            set_at.push(set);
                        }
                        setter = [];

                    } else {
                        return { errors : ['Missing time argument.'] };
                    }

                // execute setter in x seconds
                } else if (arg.match(TOKENS.IN)) {
                    arg = next(args);
                    if (arg && arg.match(TOKENS.DURATION)) {
                        const duration = Utils.parseDuration(arg);
                        const time = Date.now() + duration*1000;
                        arg = next(args);

                        // move setters to set_at, with time
                        for (const [node, attr, val] of setter) {
                            set_at.push([node, attr, val, time]);
                        }
                        setter = [];

                    } else {
                        return { errors : ['Missing duration argument.'] };
                    }
                
                // set now and undo at specified time
                } else if (arg.match(TOKENS.UNTIL)) {
                    arg = next(args);
                    if (arg && arg.match(TOKENS.TIME)) {
                        const time = Utils.parseTime(arg);
                        arg = next(args);

                        // add setters with current value at specified time
                        for (const [node, attr, val] of setter) {
                            const cur_val = Nodes.get(node).get_current(attr);
                            set_at.push([node, attr, cur_val, time]);
                        }

                    } else {
                        return { errors : ['Missing time argument.'] };
                    }
                
                // set now and undo in x seconds
                } else if (arg.match(TOKENS.FOR)) {
                    arg = next(args);
                    if (arg && arg.match(TOKENS.DURATION)) {
                        const duration = Utils.parseDuration(arg);
                        const time = Date.now() + duration*1000;
                        arg = next(args);
                        
                        // add setters with current value at specified time
                        for (const [node, attr, val] of setter) {
                            const cur_val = Nodes.get(node).get_current(attr);
                            set_at.push([node, attr, cur_val, time]);
                        }

                    } else {
                        return { errors : ['Missing duration argument.'] };
                    }
                }
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}`);

        let results = {}
        if (setter.length > 0) results.setter = setter;
        if (set_at.length > 0) results.set_at = set_at;
        if (errors.length > 0) results.errors = errors;

        return results;
    }


    static parse_fade (arg, args, opts = {}) {
        let faders = [];
        let errors = [];

        // read nodes
        let nodes = this.parse_nodes(arg, args, opts);
        arg = next(args);
        if (nodes.length == 0) {
            return {errors : ['No nodes found.']};
        }

        // first color and or brightness
        const color1 = this.parse_color(arg, args);
        const brightness1 = this.parse_percent(arg, args);

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
            color2 = this.parse_color(arg, args);
            brightness2 = this.parse_percent(arg, args);

            if (color2 != null || brightness2 != null)
            {
                arg = next(args);
            }
        }

        // for / over
        if (arg && arg.match(TOKENS.FOR_OVER)) 
            arg = next(args);

        // duration
        const duration = Utils.parseDuration(arg, args);

        if (duration <= 0) {
            errors.push("Missing duration");
        }
        else
        {
            if (color1 !== null && color2 !== null) {
                for (const node of nodes) {
                    if (node.hasSet('color')) {
                        faders.push([node.id, 'color', color1, color2, duration]);
                    }
                }
            } 
            
            if (brightness1 !== null && brightness2 !== null) {
                for (const node of nodes) {
                    if (node.hasSet('brightness')) {
                        faders.push([node.id, 'brightness', brightness1, brightness2, duration]);
                    }
                }
            }
        }

        if (arg)
            errors.push(`Did not parse all arguments. Remaining: ${[arg].concat(args.join(' ')).join(' ')}`);

        let results = {}
        if (faders.length > 0) results.faders = faders;
        if (errors.length > 0) results.errors = errors;

        return results;
    }

    //
    // Helpers
    //

    static parse_nodes(arg, args, opts = {}) {
        let nodes = [];

        let nodesForArg;
        while (arg && (nodesForArg = Nodes.getNodes(arg, opts)).length > 0) {
            if (nodesForArg.includes(false)) // arg not a valid node, we done reading
                break;
            nodes = nodes.concat(nodesForArg.filter(n => n !== null))
            arg = next(args)
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

        // try rgb
        if (color = Utils.parseRGB(arg)) {
            return color;
        }

        // not found
        return null;
    }
    
}

module.exports = Commands;