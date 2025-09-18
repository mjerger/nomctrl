const { InfluxDB } = require('influx');

const Utils   = require('./utils.js');

class Logger
{
    static async init (config) {

        console.log ('Loading logger...');

        this.ready = false;

        this.db = config.database;
        this.groups = config.groups;
        this.ignore = config.ignore
        this.log_unmapped = config.log_unmapped

        this.influx = new InfluxDB(config.influx);

        await this.influx
            .getDatabaseNames()
            .catch(err => {
                console.error(`error fetching influxdb database: ${err}`);
            })
            .then( (dbs) => {
                if (dbs && !dbs.includes(this.db)) {
                    this.influx.createDatabase(this.db)
                            .catch(err => { console.error(`Error creating Influx database`)})
                            .then(() => {
                            console.log ("influxdb connected");
                            this.ready = true;
                            });
                };
            });
    }
        
    static async log(device, attr, val) {

        // configurable filter
        if (this.is_ignored(device, attr, val))
            return;

        // get the measurement group
        const group = this.get_group_for(device, attr);
        
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
        }

        let tags = { device : device.id, 
                     type :   device.type};

        if (device.subtype)
            tags.type = `${device.type}.${device.subtype}`;

        // log it
        await this.influx.writePoints(
            [
                {
                    measurement : group,
                    tags : tags, 
                    fields: { [attr]: val },
                },
            ]
        );

    }

    static is_ignored(device, attr, val) {
        if (this.ignore === undefined)
            return false;
        
        const keys = Object.keys(this.ignore);
        for (const k of keys) {
            if (k == attr) {
                const v = this.ignore[k];
                if (typeof v === "string") {
                    if (val == v)
                        return true;
                }
            }
            
            // more filtering can go here
        }
        
        return false;
    }

    static get_group_for(device, attr) {

        const keys = Object.keys(this.groups);

        // attribute of specific device
        for (const group of keys) {
            for (const a of this.groups[group]) {
                if (a === `${device.id}.${attr}`)
                    return group;
            }
        }

        // attribute of devices of specific type
        for (const group of keys) {
            for (const a of this.groups[group]) {
                if (a === `${device.type}.${attr}`)
                    return group;
            }
        }

        // attributes of any device
        for (const group of keys) {
            for (const a of this.groups[group]) {
                if (a === attr)
                    return group;
            }
        }

        if (this.log_unmapped)
            return "unmapped";
        
        return undefined;
    }
}

module.exports = Logger;