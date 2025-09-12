const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Nodes   = require('./nodes.js');
const crypto = require('crypto');

class Timer 
{
    events = []

    constructor(cfg) { 
        if (cfg) {
            this.id = cfg.id;
            this.node = cfg.node;
            this.strict = cfg.strict ? true : false;
            this.single = cfg.single ? true : false;
            this.parseEvents(cfg);
        }
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

class SingleShotTimer extends Timer
{
    constructor(node, attr, command, when) {
        super();
        const id = 'single_' + crypto.randomBytes(3).toString('hex');;
        this.id = id;
        this.node = node;
        this.strict = false;
        this.single = true;
        this.events.push([String(when), command]);
        this.attr = attr;
    }

    is_triggered (time) {
        const when = this.events[0][0];
        const int = Utils.parseTime(when);
        return (int < time);
    }

    get_command () {
        return this.events[0][1];
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

    static init(cfg_timers, execute) {
        this.execute = execute;

        console.log ('Loading timers...');
        this.timers.clear();
        let error = false;

        // timer definitions
        for (const cfg of cfg_timers) {
            const id = cfg.id
            if (this.timers.has(id)) {
                // merge timer definitions
                if ('node' in cfg && this.timers.get(id).node === cfg.node) {
                    this.timers.set(id, merge(cfg));
                } else {
                    console.error(`Config Error: incompatible timer configuration on timer '${id}'`);
                    error = true;
                }
            } else {
                this.timers.set(id, new Timer(cfg));
            }
        }

        return error;
    }
    
    static async start() {
        console.log ('Starting timers...');
        setTimeout(this.tick_static_timers.bind(this), 100);
        setTimeout(this.tick_faders.bind(this), 100);
    }

    static getTimer(id) {
        return this.timers.get(id);
    }
    
    static getTimerIds() {
        return this.timers.keys();
    }

    static addFader(node, attr, from, to, duration) {
        this.removeFader(node, attr);
        this.faders.push(new Fader(node, attr, from, to, duration));
        this.tick_faders();
    }

    static removeFader(node, attr) {
        this.faders = this.faders.filter(f => !(f.node === node && f.attr === attr));
    }

    static addSingleShot(node, attr, command, when) {
        this.removeSingleShot(node, attr);
        const timer = new SingleShotTimer(node, attr, command, when);
        this.timers.set(timer.id, timer);
        this.tick_singleshot_timers();
    }

    static removeSingleShot(node, attr) {
        for (const id of this.timers.keys()) {
            const timer = this.timers.get(id);
            if (timer && timer.single && timer.node === node && timer.attr === attr) {
                this.timers.delete(id);
            }
        }
    }

    static async tick_faders() {
        const now = Date.now();

        // remove stopped
        this.faders = this.faders.filter(f => f.is_active(now));

        if (this.faders.length == 0) 
            return;
            
        // get new values, if any
        let logged = false;
        let setter = [];
        for (const fader of this.faders) {
            if (fader.has_new_value(now)) {
                // hacky log order
                if (!logged) {
                    console.log('Fading...');
                    logged = true;
                }
                const new_value = fader.get_value(now);
                setter.push(Nodes.get(fader.node).set(fader.attr, new_value));
                fader.last_value = new_value;
            }
        }

        // do it
        if (setter.length > 0) {
            await Promise.all(setter);
        }

        // tick again
        setTimeout(this.tick_faders.bind(this), 2000);
    }

    // handle single shot timers
    static async tick_singleshot_timers() {
        if (this.timers.size == 0)
            return;

        for (const id of this.timers.keys()) {
            let timer = this.timers.get(id);
            if (!timer.single)
                continue;
            
            if (timer.is_triggered(Date.now())) {
                this.timers.delete(timer.id);

                const cmd = timer.get_command();
                console.log(`Timer: ${timer.id} single`);
                await this.execute(cmd, {'include_timed' : true});
            }
        }

        // tick again
        setTimeout(this.tick_singleshot_timers.bind(this),1000);
    }

    // handle strict timers
    static async tick_static_timers() {
        for (const timer of this.timers.values()) {
            if (!timer.strict || timer.single)
                continue;
            
            // we have take into account the events for yesterday, so timers can behave correctly during midnight
            const times_today = timer.events.map(e => Utils.parseTime(e[0]));
            const times_yesterday = times_today.map(t => t - (3600*24*1000));
            const times = times_yesterday.concat(times_today);

            let cmds = timer.events.map(e => e[1]);
            cmds = cmds.concat(cmds);
            const currentStateCmd = Utils.findClosest(times, cmds, Date.now());

            console.log(`Timer: ${timer.id} strict`);
            await this.execute(currentStateCmd, {'include_timed' : true});
        }

        // tick again
        setTimeout(this.tick_static_timers.bind(this),Config.app().timer_interval * 1000);
    }
}

module.exports = Timers;