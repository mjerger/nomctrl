const Utils    = require('./utils.js');
const Config   = require('./config.js');
const Devices  = require('./devices.js');
const Nodes    = require('./nodes.js');
const Logger   = require('./logger.js');
const Timers   = require('./timers.js');
const Events   = require('./events.js');
const Commands = require('./commands.js');

const express = require("express");
const bodyParser = require('body-parser');
const app = express();

// STARTUP

app.listen(Config.app().port, function () {
    app.use(express.static('www'))
    app.use(bodyParser.json());
    app.use(express.urlencoded())

    console.log ("Loading config...");
    let success = Config.validate();
    if (!success) process.exit(-1);

    const line = "~".repeat(26+(""+Config.app().port).length)
    console.log(line);
    console.log(`nomctrl listening on port ${Config.app().port}`);
    console.log(line);

    Devices.init(Config.devices());
    Nodes.init(Config.nodes(), Config.groups());
    Logger.init(Config.app().logs);
    Timers.init(Config.timers(), execute);
    Events.init(Config.actions(), execute);

    Devices.start();
    Timers.start();
    Events.start();
});

// ROUTES

app.get("/", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/status", async (req, res) => {
    //TODO status page
    res.send(await execute("status"));
});

app.post("/cmd", bodyParser.text({type:"*/*"}), async (req, res) => {
    console.log(`cmd: ${req.body}`);
    res.send(await execute(req.body));
});

app.get("/cmd/:cmd", async (req, res) => {
    console.log(`cmd: ${req.params.cmd}`)
    res.send(await execute(req.params.cmd));
});

app.post("/do", bodyParser.text({type:"*/*"}), async (req, res) => {
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
         let res = Commands.parse(cmd, opts);
         todo = Utils.merge(todo, res);
    }

    if (todo.errors) results.errors = todo.errors 

    //
    // 2) EXECUTE GETTER
    //

    if (todo.getter) {

        // every getter only once
        todo.getter = Utils.removeDuplicates(todo.getter);
        
        // call getters
        let get_results = {};
        for (const g of todo.getter) {
            const [id, attr] = g;
            if (!(id in get_results))
                get_results[id] = {};
            get_results[id][attr] = Nodes.get(id).get(attr)
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
                                results = Utils.merge(results, { errors : [`Value type '${typeof val}' of attribute '${attr}' not supported by '${todo.calc}'`]});
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
                    set_results.push(Nodes.get(id).set(attr));
                } else {
                    set_results.push(Nodes.get(id).set(attr, val));
                }

                Timers.removeFader(id, attr);
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
            Timers.addFader(node, attr, from, to, duration)
        }
    }

    //
    // 4) SET LATER
    //
    if (todo.set_at) {
        for (const [node, attr, value, time] of todo.set_at) {
            Timers.addSingleShot(node, attr, `set ${node} ${attr}${value ? ' '+value : ''}`, time);
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