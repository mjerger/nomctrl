const { InfluxDB } = require('influx');

const Utils   = require('./utils.js');

class Logger
{
    static async init (config) {

        console.log ('Loading logger...');

        this.ready = false;
        this.db = config.database;
        this.influx = new InfluxDB(config.influx);

        await this.influx.getDatabaseNames()
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
        
    static async log(id, attribute_map) {
    
        // coerce values into Influx-friendly field types (number, boolean, string).
        const fields = {};
        for (const [key, raw] of Object.entries(attribute_map)) {
            if (raw === undefined || raw === null) 
                continue;
        
            let val = raw;
            if (val instanceof Date) {
                val = val.toISOString();
            } else if (typeof val === 'object') 
            {
                try {
                    val = JSON.stringify(val);
                } catch {
                    val = String(val);
                }
            } else if (typeof val !== 'number' &&
                       typeof val !== 'boolean' &&
                       typeof val !== 'string')
            {
                val = String(val);
            }
    
            const fieldKey = String(key).trim();
            if (fieldKey) 
                fields[fieldKey] = val;
        }
    
        if (Object.keys(fields).length === 0) {
            console.error('influxdb: No valid attributes to write (all were null/undefined or invalid).');
            return;
        }
    
        await this.influx.writePoints(
            [
                {
                    measurement : id,
                    //tags : { device },
                    fields,
                    // omit timestamp to use server time; or set: timestamp: new Date()
                },
            ],
            undefined // todo check retentionpolicy
        );
    }
}

module.exports = Logger;