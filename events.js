const nc = require('./nomctrl.js');

class Event
{
    constructor(event, value, config) { 
        this.event = event;
        this.value = value;
        this.id        = config.id;
        this.condition = config.cond    ? [].concat(config.cond)    : [];
        this.command   = config.do      ? [].concat(config.do)      : [];
        this.set       = config.set     ? [].concat(config.set)     : [];
        this.forward   = config.forward ? [].concat(config.forward) : [];
    }

    is_triggered(event, value) {

        // event name must match
        if (this.event !== event)
            return false;

        // value must match if set
        if (value !== undefined && this.value !== undefined && value !== this.value)
            return false;

        // condition, if set
        if (this.condition) {
            // TODO more variables for condition evaluation / move somewhere
            const val = value;
            return eval(this.condition);
        }

        return true;
    }

    get_commands() {
        let cmds = [];

        // command
        for (let cmd of this.command) {
            cmds.push(cmd);
        }

        // set shorthand
        for (let id_val of this.set) {
            cmds.push(`set ${id_val}`);
        }

        return cmds;
    }
}

const events = new Array();
let execute = undefined;

function init (cfg_actions, exe) {
    execute = exe;

    console.log ('Loading events...');

    // actions
    for (const cfg of cfg_actions) {
        let event;
        if (nc.utils.parse_time(cfg.event)) {
            // shorthand for time events
            event = new Event('time', cfg.event, cfg);
        } else {
            event = new Event(cfg.event, cfg.value, cfg);
        }
        
        events.push(event);
    }
}

function all() {
    return events;
}

function add_event(event, value, cfg) {
    events.push(new Event(event, value, cfg));
}

// triggers all events that apply
async function trigger(event, value) {
    for (const e of events) {

        // check conditions
        if (!e.is_triggered(event, value))
            continue;

        console.log(`Event: ${event} ${value == undefined ? '' : value}`);

        let cmds = e.get_commands();

        // forward the value to a setter
        for (let id of e.forward) {
            cmds.push(`set ${id} ${value}`);
        }
        
        execute(cmds);
    }
}

async function message(device, attr, value) {
    return Promise.all([trigger(device.id + '.' + attr, value),
                        trigger(device.id + '.' + attr + '.' + value)]);
}

async function start() {
    console.log ('Starting events...');
    setTimeout(send_time_events, 100);
}

last_tick_minute = 0;
async function send_time_events() {
    const now = new Date();

    // execute every minute
    const minute = now.getMinutes();
    if (last_tick_minute != minute) {
        last_tick_minute = minute;
        const time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2); // ewww... but too lazy
        trigger('time', time);
    }

    // tick again
    setTimeout(send_time_events, 1000);
}

module.exports = { init, start, all, trigger, message };