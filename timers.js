const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Nodes   = require('./nodes.js');

class Timer 
{
    events = []

    constructor(cfg) { 
        this.id = cfg.id;
        this.node = cfg.node;
        this.strict = cfg.strict;
        this.parseEvents(cfg);
    }

    merge (cfg) {
        if (!this.node || !cfg.node || this.id !== cfg.id || this.node !== cfg.node)
            return this;

        this.parseEvents(cfg)
    }

    parseEvents(cfg) {

        // short syntax
        if (cfg.on)
            this.events.push([cfg.on, `set ${cfg.node} on`]);
        if (cfg.off)
            this.events.push([cfg.off, `set ${cfg.node} off`]);
        if (cfg.flip)
            this.events.push([cfg.flip, `set ${cfg.node} off`]);

        // longer syntax
        if (cfg.at) {
            if (cfg.set)
                this.events.push([cfg.at, `set ${cfg.node} ${cfg.set}` ]);
            if (cfg.do)
                this.events.push([cfg.at, `do ${cfg.do}` ]);
            if (cfg.cmd)
                this.events.push([cfg.at, cfg.cmd ]);
        }
    }
}

class Fader 
{
    ATTR_TYPE = {
        COLOR : 'color',
        NUMBER : 'number'
    }

    constructor (node, attr, from, to, duration) {
        this.node = node;
        this.attr = attr;
        this.from = from;
        this.to = to;
        this.duration = duration;
        this.start_time = Date.now();
        this.last_value = 0;
    }

    get_value(time) {
        if (!this.is_active(time))
            return this.to;

        // progress factor 0.0 - 1.0
        const fac = (time - this.start_time) / (this.duration * 1000);
        
        // interpolate color
        if (this.attr === 'color') {
            let rgb = [];
            for (let i=0; i<3; i++) {
                rgb[i] = Math.floor(Utils.lerp(this.from[i], this.to[i], fac));
            }
            return rgb;

        } else if (this.attr === 'brightness') {
            const val = Math.floor(Utils.lerp(this.from, this.to, fac));
            return val;
        }

        return 0; // idk
    }

    has_new_value(time) {
        const cur = this.get_value(time);
        if (this.attr === 'color') {
            return cur[0] !== this.last_value[0] || 
                   cur[1] !== this.last_value[1] || 
                   cur[2] !== this.last_value[2];
        } else {
            return cur !== this.last_value;
        }
    }

    is_active(time) {
        return (time < this.start_time + this.duration*1000);
    }
}

class Timers
{
    static timers = new Map();
    static faders = [];

    static init(cfg_timers, cfg_actions, execute) {
        this.execute = execute;

        console.log ('Loading timers...');
        Timers.timers.clear();
        let error = false;

        // Timer definitions
        for (const cfg of cfg_timers) {
            const id = cfg.id
            if (Timers.timers.has(id)) {
                // marge timer definitions
                if ('node' in cfg && Timers.timers.get(id).node === cfg.node) {
                    Timers.timers.set(id, merge(cfg));
                } else {
                    console.log(`Config Error: incompatible timer configuration on timer '${id}'`);
                    error = true;
                }
            } else {
                Timers.timers.set(id, new Timer(cfg));
            }
        }

        // Actions with timers
        // TODO

        return error;
    }

    static getTimer(id) {
        return Timers.timers.get(id);
    }

    static addFader(node, attr, from, to, duration) {
        Timers.faders.push(new Fader(node, attr, from, to, duration));
        this.tick_faders();
    }

    static killFaders(node, attr) {
        Timers.faders = Timers.faders.filter(f => f.node === node && f.attr === attr);
    }

    static async start() {
        console.log ('Starting timers');
        Timers.tick_static_timers();
        Timers.tick_faders();
    }

    static async tick_faders() {
        const now = Date.now();

        // remove stopped
        Timers.faders = Timers.faders.filter(f => f.is_active(now));

        if (Timers.faders.length == 0) 
            return;

        // get new values, if any
        let setter = [];
        for (const fader of Timers.faders) {
            if (fader.has_new_value(now)) {
                const new_value = fader.get_value(now);
                setter.push(Nodes.get(fader.node).set(fader.attr, new_value));
                fader.last_value = new_value;
            }
        }

        // doit
        if (setter.length > 0) {
            await Promise.all(setter);
        }

        // tick again
        setTimeout(this.tick_faders.bind(this), 2000);
    }

    static async tick_static_timers(execute) {

        // execute strict timers
        for (const timer of Timers.timers.values()) {
            if (!timer.strict)
                continue;
            
            // we have take into account the events for yesterday, so timers can behave correctly during midnigh
            const times_today = timer.events.map(e => Utils.parseTime(e[0]));
            const times_yesterday = times_today.map(t => t - (3600*24*1000));
            const times = times_yesterday.concat(times_today);
            let cmds = timer.events.map(e => e[1]);
            cmds = cmds.concat(cmds);
            const currentStateCmd = Utils.findClosest(times, cmds, Date.now());

            console.log(`Timer ${timer.id}: '${currentStateCmd}' for node ${timer.node}`);
            await this.execute(currentStateCmd, {'include_timed' : true});
        }

        // tick again
        setTimeout(this.tick_static_timers.bind(this),Config.ctrl().timer_interval_seconds * 1000);
    }

}

module.exports = Timers;