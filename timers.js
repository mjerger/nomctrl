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
    list = {};

    constructor() {
        Config.timers().forEach( timer => {
            if (timer.id in this.list) {
                if ("node" in timer && this.list[timer.id].node === timer.node) {
                    this.list[timer.id].merge(timer);
                } else {
                    console.log(`Config Error: incompatible timer configuration on timer "${timer.id}"`);
                }
            } else {
                this.list[timer.id] = new Timer(timer);
            }
        });
    }

    async start() {
        console.log ("Starting timers");
        this.tick();
    }

    async tick() {
        setTimeout(this.tick.bind(this), /* JS is weird */ Config.ctrl().timer_seconds * 1000);

        // execute strict timers
        for (const [id, timer] of Object.entries(this.list)) {
            if (!timer.strict)
                continue;
            
            let times = timer.events.map(e => Utils.parseTime(e[0]));
            let cmds  = timer.events.map(e => e[1]);
            let currentStateCmd = Utils.findClosest(times, cmds, Date.now());

            console.log(`Timer ${id}: "${currentStateCmd}" for node ${timer.node}`);
            Commands.execute(currentStateCmd, {"include_timed" : true});
        }

    }

}

module.exports = Timers;