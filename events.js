const Utils   = require('./utils.js');

class Event
{
    constructor(event, value, config) { 
        this.event = event;
        this.value = value;
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
}

class Events 
{
    static events = [];
    
    static init (cfg_actions, execute) {
        this.execute = execute;

        console.log ('Loading events...');
        this.events = [];

        // actions
        for (const cfg of cfg_actions) {
            let event;
            if (Utils.parseTime(cfg.event)) {
                // shorthand for time events
                event = new Event('time', cfg.event, cfg);
            } else {
                event = new Event(cfg.event, cfg.value, cfg);
            }
            
            this.events.push(event);
        }
    }

    static add_event(event, value, cfg) {
        this.events.push(new Event(event, value, cfg));
    }

    // triggers all events that apply
    static async trigger(event, value) {
        for (const e of this.events) {

            // check conditions
            if (!e.is_triggered(event, value))
                continue;

            console.log(`Event: ${event} ${value == undefined ? '' : value}`);

            // command
            for (let cmd of e.command) {
                this.execute(cmd);
            }

            // set shorthand
            for (let id_val of e.set) {
                this.execute(`set ${id_val}`);
            }
            
            // forward the value to a setter
            for (let id of e.forward) {
                this.execute(`set ${id} ${value}`);
            }
        }
    }

    static async message(device, attr, value) {
        return Promise.all([this.trigger(device.id + '.' + attr, value),
                            this.trigger(device.id + '.' + attr + '.' + value)]);
    }

    static async start() {
        console.log ('Starting events...');
        setTimeout(this.send_time_events.bind(this), 100);
    }

    static last_tick_minute = 0;
    static async send_time_events() {
        const now = new Date();

        // execute every minute
        const minute = now.getMinutes();
        if (this.last_tick_minute != minute) {
            this.last_tick_minute = minute;
            const time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2); // ewww... but too lazy
            this.trigger('time', time);
        }

        // tick again
        setTimeout(this.send_time_events.bind(this), 1000);
    }
}

module.exports = Events;