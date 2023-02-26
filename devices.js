const Config  = require('./config.js');
const Utils   = require('./utils.js');

class Device 
{
    setter = [];
    getter = [];
    
    hasSet(attr) { return this.setter.includes(attr); }
    hasGet(attr) { return this.getter.includes(attr); }

    online = false;
    last_seen = 0;
    state = {};

    constructor(cfg_device, is_multi_node = false) { 
        this.id   = cfg_device.id;
        this.type = cfg_device.type;
        this.name = cfg_device.name;
        this.multi_node = is_multi_node;
    }

    async call(node, prefix, attr, val) {
        try {
            if (this.is_multi_node) {
                assert(node);
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

}

class HttpDevice extends Device 
{
    constructor(cfg_device) { 
        super(cfg_device);
        this.host = cfg_device.host; 
    }
}

const drivers = {
    'tasmota' : class Tasmota extends HttpDevice 
                {
                    constructor(config) { 
                        super(config);
                        this.setter = ['status', 'on', 'off', 'flip',];
                        this.getter = ['status', 'state', 'power', 'energy', 'energy_t', 'energy_y'];
                    }

                    async _get(attr1, attr2) {
                        let vals = await Utils.get(this.host, '/cm?cmnd=status')
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
                        let vals = await Utils.get(this.host, '/cm?cmnd=Status+10');
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

                        let vals = await _get_energy();
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
                    
                    async get_status       () { return this._get(); }
                    async get_state        () { const val = await this._get('Status', 'Power'); return val === 1;} 
                    async get_power_status () { return this._get_power_status(); }
                    async get_power        () { return this._get_energy('Power'); }
                    async get_energy       () { return this._get_energy('Total'); }
                    async get_energy_t     () { return this._get_energy('Today'); }
                    async get_energy_y     () { return this._get_energy('Yesterday'); }
                    async set_on           () { return Utils.get(this.host, '/cm?cmnd=power+on') }
                    async set_off          () { return Utils.get(this.host, '/cm?cmnd=power+off') }
                    async set_flip         () { return Utils.get(this.host, '/cm?cmnd=power+toggle') }
                },
                
    'wled'    : class WLED extends HttpDevice 
                {
                    constructor(config)  { 
                        super(config);
                        this.setter = ['status', 'on', 'off', 'flip', 'color', 'brightness'];
                        this.getter = ['status', 'state', 'color', 'brightness'];
                    }

                    static set_path = '/json/state';

                    async _get(attr1=null, attr2=null) { 
                        let res = await Utils.get (this.host, WLED.set_path);
                        if (res) {
                            if (attr1 && attr1 in res) res = res[attr1];
                            if (attr2 && attr2 in res) res = res[attr2];
                        }
                        return res;
                    }

                    async _get_segment(idx=0) { 
                        let res = await Utils.get (this.host, WLED.set_path);
                        if (res && 'seg' in res && res.seg.length > 0) {
                            return res.seg[idx];
                        }
                        return null;
                    }

                    async _post(json) {
                        return Utils.post(this.host, WLED.set_path, json);
                    }

                    // TODO set segment color brightness for multi-node instances
                    async _set_segment(color, idx=0) {
                        return this._post({ 'seg' : [ { 'col' : [color] } ] });
                    }
                    
                    async get_status     ()            { return this._get(); }
                    async get_state      ()            { const val = await this._get('status', 'on'); return val ? val : null; }
                    async get_brightness ()            { const val = await this._get('bri');          return val ? Math.floor(val / 2.55) : null; }
                    async get_color      ()            { const val = await this._get_segment();       return val ? val.col[0] : null; }
                    async set_on         ()            { return this._post({ 'on' : true  }) }
                    async set_off        ()            { return this._post({ 'on' : false }) }
                    async set_flip       ()            { return this._post({ 'on' : 't'   }) }
                    async set_color      (color)       { return this._post({ 'seg' : [ { 'col' : [color] } ] }) }
                    async set_brightness (percent)     { return this._post({ 'on' : true, 'bri' : Math.floor(percent*2.55) }) }
                },

    'nomframe' : class NomFrame extends HttpDevice 
                {
                    constructor(config) { 
                        super(config);
                        this.setter = ['status', 'on', 'off', 'flip', 'brightness'];
                        this.getter = ['status'];
                    }

                    async get_status()             { return 'NOT IMPLEMENTED'; }
                    async set_on    ()             { return Utils.get(this.host, '/r/on') }
                    async set_off   ()             { return Utils.get(this.host, '/r/off') }
                    async set_flip  ()             { return Utils.get(this.host, '/r/flip') }
                    async set_brightness (percent) { return Utils.get(this.host, '/r/brightness?val=' + percent) }
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

    static mark_online(id) {
        this.devices.get(id).online = true;
    }

    static async start() {
        console.log ('Starting device monitor');
        this.monitor();
    }

    static async monitor() {
        setTimeout(this.monitor.bind(this), /* JS is weird */ Config.ctrl().device_monitor_seconds * 1000);

        // TODO monitoring stuff
        // 1) get state
        // 2) set online state, device state, last seen date
    }
}

module.exports = Devices;