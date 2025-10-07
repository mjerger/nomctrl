const Config = require('./config.js');
const Utils  = require('./utils.js');
const Events = require('./events.js');
const Logger = require('./logger.js');

const { SerialPort } = require('serialport')
const fs = require('fs');
const mqtt = require('mqtt');

class Device 
{
    setter = [];
    getter = ['online', 'last_seen'];
    
    has_set(attr)   { return this.setter.includes(attr); }
    has_get(attr)   { return this.getter.includes(attr); }
    add_setter(arr) { this.setter = this.setter.concat(arr); }
    add_getter(arr) { this.getter = this.getter.concat(arr); }

    static subtypes = [];

    online = true;
    last_seen = 0;
    data = new Map();
    subtype;

    constructor(config) { 
        this.id   = config.id;
        this.type = config.type;
        this.addr = config.addr;
        this.map  = config.map;
        this.log  = config.log ?? true;
        this.setter = config.setter ?? [];
    }

    is_online() { 
        return this.online;
    }

    set_online(online) {
        if (this.online != online) {
            this.online = online;
            console.log (`Device: ${this.id} ${online ? 'online' : `offline [${this.host ?? this.path ?? this.addr}]`}`)
        }

        if(online)
            this.update_last_seen();
    }

    update_last_seen() {
        this.last_seen = +Date.now();
    }

    get_online() {
        return this.online;
    }

    get_last_seen() {
        return this.last_seen;
    }

    async get(attr) {
        try {
            return this['get_' + attr]().then((val) => this.update_data(attr, val));
        } catch (e) {
            console.error(`Device Error: ${this.id} get ${attr}\n${e}`);
        }
    }

    async set(attr, val) {
        try {
            return this['set_' + attr](val).then(() => this.update_data(attr, val));
        } catch (e) {
            console.error(`Device Error: ${this.id} set ${attr}`);
        }
    }

    map_attrs(attr, value) {
        if (this.map) {
            const keys = Object.keys(this.map);

            // 1. remap attribute names first
            for (const k of keys) {
                if (k == attr) {
                    const v = this.map[k];
                    if (typeof v === 'string') 
                        attr = v;
                }
            }

            // 2. remap values 
            for (const k of keys) {
                if (k == attr) {
                    const v = this.map[k];
                    if (typeof v === 'object') {
                        const vkeys = Object.keys(v);
                        for (const vkey of vkeys) {
                            if (String(value) == vkey) { // note: allow compare of 'true'
                                value = v[vkey];
                            }
                        }
                    }
                }
            }
        }
        return { attr: attr, val: value };
    }

    unmap_attrs(attr, value) {
        if (this.map) {
            const keys = Object.keys(this.map);

            // 1. unmap attribute names first
            for (const k of keys) {
                const v = this.map[k];
                if (typeof v === 'string') {
                    if (v == attr) {
                        attr = k;
                    }
                }
            }

            // 2. unmap values 
            // TODO when needed, i'm lazy
        }
        return { attr: attr, val: value };
    }

    update_data(attr, val) {
        const mapped = this.map_attrs(attr, val);

        this.data[mapped.attr] = mapped.val;

        this.update_last_seen();

        this.last_log = Date.now();

        Logger.log(this, mapped.attr, mapped.val);

        return mapped;
    }
}

class HttpDevice extends Device 
{
    ping_path = '/'

    constructor(config) { 
        super(config);
        this.id = this.id ?? config.host;
        this.host = 'http://' + config.host; 
    }

    start() {
        setTimeout(this.check_online.bind(this), 100);
    }

    async check_online() {
        if (this.ping) this.ping();
        setTimeout(this.check_online.bind(this), Config.app().poll_interval * 1000);
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
}

class SerialDevice extends Device 
{
    constructor(config) { 
        super(config);
        this.id = this.id ?? config.path;
        this.path = config.path; 
        this.serial = undefined;
    }

    write(buf) {
        return new Promise((res, rej) => {
            this.serial.write(buf, err => err ? rej(err) : this.serial.drain(err2 => err2 ? rej(err2) : res()));
        });
    }

