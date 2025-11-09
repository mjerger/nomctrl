const fs = require('node:fs');

class Storage
{
    static data = new Map();

    static path;

    static init(config) {
        console.log ('Loading storage...');

        this.path = config.storage;

        this.load();
    }

    static load() {
        try {
            const data = fs.readFileSync(this.path, 'utf8');
            const obj = JSON.parse(data);
            this.data = new Map(Object.entries(obj));
          } catch (err) {
            console.error(`Storage Error: Could not initialize storage from file ${this.path}\n${err}`);
          }
    }

    static store() {
        try {
            const obj = Object.fromEntries(this.data);
            const data = JSON.stringify(obj, null, 2);
            fs.writeFileSync(this.path, data, { flag: 'w+' });
          } catch (err) {
            console.error(`Storage Error: Could not write storage to file ${this.path}\n${err}`);
          }
    }

    static get(key, fallback=null) { 
        if (!this.data.has()) {
            this.set(key, fallback);
        }

        return this.data[key];
    }

    static set(key, value) {
        this.data.set(key, value);
        this.store();
    }
}

module.exports = Storage;