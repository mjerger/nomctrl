const fs = require('node:fs');

const data = new Map();

let path;

function init(config) {
    console.log ('Loading storage...');

    path = config.storage;

    load();
}

function load() {
    try {
        const data = fs.readFileSync(path, 'utf8');
        const obj = JSON.parse(data);
        data = new Map(Object.entries(obj));
    } catch (err) {
        console.error(`Storage Error: Could not initialize storage from file ${path}\n${err}`);
    }
}

function store() {
    try {
        const obj = Object.fromEntries(data);
        const data = JSON.stringify(obj, null, 2);
        fs.writeFileSync(path, data, { flag: 'w+' });
    } catch (err) {
        console.error(`Storage Error: Could not write storage to file ${path}\n${err}`);
    }
}

function get(key, fallback=null) { 
    if (!data.has()) {
        set(key, fallback);
    }

    return data[key];
}

function set(key, value) {
    data.set(key, value);
    store();
}

module.exports = { init, store, get, set };