    async send(buf) {
        await this.write(buf+'\n')
                  .catch((error) => { console.log('Error writing to serial port ' + this.path); })
                  .then();
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
 
    async ping() {
        return this.serial !== undefined && this.serial.isOpen;
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
            this.id='cul-?'
            this.online = false;
            this.frequency = undefined;
            this.path = config.path;
            
        }

        start() {
            setTimeout(this.check_device.bind(this), 100);
        }
    
        check_device() {
            if (!this.is_online())
                this.setup();

            setTimeout(this.check_device.bind(this), 1000);
        }
    
        async setup() {

            // test if path exists first
            if (!fs.existsSync(this.path))
                return;

            let serial = new SerialPort({
                path: this.path,
                baudRate: 38400,
                autoOpen: false
            });

            this.serial = serial
            serial.setEncoding('ascii');
            serial.on('disconnect', () => { this.set_online(false); });
            serial.on('close',      () => { this.set_online(false); });
            serial.on('error', console.log);

            const on_version_response = () => {
                let v = serial.read();

                switch(true) {
                    case /CUL868/.test(v): this.subtype='868'; this.freq=868.35; this.id='cul-868'; break;
                    case /CUL433/.test(v): this.subtype='433'; this.freq=433.93; this.id='cul-433'; break;
                    default: 
                        console.warn(`Device ${this.path} is not a CUL`);
                        return;
                }

                console.log(`Found CUL${this.subtype} at ${this.path}`);

                // (re)config the stick
                // Note: writes to eeprom, no need to do it everytime
                if (Config.app().setup_cul_on_connect) {

                    // set frequency 
                    this.set_freq(this.freq);

                    // 8dB gain
                    this.set_sens(8);

                    // tx power
                    serial.write('x09\n');
                }

                // start normal mode
                serial.write('X21\n'); 
                
                serial.off('readable', on_version_response);
                serial.on('readable', this.receive);

                this.set_online(true);
            }

            serial.open((err) => {
                if (!err) {
                    serial.on('readable', on_version_response);

                    // get version
                    serial.write('V\n');
                    serial.drain();
                }
            });
        }

        receive() {
            let data = this.read();
            if (!data) {
                console.log(`cul rx ${data}`);
                return;
            }

            data = data.trim()
            console.log(`cul rx ${data.trim()}`);

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

                let device = Devices.find('s300th', id);
                if (device) {
                    device.message(t, h);
                    console.log(`S300TH rx id=${id} temp=${t}°C humid=${h}%`);
                } else {
                    console.warn(`S300TH rx unknown device address ${id}`);
                }
                
            // FS20
            } else if (data[0] === 'F') {

                let code = data.slice(1,5);
                let id = data.slice(6,7);
                let cmd = data.slice(8,9);
                
                let device = Devices.find('fs20', code, id);
                if (device) {
                    device.message(cmd);
                    console.log(`FS20 rx hcode=${code} dev=${id} cmd=${cmd}`);
                } else {
                    console.warn(`FS20 rx unknown device addr=${code} dev=${id}`);
                }
            
            // EM1000
            } else if (data[0] === 'E') {                                
                // device code
                const code = parseInt(data.slice(3, 5), 16);     

                let device = Devices.find('em1000', code);
                if (device) {
                    device.message(data);
                    console.log(`EM1000 rx code=${code}`);
                } else {
                    console.warn(`EM1000 rx unknown device addr=${code}`);
                }
            }
        }

        // set frontend frequency
        async set_freq(freq_mhz) {

            const f  = (freq_mhz / 26) * 65536;
            const f2 = ((f / 65536) & 0xff).toString(16).padStart(2, '0');
            const f1 = (Math.floor(f % 65536 / 256) & 0xff).toString(16).padStart(2, '0');
            const f0 = (Math.floor(f % 256) & 0xff).toString(16).padStart(2, '0');
        
            const revcalc = (
            ((parseInt(f2, 16) * 65536 +
                parseInt(f1, 16) * 256 +
                parseInt(f0, 16)) /
                65536) * 26
            ).toFixed(3);
        
            console.log(`CUL ${this.path} set FREQ2..0 (0D,0E,0F) to ${f2} ${f1} ${f0} = ${revcalc} MHz`);
        
            this.send(`W0F${f2}\nW10${f1}\nW11${f0}`);
        }

        // set frontend sens threshold in dB
        async set_sens(db) {
            if (typeof db !== 'number' || db < 4 || db > 16)
                throw new Error('Sensitivity: value 4–16 expected');
        
            const w = Math.floor(db / 4) * 4; // step 4
            const v = '9' + (db / 4 - 1);     // register code string
        
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

            this.add_getter(['info', 'state']);
            this.add_setter(['state', 'flip']);

            this.addr = config.addr.trim().toUpperCase();
            this.parse_addr(this.addr);

            this.id = this.id ?? this.addr.toLowerCase();
        }

        // Table per Intertechno (V1) mapping (tristate nibbles)
        TRI = [ '0000','F000','0F00','FF00',
                '00F0','F0F0','0FF0','FFF0',
                '000F','F00F','0F0F','FF0F',
                '00FF','F0FF','0FFF','FFFF' ];
    
