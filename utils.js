const SunCalc = require('./suncalc.js');
const Axios   = require('axios')
const config  = require('./config.json');

class Utils {

    static async get(host, path) {
        const url = `${host}${path}`;
        const response = await Axios.get(url).catch(e => (console.error(''+e)));
        if (response)
            return response.data;
    }

    static async post(host, path, json = {}) {
        const url = `${host}${path}`;
        const response = await Axios.post(url, json).catch(e => console.error(''+e));
        if (response) 
            return response.data;
    }

    static hexToRGB(str) {
        const parsed = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(str);
        if (!parsed)
            return null;

        const r = parseInt(parsed[1], 16);
        const g = parseInt(parsed[2], 16);
        const b = parseInt(parsed[3], 16);
        return [r,g,b];
    }

    // Assumes h, s, l are in [0,1] (but is tolerant) and
    // returns [r, g, b] as integers in [0,255].
    static hslToRgb(h, s, l) {
        // Normalize inputs
        h = ((h % 1) + 1) % 1;             // wrap hue to [0,1)
        s = Math.min(1, Math.max(0, s));   // clamp to [0,1]
        l = Math.min(1, Math.max(0, l));   // clamp to [0,1]
    
        function hueToRgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
        }
    
        let r, g, b;
    
        // Treat very low saturation as gray to avoid floating-point glitches
        if (s <= 1e-12) {
        r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hueToRgb(p, q, h + 1/3);
            g = hueToRgb(p, q, h);
            b = hueToRgb(p, q, h - 1/3);
        }
    
        // Convert to 0..255 integers and clamp
        const toByte = x => Math.min(255, Math.max(0, Math.round(x * 255)));
        return [toByte(r), toByte(g), toByte(b)];
    }

    static parseRGB(str) {
        const arr = str.split(/,/);
        if (arr.length == 3)
        {
            for (let i=0; i<3; i++)
                if (arr[i] < 0 || arr[i] > 255)
                    return null;

            return arr;
        }

        return null;
    }

    // parses something like "sunset" or "10:00"
    static parseTime(str) {

        if (!str || str.length == 0)
            return;

        str = str.replace(/\s/g, '');

        // sun state (words like "sunset")
        const times = SunCalc.getTimes(new Date(), config.app.loc.lat, config.app.loc.long);
        
        // TODO replace this with a more generic expression parser, try to use JS for that but don't just use eval()
        // parse simple time shift expressions
        for (let time in times) {
            if (str.startsWith(time)) {
                let dt = 0;
                if (str.includes('+')) {
                    dt = this.parseDuration(str.split('+')[1])
                } else if (str.includes('-')) {
                    dt = - this.parseDuration(str.split("-")[1])
                }
                return times[time].getTime() + dt;
            }
        }
        
        // time in hh:mm format
        if (str.match(/^\d{2}:\d{2}$/)) {
            const today = new Date().toISOString().split('T')[0];
            return Date.parse(today + "T" + str);
        }

        // epoch, in seconds
        if (str.match(/^\d+/)) {
            const ts = parseInt(str) * 1000;
            return ts;
        }

        // TODO more formats ?
    }

    // parses a human readable duration like 1m string into milliseconds
    static parseDuration(str) {
        str = str.replace(/\s/g, '');

        if (str !== undefined) {
            let val = parseInt(str);
            if (val >= 0) {
                switch (str.slice(-1)) {
                    case 'm' :          val *= 60;      break;
                    case 'h' : default: val *= 3600;    break;
                    case 'd' :          val *= 3600*24; break;
                }
                return val * 1000;
            }
        }
        return 0;
    }

    // find closest time (epoch seconds) in a list that is closest to given time, 
    // but not after now and return the item of the list with same index
    static findClosest(times, list, time)
    {
        let closest = 0; 
        for (let i=0; i<times.length; i++) {
            const t = times[i];
            if (t > time || t < times[closest]) continue;
            if (t > times[closest]) closest = i;
        }
        return list[closest];
    }

    static lerp(a, b, f)
    {
        return a * (1.0 - f) + (b * f);
    }

    // merge arrays of object b into arrays of object a and return a
    static merge(a, b) {
        for (const x in b) {
            if (!(x in a)) a[x] = b[x];
            else           a[x] = a[x].concat(b[x]);
        }

        return a;
    }

    // remove duplicates of complex objects by stringifying them
    static removeDuplicates(arr) {
        const uniqueArrays = new Set();
        
        return arr.filter(innerArr => {
            // Convert each inner array to a string for easy comparison
            const key = JSON.stringify(innerArr);
    
            // Check if this stringified array is already in the set
            if (uniqueArrays.has(key)) {
                return false; // Duplicate found, filter out this array
            } else {
                uniqueArrays.add(key); // Add to set and keep this array
                return true;
            }
        });
    }

    static map_range(value, input_start, input_end, output_start, output_end) {
        return (value - input_start) / (input_end - input_start) * (output_end - output_start) + output_start
    }

}

module.exports = Utils;