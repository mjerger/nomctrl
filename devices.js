const Config  = require('./config.js');
const Utils   = require('./utils.js');

const { SerialPort } = require('serialport')

class Device 
{
    setter = [];
    getter = ['online'];
    
    hasSet(attr) { return this.setter.includes(attr); }
    hasGet(attr) { return this.getter.includes(attr); }

    online = true;
    last_seen = 0;

    constructor(config) { 
        this.id   = config.id;
        this.type = config.type;
        this.subtype = undefined
    }

    setup() {

    }

    start() {
        setTimeout(this.check_online.bind(this), 100);
    }

    async call(node, prefix, attr, val) {
        try {
            if (val !== null)
                return this[prefix + '_' + attr](val);
            else
                return this[prefix + '_' + attr]();
        } catch (e) {
            console.log (`Call error ${prefix} ${node.id}.${attr} ${val?val:''}`)
        }
    }

    async check_online() {
        setTimeout(this.check_online.bind(this), Config.app().ping_interval * 1000);
        if (this.ping) this.ping();
    }
}


class HttpDevice extends Device 
{
    ping_path = "/"

    constructor(config) { 
        super(config);
        this.id = this.id ?? config.host;
        this.host = "http://" + config.host; 
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
        const res = Utils.get(this.host, path)
        this.set_online(!!res); 
        return res;
    }

    async http_post(path, json) {
        const res = Utils.post(this.host, path, json);
        this.set_online(!!res);
        return res;
    }

    async get_online() { 
        return this.online;
    }
}


class SerialDevice extends Device 
{
    constructor(config) { 
        super(config);
        this.path = config.path; 
        this.serial = undefined;
    }

    open() {
        if (this.serial.isOpen) 
            return Promise.resolve();
        return new Promise((res, rej) => this.serial.open(err => err ? rej(err) : res()));
    }

    close() {
        this.online = false;
        if (this.serial.isOpen)
             return new Promise((res, rej) => this.serial.close(err => err ? rej(err) : res()));
        return Promise.resolve();
    }

    drain() {
        return new Promise((res, rej) => this.serial.drain(err => err ? rej(err) : res()));
    }

    write(buf) {
      return new Promise((res, rej) => {
        this.serial.write(buf, err => err ? rej(err) : this.serial.drain(err2 => err2 ? rej(err2) : res()));
      });
    }

    send(buf) {
        return this.write(buf+'\n');
    }

    read(timeout = 1000) {
        return new Promise((res, rej) => {
          const onData = (b) => { cleanup(); res(b); };
          const onErr  = (e) => { cleanup(); rej(e); };
          const to = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, timeout);
          const cleanup = () => {
            clearTimeout(to);
            this.serial.off('data', onData);
            this.serial.off('error', onErr);
          };
          this.serial.on('data', onData);
          this.serial.on('error', onErr);
        });
    }
}