        parse_addr(addr) {
            const m = addr.match(/^([A-P])(1[0-6]|[1-9])$/);
            if (!m) 
                throw new Error('address must be A1..P16');
            return { house: m[1].charCodeAt(0) - 65,   // A=0..P=15
                     unit: parseInt(m[2], 10) - 1   }; // 1..16 -> 0..15
        }
        
        async set_state(enabled) {
            const { house, unit } = this.parse_addr(this.addr);
            const payload = this.TRI[house] + this.TRI[unit] + '0F' + (enabled ? 'FF' : 'F0');
            
            const device = Devices.get_subtype('cul', '433');
            if (device && device.is_online())
                await device.send('is' + payload);
            else
                console.error('Cannot send: no CUL433 device available');
        }

        // return info on how to set the dip switches :)
        async get_info() {
            const { house, unit } = this.parse_addr(this.addr);
            const houseNibble = this.TRI[house];
            const unitNibble  = this.TRI[unit];
            
            // 10 DIP switches: 1–5 (house), A–E (unit). 
            // Fifth in each row is typically unused -> 0.
            const houseRow = houseNibble.padEnd(5, '0');
            const unitRow  = unitNibble.padEnd(5, '0');
            
            return '\n12345ABCDE\n' + houseRow + unitRow;
        }

        async get_state () {}

    },

    //
    // FS20
    //

    'fs20' : class FS20 extends Device 
    {
        static subtypes = ['fs20s4']; 

        constructor(config) { 
            super(config);
            this.subtype = config.subtype;
            this.dev = config.dev;

            this.add_getter(['info']);

            if (this.subtype === FS20.subtypes[0]) {
                this.add_getter('action');
            }
        }

        message (command) {

            // different behavior for each subtype
            if (this.subtype === FS20.subtypes[0]) {
                let val;
                if (command == 2)
                    val = 'single';
                else if (command == 5)
                    val = 'long';
                else return;

                let attr = 'action';

                const mapped = this.update_data(attr, val);
                attr = mapped.attr;
                val = mapped.val;
                
                Events.message(this, attr, val);
            }
        }

        async get(attr) { return this.data.get(attr); }
    },

    //
    // S3000TH
    //

    's300th' : class S300TH extends Device 
    {
        constructor(config) { 
            super(config);
            this.add_getter(['info', 'temperature', 'humidity']);
        }

        message(temp, humid) {
            this.update_data('temperature', temp);
            this.update_data('humidity', humid);

            Events.message(this, 'temperature', temp);
            Events.message(this, 'humidity', humid);
        }
        // TODO fix getters
    },

    //
    // ELV EM1000
    //

    em1000 : class EM1000 extends Device 
    {
        constructor(config) { 
            super(config);
            this.add_getter(['info', 'power', 'energy', 'energy_t', 'energy_y']);

            this.kwhPerRev = 1.0 / config.revolutions;

            // Convert device “counts” into real units:
            // - current_cnt is average rev per 5 minutes -> kW = rev * (kWh/rev) / (5/60 h)
            //   => corr1 = 12 * kWh/rev
            // - total_cnt is cumulative rev               -> kWh = rev * (kWh/rev)
            this.corr1 = 12 * this.kwhPerRev; // kW per (rev/5min)
            this.corr2 = this.kwhPerRev;      // kWh per rev
            this.maxPeakKW = config.maxPeakKW ?? 6;
        
            this._basisCnt = 0;      // wraparound correction (in rev)
            this._lastTotalCnt = 0;  // last raw total_cnt to detect wrap
        }

        message(raw) {
            //  frame like: "E01010C02011500890038"
            if (!/^E[0-9A-F]+$/.test(raw) || raw.length < 19) {
                console.error('received invalid EM1000 data frame');
                return;
            }

            const a = raw.split(""); // nibble-wise like the FHEM parser
            
            // Header
            const type = Number(a[1] + a[2]);            // e.g., "01" -> 1 (decimal)
            const code = parseInt(a[3] + a[4], 16);      // device code
            const seq  = parseInt(a[5] + a[6], 16);      // sequence #

            // TODO could check sequence number here

            // 16-bit values (little-endian on nibble pairs like in FHEM)
            let total_cnt   = parseInt(a[9]  + a[10] + a[7]  + a[8] , 16); // cumulative revolutions
            let current_cnt = parseInt(a[13] + a[14] + a[11] + a[12], 16); // avg rev/5min
            let peak_cnt    = parseInt(a[17] + a[18] + a[15] + a[16], 16); // ds/rev (if type!=2)
            // Optional checksum/extra trailing nibbles exist on some raws; ignored.

            // Wraparound handling (mirrors FHEM)
            if (total_cnt < this._lastTotalCnt) {
                this._basisCnt += (this._lastTotalCnt > 65000 ? 65536 : this._lastTotalCnt);
            }
            
            this._lastTotalCnt = total_cnt;

            const total_rev = this._basisCnt + total_cnt;

            // Power/energy calculations
            const current_kW = current_cnt * this.corr1;

            // For type!=2, peak_cnt is deciseconds per revolution.
            // pulses per 5min = 300 seconds = 3000 deciseconds; kW = (3000/peak_cnt) * corr1
            let peak_kW;
            if (type !== 2) {
                peak_kW = (current_cnt && peak_cnt) ? (3000 / peak_cnt) * this.corr1 : 0;

                // Glitch filter like FHEM's maxPeak: drop one spurious rev and adjust basis
                if (this.maxPeakKW != null && peak_kW > this.maxPeakKW) {
                    current_cnt = Math.max(0, current_cnt - 1);
                    this._basisCnt = Math.max(0, this._basisCnt - 1); // keep total stable
                    peak_kW = current_cnt * this.corr1;

                    // Keep a reasonable derived peak_cnt (best-effort)
                    peak_cnt = peak_kW ? Math.floor((3000 * this.corr1) / peak_kW) : 0;
                }
            } else {
                // For type==2 devices FHEM treats peak_cnt already like “rev/5min”
                peak_kW = peak_cnt * this.corr1;
            }

            const total_kWh = total_rev * this.corr2;

            console.log(`>>>> total_rev=${total_rev} current_kW=${current_kW} peak_kW=${peak_kW} total_kWh=${total_kWh}`)

            // power in watts
            const power = current_kW * 1000.0;

            // TODO energy-per-day
            // energy in kWh
            const energy_t = total_kWh;

            this.update_data('power', power);
            this.update_data('energy_t', energy_t);
            Events.message(this, 'power', power);
            Events.message(this, 'energy_t', energy_t);
        }
    },

