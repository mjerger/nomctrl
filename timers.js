const Config  = require('./config.js');
const Utils   = require('./utils.js');
const Commands  = require('./commands.js');

class Timer {
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

class Timers
{
    static timers = {};

    static load(cfg_timers, cfg_actions) {
        console.log ("Loading timers...");
        Timers.timers = {};
        let error = false;

        // Timer definitions
        for (let cfg of cfg_timers) {
            let id = cfg.id
            if (id in Timers.timers) {
                if ("node" in cfg && Timers.timers[id].node === cfg.node) {
                    Timers.timers[id].merge(cfg);
                } else {
                    console.log(`Config Error: incompatible timer configuration on timer "${id}"`);
                    error = true;
                }
            } else {
                Timers.timers[id] = new Timer(cfg);
            }
        }

        // Actions with timers
        // TODO

        return error;
    }

    static get(id) {
        return Timer.timers[id];
    }

    static async start() {
        console.log ("Starting timers");
        Timers.tick();
    }

    static async tick() {
        setTimeout(this.tick.bind(this), /* JS is weird */ Config.ctrl().timer_interval_seconds * 1000);

        // execute strict timers
        for await (const [id, timer] of Object.entries(Timers.timers)) {
            if (!timer.strict)
                continue;
            
            let times = timer.events.map(e => Utils.parseTime(e[0]));
            let cmds  = timer.events.map(e => e[1]);
            let currentStateCmd = Utils.findClosest(times, cmds, Date.now());

            console.log(`Timer ${id}: "${currentStateCmd}" for node ${timer.node}`);
            await Commands.execute(currentStateCmd, {"include_timed" : true});
        }

    }

}

module.exports = Timers;