const drivers = {

    //
    // CUL USB Stick
    //

    'cul' : class CUL extends SerialDevice 
    {
        constructor(config) { 
            super(config);
            this.frequency = undefined
            this.path = config.path;
            this.serial = new SerialPort({
                path: this.path,
                baudRate: 38400,
                autoOpen: false
            });
            
            this.serial.setEncoding('ascii');
        }
    
        async setup() {
            await this.close();
            await this.open();
            await this.drain();

            // get version
            await this.send('V');
            const v = await this.read();
            switch(true) {
                case /CUL868/.test(v): this.subtype='868'; this.freq=868.35; break;
                case /CUL433/.test(v): this.subtype='433'; this.freq=433.93; break;
                default: 
                   console.warning(`Device ${this.path} is not a CUL`);
            }

            console.log(`Found CUL${this.subtype} at ${this.path}`);

            // (re)config the stick
            // Note: writes to eeprom, no need to do it everytime
            if (Config.app().write_cul_config) {

                // set frequency 
                await this.set_freq(this.freq);

                // 8dB gain
                await this.set_sens(8);

                // tx pwoer
                await this.send('x09');
            }

            // start normal mode
            await this.send('X21'); 
            
            this.serial.on('readable', this.receive);

            this.online = true;
        }

        receive() {
            let data = this.read();
            console.log('rx', data.trim())

            // TODO forward to the appropriate device

            // S300HT and similar
            if (data[0] === 'K') {
      
                const firstbyte = parseInt(data[1], 16);
                const type = parseInt(data[2], 16) & 7; // always 1 for us
                                
                // sign bit
                const sgn = (firstbyte & 8) ? -1 : 1; 

                // shuffle the bytes
                const t = sgn * parseFloat(`${data[6]}${data[3]}.${data[4]}`);
                const h = parseFloat(`${data[7]}${data[8]}.${data[5]}`);

                const id = firstbyte & 7;
                console.log(`S300HT: id=${id} temp=${t}°C humid=${h}%`);
            
            // FS20 switch
            } else if (data[0] === 'F') {

                let housecode = data.slice(1,5);
                let device = data.slice(6,7);
                let command = data.slice(8,9);
                let timespec = data.slice(10,11);
                console.log('FS20: id=%s btn=%s cmd=%s t=%s', housecode, device, command, timespec);
            }
        }

        async ping() {
            // TODO implementme
        }

        // set frontend frequency
        async set_freq(freq_mhz) {

            const f  = (freq_mhz / 26) * 65536;
            const f2 = ((f / 65536) & 0xff).toString(16).padStart(2, "0");
            const f1 = (Math.floor(f % 65536 / 256) & 0xff).toString(16).padStart(2, "0");
            const f0 = (Math.floor(f % 256) & 0xff).toString(16).padStart(2, "0");
        
            const revcalc = (
            ((parseInt(f2, 16) * 65536 +
                parseInt(f1, 16) * 256 +
                parseInt(f0, 16)) /
                65536) * 26
            ).toFixed(3);
        
            console.log(`CUL ${this.path} set FREQ2..0 (0D,0E,0F) to ${f2} ${f1} ${f0} = ${revcalc} MHz`);
        
            await this.send(`W0F${f2}`);
            await this.send(`W10${f1}`);
            await this.send(`W11${f0}`);
        }

        // set frontend sensitivity, gain in decibel
        async set_sens(db) {
            if (typeof db !== "number" || db < 4 || db > 16)
                throw new Error("Sensitivity: value 4–16 expected");
        
            const w = Math.floor(db / 4) * 4; // step 4
            const v = "9" + (db / 4 - 1);     // register code string
        
            console.log(`CUL ${this.path} set AGCCTRL0=0x1D -> ${v} (${w} dB)`);
            await this.send(`W1F${v}`);
        }
    },

    //
    // ELRO / INTERTECHNO
    //

    'elro' : class Elro extends Device 
    {
        constructor(config) { 
            super(config);

            this.getter = this.getter.concat(['info', 'state']);
            this.setter = this.setter.concat(['state', 'flip']);

            this.code = config.code.trim().toUpperCase();
            this.#parseAddr(this.code);

            this.id = this.id ?? this.code.toLowerCase();
            
        }
        // Table per Intertechno (V1) mapping (tristate nibbles)
        TRI = [ "0000","F000","0F00","FF00",
                "00F0","F0F0","0FF0","FFF0",
                "000F","F00F","0F0F","FF0F",
                "00FF","F0FF","0FFF","FFFF" ];
    
        #parseAddr(addr) {
            const m = addr.match(/^([A-P])(1[0-6]|[1-9])$/);
            if (!m) 
                throw new Error("address must be A1..P16");
            return { house: m[1].charCodeAt(0) - 65,   // A=0..P=15
                     unit: parseInt(m[2], 10) - 1   }; // 1..16 -> 0..15
        }
        
        async set_state(enabled) {
            const { house, unit } = this.#parseAddr(this.code);
            const payload = this.TRI[house] + this.TRI[unit] + "0F" + (enabled ? "FF" : "F0");
            
            await Devices.find('cul', '433')
                         .send('is' + payload);
        }
    },

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
    }                
}

class Devices
{
    static devices = new Array();

    static init(config) {
        console.log ('Loading devices...');
        
        let err = false;

        for (const cfg of config) {
            if (cfg.type in drivers) {
                this.devices.push(new drivers[cfg.type](cfg));
            } else {
                console.error(`Config Error: Device ${cfg.id} has unknown device type ${cfg.type}.`);
                err = true;
            }
        }

        return err;
    }

    static all() {
        return this.devices;
    }

    static get(id) {
        return this.devices.find(d => d.id === id);
    } 

    static find(type, subtype) {
        return this.devices.find(d => d.type === type && d.subtype === subtype);
    } 

    static async start() {
        for (var device of this.all())
            device.setup();

        for (var device of this.all())
            device.start();
    }
}

module.exports = Devices;