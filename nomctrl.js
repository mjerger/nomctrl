const Config  = require('./config.js');
const Timers  = require('./timers.js');
const Commands  = require('./commands.js');

const timers  = new Timers();

const express = require("express");
const app = express();

// ROUTES

app.listen(Config.app().port, function () {
    timers.start();
    console.log(`nomctrl listening on port ${Config.app().port}!`);
});

app.get("/", async (req, res) => {
    res.send("nomctrl up");
});

app.get("/status", async (req, res) => {
    res.send(await Commands.execute("status"));
});

app.get("/status/:args", async (req, res) => {
    res.send(await Commands.execute(`status ${req.params.args}`));
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

