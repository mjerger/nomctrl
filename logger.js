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
        
    static async log(id, attr, val) {
    
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

        await this.influx.writePoints(
            [
                {
                    measurement : attr,
                    tags : { device: id },
                    fields: { value: val },
                },
            ]
        );
    }
}

module.exports = Logger;