    //
    // MQTT Bridge 
    //

    'mqtt' : class Mqtt extends Device
    {
        constructor(config) { 
            super(config);
            this.id = this.id ?? config.url;
            this.url = config.url;
            this.pwd = config.pwd;
            this.usr = config.usr;
        }

        publish(topic, message) {

            // coerce value type
            if (typeof message === 'object') 
            {
                try {
                    message = JSON.stringify(message);
                } catch {ou
                    message = String(message);
                }
            } 
            else if (typeof message !== 'number' &&
                     typeof message !== 'boolean' &&
                     typeof message !== 'string')
            {
                message = String(message);
            }

            this.client.publish(topic, message);
        }

        start() {
            const creds = (this.pwd || this.usr) ? { password : this.pwd, username: this.usr } : {};
            this.client = mqtt.connect(this.url, creds);
            this.client.on('connect', () => {
                console.log('MQTT connected', this.url);
            
                this.client.subscribe(
                    ['zigbee2mqtt/bridge/devices', 'zigbee2mqtt/#', 'airgradient/#'],
                    (err) => err && console.error('MQTT subscribe error:', err)
                );
            });

            this.client.on('message', (topic, message) => {

                const parts = topic.split('/');
                
                // zigbee
                if (parts[0] == 'zigbee2mqtt') {

                    if (parts.length < 2)
                        return;
                
                    const id = parts[1];

                    // TODO do sth with this info?
                    if (id == 'bridge') {
                        return;
                    }

                    try {
                        let data = JSON.parse(message.toString());
                    
                        let device = Devices.find('zigbee', addr);
                        if (device) {
                            const entries = Object.entries(data);
                            for (let [attr, val] of entries)
                                device.message(attr, val);
                        } else 
                        {
                            console.warn(`zigbee: unknown device address ${addr}`);
                        }

                        if (device?.log ?? true)
                            console.log(`zigbee rx ${addr}:`, JSON.stringify(data));
                    } catch {
                        // ignore silently
                    }
                }
                // AirGradient
                else if (parts[0] == 'airgradient') {

                    if (parts.length < 3)
                        return;

                    if (parts[1] === 'readings') {
                        const id = parts[2];
                        try {
                            let data = JSON.parse(message.toString());
                        
                            let device = Devices.find('airgradient', addr);
                            if (device) {
                                const entries = Object.entries(data);
                                for (let [attr, val] of entries)
                                    device.message(attr, val);
                            } else 
                            {
                                console.warn(`airgradient: unknown device address ${addr}`);
                            }
    
                            if (device?.log ?? true)
                                console.log(`airgradient rx ${addr}:`, JSON.stringify(data));
                        } catch {
                            console.error(`received invalid json from airgradient device`);
                        }
                    }
                }
              });
        }
    },


