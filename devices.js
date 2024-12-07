const Config  = require('./config.js');
const Utils   = require('./utils.js');

class Device 
{
    setter = [];
    getter = ['online'];
    
    hasSet(attr) { return this.setter.includes(attr); }
    hasGet(attr) { return this.getter.includes(attr); }

    online = true;
    last_seen = 0;

    constructor(cfg_device, is_multi_node = false) { 
        this.id   = cfg_device.id;
        this.type = cfg_device.type;
        this.multi_node = is_multi_node;
    }

    start() {
        setTimeout(this.check_online.bind(this), 100);
    }

    async call(node, prefix, attr, val) {
        try {
            if (this.is_multi_node) {
                if (val !== null)
                    return this[prefix + '_' + attr](node, val);
                else
                    return this[prefix + '_' + attr](node);
            } else {
                if (val !== null)
                    return this[prefix + '_' + attr](val);
                else
                    return this[prefix + '_' + attr]();
            }
        } catch (e) {
            console.log (`Call error ${prefix} ${node.id}.${attr} ${val?val:''}`)
        }
    }

    async check_online() {
        setTimeout(this.check_online.bind(this), Config.app().ping_interval * 1000);
        this.ping();
    }
}

class HttpDevice extends Device 
{
    ping_path = "/"

    constructor(cfg_device) { 
        super(cfg_device);
        this.host = "http://" + cfg_device.host; 
    }

    set_online(online) {
        if (this.online != online) {
            this.online = online;
            console.log (`Device: ${this.id} ${online ? 'online' : `offline [${this.host}]`}`)
        }

        if(online)
            this.last_seen = +Date.now();
    }

    async ping() {
        await this.http_get(this.ping_path)
        return this.online;
    }

    async http_get(path) {
        return Utils.get(this.host, path).then(res => this.set_online(!!res));
    }

    async http_post(path, json) {
        Utils.post(this.host, path, json).then(res => this.set_online(!!res));
    }

    async get_online() { 
        return this.online;
    }

}

