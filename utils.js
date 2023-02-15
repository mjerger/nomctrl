const Axios = require('axios')

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
}

module.exports = Utils;