    //
    // ZIGBEE via zigbee2mqtt
    //

    'zigbee' : class Zigbee extends Device
    {
        constructor(config) { 
            super(config);
            this.add_getter(['info', 'battery', 'linkquality']);
            this.addr = this.addr ?? this.id;
        }

        message(attr, value) {
            
            const mapped = this.update_data(attr, value);
            attr = mapped.attr;
            value = mapped.val;

            Events.message(this, attr, value);

            this.update_last_seen();

            // allow any value from zigbee device
            if (!this.getter.includes(attr))
                this.getter.push(attr);
        }

        async get(attr) { return this.data.get(attr); }

        async set(attr, val) {
            let mqtt = Devices.find('mqtt')
            if (mqtt) {

                const unmapped = this.unmap_attrs(attr, val);
                attr = unmapped.attr;
                val = unmapped.val;
    
                // TODO need to translate values somehow, also should know about the type?
                if (attr.startsWith('state')) {
                    val = val ? "ON" : "OFF";
                }

                mqtt.publish(`zigbee2mqtt/${this.addr}/set`, { [attr]: val } );
            } else {
                console.error(`Device Error: ${this.addr} has no available mqtt bridge`);
            }
        }

    },

    //
    // AIR GRADIENT via mqtt
    //

    'airgradient' : class AirGradient extends Device
    {
        constructor(config) { 
            super(config);
            this.addr = this.addr ?? this.id;
            this.add_getter(['info']);

            // map
            this.map = { 
                atmp: 'temperature', 
                rhum: 'humidity',
                rco2: 'co2',
                tvocIndex: 'voc',   // Sensirion VOC Index
                noxIndex: 'nox',    // Sensirion NOx Index
            }
        }

        message(attr, value) {
            
            const mapped = this.update_data(attr, value);
            attr = mapped.attr;
            value = mapped.val;

            Events.message(this, attr, value);

            this.update_last_seen();

            // allow any value from zigbee device
            if (!this.getter.includes(attr))
                this.getter.push(attr);
        }

        async get(attr) { return this.data.get(attr); }
    },

    //
    // TASMOTA
    //

    'tasmota' : class Tasmota extends HttpDevice 
    {
        constructor(config) { 
            super(config);
            this.add_getter(['info', 'state', 'power', 'power_status',  'energy', 'energy_t', 'energy_y', 'voltage', 'current']);
            this.add_setter(['state', 'flip']);
            this.ping_path = '/cm'
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
            this.add_getter(['info', 'state', 'color', 'brightness']);
            this.add_setter(['state', 'flip', 'color', 'brightness', 'effect']);
            this.ping_path = '/json/state'
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
                case 'solid': return { fx : 0 }
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
    // nomraw
    //

    'nomraw' : class NomFrame extends HttpDevice 
    {
        constructor(config) { 
            super(config);
            this.add_setter(['state', 'flip', 'brightness']);
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

        const types = Object.keys(config);
        for (const type of types) {
            if (type in drivers && typeof config[type] === 'object') {
                if (Array.isArray(config[type])) {
                    for (const cfg of config[type]) {
                        if (cfg.enabled === false) continue;
                        cfg.type = type;
                        this.devices.push(new drivers[type](cfg));
                    }
                } else  {
                    const subtypes = Object.keys(config[type]);
                    for (const subtype of subtypes) {
                        const array = config[type][subtype]
                        if (drivers[type].subtypes.includes(subtype) && Array.isArray(array)) 
                        {
                            for (const cfg of array) {
                                if (cfg.enabled === false) continue;
                                cfg.type = type;
                                cfg.subtype = subtype
                                this.devices.push(new drivers[type](cfg));
                            }
                        } else {
                            console.error(`Config Error: Unknown device subtype ${subtype}.`);
                        }
                    }
                }
            } else {
                console.error(`Config Error: Unknown device type ${type}.`);
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

    static get_subtype(type, subtype) {
        return this.devices.find(d => d.type === type && d.subtype === subtype);
    }

    // find device of type, returns first
    static find(type) {
        return this.devices.find(d => d.type == type);
    } 

    // find device of type with address
    static find(type, addr) {
        return this.devices.find(d => d.type == type && d.addr == addr);
    } 

    // find device of type with address and internal device id
    static find(type, addr, dev) {
        return this.devices.find(d => d.type == type && 
                                      d.addr == addr && 
                                      d.dev  == dev);
    } 

    static async start() {
        for (var device of this.all())
            if (device.start) 
                await device.start();
    }
}

module.exports = Devices;