const drivers = {
    
    //
    // TASMOTA
    //

    'tasmota' : class Tasmota extends HttpDevice 
    {
        constructor(config) { 
            super(config);
            this.getter = this.getter.concat(['info', 'state', 'power', 'power_status',  'energy', 'energy_t', 'energy_y', 'voltage', 'current']);
            this.setter = this.setter.concat(['state', 'flip']);
            this.ping_path = "/cm"
        }

        async _get(attr1, attr2) {
            let vals = await this.http_get('/cm?cmnd=status')
            if (!vals) 
                return null;
            if (attr1 === undefined) 
                return vals;
            if (!(attr1 in vals))
                return null;

            vals = vals[attr1];
            
            if (attr2 === undefined)
                return vals;
            if (!(attr2 in vals)) 
                return null;
            return vals[attr2];
        }

        async _get_energy(attr) {
            let vals = await this.http_get('/cm?cmnd=Status+10');
            if (vals && 'StatusSNS' in vals) {
                vals = vals['StatusSNS'];
                if (vals && 'ENERGY' in vals) {
                    vals = vals['ENERGY'];

                    if (attr === undefined)
                        return vals;
                    if (!(attr in vals))
                        return null;
                    return vals[attr];
                }
            }
            return vals;
        }

        async _get_power_status() {

            let vals = await this._get_energy();
            const attrs = [ ['total',      'Total'], 
                            ['start_time', 'TotalStartTime'], 
                            ['yesterday',  'Yesterday'], 
                            ['today',      'Today'], 
                            ['power',      'Power'], 
                            ['power_va',   'ApparentPower'], 
                            ['power_var',  'ReactivePower'], 
                            ['factor',     'Factor'], 
                            ['voltage',    'Voltage'], 
                            ['current',    'Current']];

            let result = null;
            if (vals && 'ENERGY' in vals) {
                vals = vals['ENERGY'];
                result = {};
                for (const [ours, theirs] of attrs) {
                    result[ours] = vals[theirs];
                }
            }
            return result;
        }
        
        async get_info         ()        { return this._get(); }
        async get_status       ()        { const val = await this._get('Status', 'Power'); return val === 1;} 
        async get_power_status ()        { return this._get_power_status(); }
        async get_power        ()        { return this._get_energy('Power'); }
        async get_voltage      ()        { return this._get_energy('Voltage'); }
        async get_current      ()        { return this._get_energy('Current'); }
        async get_energy       ()        { return this._get_energy('Total'); }
        async get_energy_t     ()        { return this._get_energy('Today'); }
        async get_energy_y     ()        { return this._get_energy('Yesterday'); }
        
        async set_state        (enabled) { return this.http_get('/cm?cmnd=power+' + (enabled ? 'on' : 'off')) }
        async set_flip         ()        { return this.http_get('/cm?cmnd=power+toggle') }
    },

    //
    // WLED (JSON API)
    //

    'wled' : class WLED extends HttpDevice 
    {
        constructor(config)  { 
            super(config);
            this.getter = this.getter.concat(['info', 'state', 'color', 'brightness']);
            this.setter = this.setter.concat(['state', 'flip', 'color', 'brightness', 'effect']);
            this.ping_path = "/json/state"
        }

        static set_path = '/json/state';

        async _get(attr1, attr2) { 
            let res = await this.http_get(WLED.set_path);
            if (res) {
                if (attr1 !== undefined && attr1 in res) res = res[attr1];
                if (attr2 !== undefined && attr2 in res) res = res[attr2];
            }
            return res;
        }

        async _get_segment(idx=0) { 
            let res = await this.http_get(WLED.set_path);
            if (res && 'seg' in res && res.seg.length > 0) {
                return res.seg[idx];
            }
            return null;
        }

        async _post(json) {
            return this.http_post(WLED.set_path, json);
        }

        static get_effect(effect) {
            switch (effect) {
                case "solid": return { fx : 0 }
            }
        }
        
        // GET
        async get_info       ()            { return this._get(); }
        async get_state      ()            { const val = await this._get('status', 'on'); return val ? val : false; }
        async get_brightness ()            { const val = await this._get('bri');          return val ? Math.round(Utils.map_range(val, 0, 255, 0, 100)) : null; }
        async get_color      ()            { const val = await this._get_segment();       return val ? val.col[0] : null; }

        // SET
        async set_state      (enabled)     { return this._post({ 'on' : !!enabled  }) }
        async set_flip       ()            { return this._post({ 'on' : 't'   }) }
        async set_color      (color)       { return this._post({ 'seg' : [ { 'col' : [color] } ] }) }
        async set_brightness (percent)     { return this._post({ 'bri' : Math.round(Utils.map_range(percent, 0, 100, 0, 255)) }) }
        async set_effect     (effect)      { return this._post({ 'seg' : [ { 'fx' : get_effect(effect).fx } ] }) }
    },

    //
    // nomframe
    //

    'nomframe' : class NomFrame extends HttpDevice 
    {
        constructor(config) { 
            super(config);
            this.setter = this.setter.concat(['state', 'flip', 'brightness']);
        }

        // SET
        async set_state (enable)       { return this.http_get((enable ? '/r/on' : '/r/off'))  }
        async set_flip  ()             { return this.http_get('/r/flip') }
        async set_brightness (percent) { return this.http_get('/r/brightness?val=' + percent) }
    },                
}

class Devices
{
    static devices = new Map();

    static init(cfg_devices) {
        console.log ('Loading devices...');
        this.devices.clear();
        let error = false;

        for (const cfg of cfg_devices) {
            if (cfg.type in drivers) {
                this.devices.set(cfg.id, new drivers[cfg.type](cfg));
            } else {
                console.error(`Config Error: Device ${cfg.id} has unknown device type ${cfg.type}.`);
                error = true;
            }
        }
        return error;
    }

    static all() {
        return this.devices.values();
    }

    static get(id) {
        return this.devices.get(id);
    }

    static async start() {
        for (var device of this.all())
            device.start();
    }
}

module.exports = Devices;