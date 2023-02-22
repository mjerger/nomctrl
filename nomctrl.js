const Config   = require('./config.js');
const Devices  = require('./devices.js');
const Nodes    = require('./nodes.js');
const Timers   = require('./timers.js');
const Commands = require('./commands.js');

const express = require("express");
const app = express();


// STARTUP

app.listen(Config.app().port, function () {
    app.use(express.static('www'))

    console.log ("Loading config");

    let success = Config.validate();
    if (!success) process.exit(-1);

    Devices.load(Config.devices());
    Nodes.load(Config.nodes(), Config.groups());
    Timers.load(Config.timers());

    Devices.start();
    Timers.start();

    console.log(`nomctrl listening on port ${Config.app().port}!`);
});

// ROUTES

app.get("/", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/control.html", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/status", async (req, res) => {
    //TODO status page
    res.send(await Commands.execute("status"));
});

app.post("/cmd", async (req, res) => {
    res.send(await Commands.execute(req.body));
});

app.get("/cmd/:cmd", async (req, res) => {
    res.send(await Commands.execute(req.params.cmd));
});

app.post("/do", async (req, res) => {
    res.send(await Commands.execute(`do ${req.body}`));
 });

app.get("/do/:action", async (req, res) => {
    res.send(await Commands.execute(`do ${req.params.action}`));
 });

