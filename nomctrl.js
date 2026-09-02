const nc = module.exports;

const config   = require('./config/definitions.js');
const utils    = require('./utils.js');
const storage  = require('./storage.js');
const devices  = require('./devices.js');
const nodes    = require('./nodes.js');
const logger   = require('./logger.js');
const timers   = require('./timers.js');
const events   = require('./events.js');
const commands = require('./commands.js');

nc.utils    = utils;
nc.config   = config;
nc.storage  = storage;
nc.devices  = devices;
nc.nodes    = nodes;
nc.logger   = logger;
nc.log      = logger.log
nc.timers   = timers;  
nc.events   = events;  
nc.commands = commands;

const express = require("express");
const parser = require('body-parser');

const app = express();

app.listen(config.app.port, function () {
    app.use(express.static('data/www'))
    app.use(parser.json());
    app.use(express.urlencoded())

    console.log ("Loading config...");
    let success = validate_config();
    if (!success) 
        process.exit(-1);

    const line = "~".repeat(26+(""+config.app.port).length)
    console.log(line);
    console.log(`nomctrl listening on port ${config.app.port}`);
    console.log(line);

    storage.init(config.app);
    devices.init(config.devices);
    nodes  .init(config.nodes, config.groups);
    logger .init(config.log);
    timers .init(config.timers,  execute);
    events .init(config.actions, execute);

    devices.start();
    timers.start();
    events.start();
});

function validate_config() {
        
    // unique ids for devices, nodes, groups and colors
    let ids = new Set();
    let unique = true;
    function all_unique(item) { 
        if(ids.has(item.id)) {
            unique = false;
            console.error(`config Error: duplicate id ${item.id}`);
        } else {
            if (item.id) ids.add(item.id);
        }
    }

    config.nodes.forEach(all_unique);
    config.groups.forEach(all_unique);
    config.colors.forEach(all_unique);

    return unique;
}

// ROUTES

app.get("/", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/status", async (req, res) => {
    //TODO status page
    res.send(await execute("status"));
});

app.post("/cmd", parser.text({type:"*/*"}), async (req, res) => {
    console.log(`cmd: ${req.body}`);
    res.send(await execute(req.body));
});

app.get("/cmd/:cmd", async (req, res) => {
    console.log(`cmd: ${req.params.cmd}`)
    res.send(await execute(req.params.cmd));
});

app.post("/do", parser.text({type:"*/*"}), async (req, res) => {
    console.log(`do: ${req.body}`)
    res.send(await execute(`do ${req.body}`));
});

app.get("/do/:action", async (req, res) => {
    console.log(`do: ${req.params.action}`)
    res.send(await execute(`do ${req.params.action}`));
});


// does command a override command b?
function overrides(a, b) {
    // same command
    if (a === b) return true;

    // off/on/flip has prio
    if (['state', 'flip'].includes(a) && ['state', 'flip'].includes(b))
    {
        return true;
    }

    return false;
}

// the main command execution function
async function execute(cmds, opts={}) {
    let results = { errors : []};

    if (!cmds)
        return;

    //
    // 1) PARSE
    //

    // make into list
    if (typeof cmds === 'string') {
        if (cmds.indexOf(';') > -1)
            cmds = cmds.split(/;/);
        else
            cmds = [cmds];
    }

    // parse all cmds into todos
    let todo = {};
    for (const cmd of cmds) {
         let res = nc.commands.parse(cmd, opts);
         todo = nc.utils.merge(todo, res);
    }

    if (todo.errors) results.errors = todo.errors 

    //
    // 2) EXECUTE GETTER
    //

    if (todo.getter) {

        // every getter only once
        todo.getter = nc.utils.remove_duplicates(todo.getter);
        
        // call getters
        let get_results = {};
        for (const g of todo.getter) {
            const [id, attr] = g;
            if (!(id in get_results))
                get_results[id] = {};
            get_results[id][attr] = nc.nodes.get(id).get(attr)
        }

        // await results
        for (const id in get_results)
            for (const attr in get_results[id])
                get_results[id][attr] = await get_results[id][attr];

        // apply calc funcs
        if (todo.calc) {

            // collect attributes
            let attrs = [];
            for (const id in get_results)
                for (const attr in get_results[id])
                    if (!attrs.includes(attr)) 
                        attrs.push(attr);

            // calc
            for (const attr of attrs) {

                // pre
                let res_val = 0;
                switch (todo.calc) {
                    case 'min': res_val = Number.MAX_SAFE_INTEGER; break; 
                    case 'max': res_val = Number.MIN_SAFE_INTEGER; break;
                }

                // iter
                let count = 0;
                for (const id in get_results) {
                    if (attr in get_results[id]) {
                        // get val
                        const val = get_results[id][attr]; 
                        if (val != null) {
                            if (typeof val != 'number') {
                                results = nc.utils.merge(results, { errors : [`Value type '${typeof val}' of attribute '${attr}' not supported by '${todo.calc}'`]});
                                continue;
                            }

                            count += 1;
                            switch(todo.calc) {
                                case 'sum': res_val += val; break;
                                case 'avg': res_val += val; break;
                                case 'min': res_val = Math.min(res_val, val); break;
                                case 'max': res_val = Math.max(res_val, val); break;
                            }
                        }
                    }
                }

                // post
                switch (todo.calc) {
                    case 'avg' : res_val /= count; break;
                }

                results[attr + '_' + todo.calc] = res_val;
            }
        } else {
            results = get_results;
        }
    }
    
    //
    // 3) EXECUTE SETTER
    //
    if (todo.setter) {
        // setter conflicts: last command in list overrides previous commands, sometimes
        if (todo.setter.length > 1) {
            for (let i = 0; i < todo.setter.length-1; i++) {
                for (let j = i+1; j < todo.setter.length; j++) {
                    // same device
                    if (todo.setter[i][0] === todo.setter[j][0]) {
                        // next command in list overrides previous one 
                        if (overrides(todo.setter[j][1], todo.setter[i][1])) {
                            todo.setter.splice(i, 1);
                        }
                    }
                }
            }
        }

        // call setter
        let set_results = []; 
        for (const [id, attr, val] of todo.setter) {
            if (id && attr) {
                if (val == undefined) {
                    set_results.push(nc.nodes.get(id).set(attr));
                } else {
                    set_results.push(nc.nodes.get(id).set(attr, val));
                }

                nc.timers.remove_fader(id, attr);
            }
        }

        set_results = await Promise.all(set_results);
        // TODO do something with result?
    }

    //
    // 4) FADE VALUES
    //
    if (todo.faders) {
        for (const [node, attr, from, to, duration] of todo.faders) {
            nc.timers.add_fader(node, attr, from, to, duration)
        }
    }

    //
    // 4) SET LATER
    //
    if (todo.set_at) {
        for (const [node, attr, value, time] of todo.set_at) {
            nc.timers.add_single_shot(node, attr, `set ${node} ${attr}${value !== undefined ? ' '+value : ''}`, time);
        }
    }

    //
    // 5) OUTPUT
    //

    if (results.errors) {
        if (results.errors.length > 0) {
            results.status = 'error';
        } else {
            delete results.errors;
            results.status = 'success';
        }
    } else {
        results.status = 'success';
    }

    if (results.errors)
         console.error({error: results.errors})

    return JSON.stringify(results);
}