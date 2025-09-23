module.exports = {
    app: {
        port: 1337,
        
        timer_interval: 60,
        poll_interval: 60,

        setup_cul_on_connect: false
    },

    loc: { 
        lang: "en",
        country: "DE",
        city: "stuttgart",
        lat: "48.78",
        long: "9.18"
    },

    users: {
        nom: {
            ips: [ "" ]
        }
    },

    log: {
        influx: {
            host: "nompi",
            port: 8086,
            database: "nomctrl",
            username: "nomctrl",
            password: "nomctrl"
        },

        groups: {
            environment: [ "humidity", "temperature", "illumination", "illuminance", "occupancy", "co2", "formaldehyd", "voc" ],
            devices:     [ "battery", "battery_low", "linkquality", "zigbee.voltage", "tamper" ],
            inputs:      [ "action", "alarm", "contact", "water", "movement" ],
            energy:      [ "power", "power_status",  "energy", "energy_t", "energy_y", "tasmota.voltage", "current" ],
            switches:    [ "tasmota.state", "elro.state" ],
            lights:      [ "wled.state", "FIXME_brightness", "color" ]
        },

        ignore: {
            action: "1_min_inactivity"
        },

        log_unmapped: false
    },

    devices: {
        tasmota: [
            { host: "tasmota-s1" },
            { host: "tasmota-s2" },
            { host: "tasmota-s3" },
            { host: "tasmota-s4" },
            { host: "tasmota-s5" },
            { host: "tasmota-s6", enabled: false }
        ],
        
        wled: [
            { host: "wled-desk"     },
            { host: "wled-stuff"    },
            { host: "wled-tv"       },
            { host: "wled-bed-ceil" },
            { host: "wled-string-1" },
            { host: "wled-string-2" }
        ],

        nomframe: [
            { host: "nomframe", enabled: false }
        ],
        
        cul: [
            { path: "/dev/ttyACM0" },
            { path: "/dev/ttyACM1" }
        ],

        elro: [
            { id: "elro-a1", addr: "A1" },
            { id: "elro-a2", addr: "A2" },
            { id: "elro-a3", addr: "A3" }
        ],

        fs20: {
            fs20s4: [ 
                { id: "quadro-1", addr: "4FC5", dev: 0 },
                { id: "quadro-2", addr: "4FC5", dev: 1 },
                { id: "quadro-3", addr: "4FC5", dev: 2 },
                { id: "quadro-4", addr: "4FC5", dev: 3 } 
            ]
        },

        s300th: [
            { id: "env-balcony", addr: "0" },
            { id: "env-living",  addr: "1" },
            { id: "env-sleep",   addr: "2" }
        ],

        zigbee2mqtt: [
            { url: "mqtt://localhost:1883" }
        ],

        zigbee: [
            { id: "button-1",    map: { action: { toggle: "single", on: "double", off: "long" } } },
            { id: "button-2" },
            { id: "water-1" ,    map: { alarm_1: "action", action: { true: "wet", false: "dry" } } },
            { id: "water-2" ,    map: { alarm_1: "action", action: { true: "wet", false: "dry" } } },
            { id: "presence-1" },
            { id: "presence-2" },
            { id: "presence-3", log: false },
            { id: "temp-1" },
            { id: "temp-2" },
            { id: "air-1", log: false },
            { id: "contact-1",   map: { contact: "action", action: { true: "close", false: "open" } } },
            { id: "contact-2",   map: { contact: "action", action: { true: "close", false: "open" } } },
            { id: "vibration-1", map: { alarm_1: "action", action: { true: "move", false: "rest"  } } },
            { id: "cube" }
        ]
    },

    nodes: [
        { id: "amp"      , device: "tasmota-s1" },
        { id: "plants"   , device: "tasmota-s2" },
        { id: "terra"    , device: "tasmota-s3" },
        { id: "grow"     , device: "tasmota-s4" },
        { id: "growbox"  , device: "tasmota-s5" },
        { id: "fairy-1"  , device: "elro-a1", thresh: 80 },
        { id: "desk"         , device: "wled-desk"  },
        { id: "stuff-light"  , device: "wled-stuff" },
        { id: "tv-light"     , device: "wled-tv"    },
        { id: "bedroom-light", device: "wled-bed-ceil" },
        { id: "string-1"     , device: "wled-string-1" },
        { id: "string-2"     , device: "wled-string-2" }
    ],

    groups: [
        { id: "living"   , nodes: [ "desk", "amp", "plants", "terra", "stuff-light", "tv-light", "grow" ], groups: [ "xmas" ] },
        { id: "sleep"    , nodes: [ "bedroom-light", "growbox" ] },
        { id: "xmas"     , nodes: [ "string-1", "string-2", "fairy-1"] },
        { id: "all"      , groups: [ "living", "sleep"] }
    ],

    timers: [
        { id: "grow",    node: "grow",    on: "08:00",         off: "23:00", strict: true },
        { id: "growbox", node: "growbox", on: "11:00",         off: "23:00", strict: true },
        { id: "plants",  node: "plants",  on: "sunriseEnd+1h", off: "21:00", strict: true },
        { id: "terra",   node: "terra",   on: "sunriseEnd+1h", off: "22:00", strict: true }
    ],

    actions: [
        { id: "off"    ,                  do: "set all off" },
        { id: "morning", event: "10:00" , do: "set sleep morning 5%" },
        { id: "day"    , event: "12:00" , do: [ "set sleep off", "set living day 50%", "set nomframe 100%" ] },
        { id: "evening", event: "sunset", do: [ "set all evening", "set living 100%", "set sleep 25%", "set nomframe off"  ] },
        { id: "night"  , event: "22:00" , do: [ "set all night", "set living 50%", "set nomframe off", "set sleep 25%" ] },
        { id: "late"  ,                   do: [ "set all sun", "set living 50%", "set nomframe off", "set sleep 25%" ] },
        
        { event: "button-1.action.single",   do: "set sleep toggle" },
        { event: "button-1.action.double",   do: "set sleep morning 10%" },
        { event: "button-1.action.long",     do: "set all off"    },

        { event: "button-2.action.single",   do: "do evening"     },
        { event: "button-2.action.double",   do: "set all off"    },
        { event: "button-2.action.long",     do: "set amp toggle" },

        { event: "quadro-1.action.single", do: "set living on" },
        { event: "quadro-1.action.long", do: "set living off" },
        { event: "quadro-2.action.single", do: "set living 100" },
        { event: "quadro-2.action.long", do: "set living 20" },
        { event: "quadro-3.action.single", do: "set amp on" },
        { event: "quadro-3.action.long", do: "set amp off" },

        { event: "cube.action.shake", do: "set all random-color"}
    ],

    colors: [
        { id: "lime"   , hex: "#deff24" },
        { id: "blue"   , hex: "#656ef2" },
        { id: "green"  , hex: "#00f010" },
        { id: "orange" , hex: "#f29a1f" },
        { id: "dorange", hex: "#d26a00" },
        { id: "sun"    , hex: "#f6cb90" },
        { id: "morning", color: "sun"   },
        { id: "day"    , color: "sun"     },
        { id: "evening", color: "orange"  },
        { id: "night"  , color: "dorange" }
    ]

}
