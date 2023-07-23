const SunCalc = require('./suncalc.js');
const Axios   = require('axios')
const config  = require('./config.json');

class Utils {

    static async get(host, path) {
        const url = `http://${host}${path}`;
        const response = await Axios.get(url).catch(e => console.error("GET: " + e));
        if (response)
            return response.data;
    }

    static async post(host, path, json = {}) {
        const url = `http://${host}${path}`;
        const response = await Axios.post(url, json).catch(e => console.error("POST: " + e));
        if (response) 
            return response.data;
    }

    static hexToRGB(str) {
        const parsed = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(str);
        if (!parsed) {
            return null;
        }

        const r = parseInt(parsed[1], 16);
        const g = parseInt(parsed[2], 16);
        const b = parseInt(parsed[3], 16);
        return [r,g,b];
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

        str = str.trim().replace(/\s/, '')

        // sun state (words like "sunset")
        const times = SunCalc.getTimes(new Date(), config.ctrl.loc.lat, config.ctrl.loc.long);
        
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
        if (str.match(/^\d{1,2}:\d{2}$/)) {
            const today = new Date().toISOString().split('T')[0];
            return Date.parse(today + "T" + str);
        }

        // epoch
        if (str.match(/^\d+/)) {
            const ts = parseInt(str);
            return ts;
        }

        // TODO more formats ?
    }

    static parseDuration(str) {
        if (str !== undefined) {
            const val = parseInt(str);
            if (val >= 0) {
                switch (str.slice(-1)) {
                    case 's' :          return val;
                    case 'm' :          return val * 60;
                    case 'h' : default: return val * 3600;
                    case 'd' :          return val * 3600*24;
                }
            }
        }
        return -1;
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

    static map_range(value, input_start, input_end, output_start, output_end) {
        return (value - input_start) / (input_end - input_start) * (output_end - output_start) + output_start
    }

}

module.exports = Utils;