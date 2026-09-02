const nc = require('./nomctrl.js');

const { InfluxDB } = require('influx');

var ready = false;
var db = undefined;
var influx = undefined;
var groups = undefined;
var ignore = undefined;
var log_unmapped = undefined;

async function init (config) {

    console.log ('Loading logger...');

    ready = false;
    groups = config.groups;
    ignore = config.ignore
    log_unmapped = config.log_unmapped

    influx = new InfluxDB(config.influx);

    await influx
        .getDatabaseNames()
        .catch(err => {
            console.error(`error fetching InfluxDB database: ${err}`);
        })
        .then( (dbs) => {
            if (dbs && !dbs.includes(db)) {
                influx.createDatabase(db)
                        .catch(err => { console.error(`Error creating InfluxDB database`)})
                        .then(() => {
                        console.log (`InfluxDB connected ${config.influx.host}:${config.influx.port}/${config.influx.database}`);
                        ready = true;
                        });
            };
        });
}
    
async function log(device, attr, val) {

    // configurable filter
    if (is_ignored(device, attr, val))
        return;

    // get the measurement group
    const group = get_group_for(device, attr);
    
    // drop unmapped stuff
    if (!group)
        return;

    // coerce value type
    if (val instanceof Date)
    {
        val = val.toISOString();
    } 
    else if (typeof val === 'object') 
    {
        try {
            val = JSON.stringify(val);
        } catch {ou
            val = String(val);
        }
    } 
    else if (typeof val !== 'number' &&
                typeof val !== 'boolean' &&
                typeof val !== 'string')
    {
        val = String(val);
    } else if (typeof val === 'number' && (isNaN(val) || !isFinite(val))) {
        // invalid value
        return;
    }

    let tags = { device : device.id, 
                    type :   device.type};

    if (device.subtype)
        tags.type = `${device.type}.${device.subtype}`;

    // log it
    try {
        await influx.writePoints(
            [
                {
                    measurement : group,
                    tags : tags,
                    fields: { [attr]: val },
                },
            ]
        );
    } catch (err) {
        console.error(`InfluxDB write failed: ${err.message}`);
    }

}

function is_ignored(device, attr, val) {
    if (ignore === undefined)
        return false;
    
    const keys = Object.keys(ignore);
    for (const k of keys) {
        if (k == attr) {
            const v = ignore[k];
            if (typeof v === "string") {
                if (val == v)
                    return true;
            }
        }
        
        // more filtering can go here
    }
    
    return false;
}

function get_group_for(device, attr) {

    const keys = Object.keys(groups);

    // attribute of specific device
    for (const group of keys) {
        for (const a of groups[group]) {
            if (a === `${device.id}.${attr}`)
                return group;
        }
    }

    // attribute of devices of specific type
    for (const group of keys) {
        for (const a of groups[group]) {
            if (a === `${device.type}.${attr}`)
                return group;
        }
    }

    // attributes of any device
    for (const group of keys) {
        for (const a of groups[group]) {
            if (a === attr)
                return group;
        }
    }

    if (log_unmapped)
        return "unmapped";
    
    return undefined;
}

module.exports = { init, log };