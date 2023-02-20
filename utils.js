const SunCalc = require('./suncalc.js');
const Axios   = require('axios')
const config  = require('./config.json');

class Utils {

    static async get(host, path, json = {}) {
      let url = `http://${host}${path}`;
      return Axios.get(url).catch(e => console.error("GET: " + e)).then(r => (r ? r.data : "") );
    }

    static async post(host, path, json = {}) {
      let url = `http://${host}${path}`;
      let response = Axios.post(url, json).catch(e => console.error("POST: " + e));
      if (response) return response.data;
    }

    static hexToRGB(hex) {
        let parsed = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!parsed) {
          console.error(`Invalid hex color ${hex}`);
            return null;
        }

        let r = parseInt(parsed[1], 16);
        let g = parseInt(parsed[2], 16);
        let b = parseInt(parsed[3], 16);
        return [r,g,b];
    }

    // parses something like "sunset" or "10:00"
    static parseTime(string) {

      // environment (things like "sunset")
      let times = SunCalc.getTimes(new Date(), config.ctrl.loc.lat, config.ctrl.loc.long);
      if (string in times) {
        return times[string].getTime();
      }
      
      // time
      if (string.match(/^\d{1,2}:\d{2}$/)) {
        let today = new Date().toISOString().split('T')[0];
        return Date.parse(today + "T" + string);
      }
    }

    // find closest time (epoch seconds) in a list that is closest to given time, 
    // but not after now and return the item of the list with same index
    static findClosest(times, list, time)
    {
        let closest = times.length-1; // start with the last one so we behave correctly over midnight
        for (let i=0; i<times.length; i++) {
            let t = times[i];
            if (t > time || t < times[closest]) continue;
            if (t > times[closest]) closest = i;
        }
        return list[closest];
    }
}

module.exports = Utils;