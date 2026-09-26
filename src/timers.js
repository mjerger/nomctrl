const nc = require('./nomctrl.js');

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

        for (var i of [1,2,3,4]) {
            if (cfg['on_'+i])
                this.events.push([cfg['on_'+i], `set ${cfg.node} on`]);
            if (cfg['off_'+i])
                this.events.push([cfg['off_'+i], `set ${cfg.node} off`]);
        }

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
        return (nc.utils.parse_time(when) < time);
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
                rgb[i] = Math.floor(nc.utils.lerp(this.from[i], this.to[i], fac));
            }
            return rgb;

        } else if (this.attr === 'brightness') {
            const val = Math.floor(nc.utils.lerp(this.from, this.to, fac));
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

const timers = new Map();
const faders = new Array();
let execute = undefined;

function init(cfg_timers, exe) {
    execute = exe;

    console.log ('Loading timers...');
    timers.clear();
    let error = false;

    // timer definitions
    for (const cfg of cfg_timers) {
        const id = cfg.id
        if (timers.has(id)) {
            // merge timer definitions
            if ('node' in cfg && timers.get(id).node === cfg.node) {
                timers.set(id, merge(cfg));
            } else {
                console.error(`Config Error: incompatible timer configuration on timer '${id}'`);
                error = true;
            }
        } else {
            timers.set(id, new Timer(cfg));
        }
    }

    return error;
}

async function start() {
    console.log ('Starting timers...');
    setTimeout(tick_static_timers, 100);
    setTimeout(tick_faders, 100);
}

function add_fader(node, attr, from, to, duration) {
    remove_fader(node, attr);
    faders.push(new Fader(node, attr, from, to, duration));
    tick_faders();
}

function remove_fader(node, attr) {
    for (const id of faders.keys()) {
        const fader = fader.get(id);
        if (fader && !fader.node === node && fader.attr === attr) {
            faders.delete(id);
        }
    }
}

function add_single_shot(node, attr, command, when) {
    remove_single_shot(node, attr);
    const timer = new SingleShotTimer(node, attr, command, when);
    timers.set(timer.id, timer);
    tick_singleshot_timers();
}

function remove_single_shot(node, attr) {
    for (const id of timers.keys()) {
        const timer = timers.get(id);
        if (timer && timer.single && timer.node === node && timer.attr === attr) {
            timers.delete(id);
        }
    }
}

async function tick_faders() {
    const now = Date.now();

    // remove stopped
    for (const id of faders.keys()) {
        const fader = fader.get(id);
        if (fader && !fader.is_active(now)) {
            faders.delete(id);
        }
    }

    if (faders.length == 0) 
        return;
        
    // get new values, if any
    let logged = false;
    let setter = [];
    for (const fader of faders) {
        if (fader.has_new_value(now)) {
            // hacky log order
            if (!logged) {
                console.log('Fading...');
                logged = true;
            }
            const new_value = fader.get_value(now);
            setter.push(nc.nodes.get(fader.node).set(fader.attr, new_value));
            fader.last_value = new_value;
        }
    }

    // do it
    if (setter.length > 0) {
        await Promise.all(setter);
    }

    // tick again
    setTimeout(tick_faders, 2000);
}

// handle single shot timers
async function tick_singleshot_timers() {
    if (timers.size == 0)
        return;

    for (const id of timers.keys()) {
        let timer = timers.get(id);
        if (!timer.single)
            continue;
        
        if (timer.is_triggered(Date.now())) {
            timers.delete(timer.id);

            const cmd = timer.get_command();
            console.log(`timer ${timer.id} single`);
            await execute(cmd, {'include_timed' : true});
        }
    }

    // tick again
    setTimeout(tick_singleshot_timers,1000);
}

// handle strict timers
async function tick_static_timers() {
    for (const timer of timers.values()) {
        if (!timer.strict || timer.single)
            continue;
        
        // we have take into account the events for yesterday, so timers can behave correctly during midnight
        const times_today = timer.events.map(e => nc.utils.parse_time(e[0]));
        const times_yesterday = times_today.map(t => t - (3600*24*1000));
        const times = times_yesterday.concat(times_today);

        let cmds = timer.events.map(e => e[1]);
        cmds = cmds.concat(cmds);
        const currentStateCmd = nc.utils.parse_closest(times, cmds, Date.now());

        console.log(`timer ${timer.id} strict`);
        await execute(currentStateCmd, {'include_timed' : true});
    }

    // tick again
    setTimeout(tick_static_timers,nc.config.app.timer_interval * 1000);
}

module.exports = { init, start, add_fader, remove_fader, add_single_shot, remove_single_shot };