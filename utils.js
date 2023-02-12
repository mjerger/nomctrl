const Axios = require('axios')

class Utils {

    static async get(host, path, json = {}) {
      let url = `http://${host}${path}`;
      
      let response = await Axios.get(url).catch(function (error) { console.log("GET Error: " + error) });
      if (response) return response.data;
    }

    static async post(host, path, json = {}) {
      let url = `http://${host}${path}`;
      let response = await Axios.post(url, json).catch(function (error) { console.log("POST Error: " + error) });
      if (response) return response.data;
    }

    static hexToRGB(hex) {
        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) {
            console.error(`Invalid hex color ${hex}`);
            return null;
        }

        let r = parseInt(result[1], 16);
        let g = parseInt(result[2], 16);
        let b = parseInt(result[3], 16);
        return [r,g,b];
    }
}

module.exports = Utils;