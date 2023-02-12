const http = require('http');

class Utils {

    static post(host, path, json = {}) {
        // TODO async await thingy
        return "Not Implemented";
    }

    static postAsync(host, path, json = {}) {
        const https = require("https");
/*
        const options = {
          hostname: 'yourapi.com',
          port: 443,
          path: '/todos',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        }
        
        https
          .request(options, resp => {
            // log the data
            resp.on("data", d => {
              process.stdout.write(d);
            });
          })
          .on("error", err => {
            console.log("Error: " + err.message);
          });

        const options = {
            hostname: 'www.google.com',
            port: 80,
            path: '/upload',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
          };
*/
       // http.post(url).on("error", (err) => { console.log("postAsync Error: " + err.message);});
    }

    static get(host, path) {
        let url = `http://${host}${path}`;
        // TODO async await thingy
        return "Not Implemented";
    }

    static getAsync(host, path) {
        let url = `http://${host}${path}`;
        http.get(url).on("error", (err) => { console.log("getAsync Error: " + err.message);});
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