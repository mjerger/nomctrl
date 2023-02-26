const Utils   = require('./utils.js');

class Event
{
    constructor(name, value, condition, cmd) { 
        this.name = name;
        this.value = value;
        this.condition = condition;
        this.cmd = cmd;
    }

    is_triggered(name, value) {

        // event name matches
        if (this.name !== name)
            return false;

        // value must match if set
        if (value !== undefined && value !== this.value)
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

        console.log ('Loading Action Events...');
        this.events = [];

        // actions
        for (const cfg of cfg_actions) {
            // shorthand for time events
            if (Utils.parseTime(cfg.event)) {
                var event = new Event('time', cfg.event, cfg.cond, `do ${cfg.id}`);
            } else {
                var event = new Event(cfg.event, cfg.value, cfg.cond, `do ${cfg.id}`);
            }
            
            this.events.push(event);
        }
    }

    static addEvent(event, value, condition, cmd) {
        this.events.push(new Event(event, value, condition, cmd));
    }

    static async trigger(event, value) {
        console.log(`Event: ${event} ${value !== undefined ? value : ''}`);

        for (const e of this.events) {
            if (!e.is_triggered(event, value))
                continue;

            console.log(`Event: ${event} ${value == undefined ? '' : value}`);
            this.execute(e.cmd);
        }
    }

    static async start() {
        console.log ('Starting events subsystem');
        this.send_time_events();
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