const { SerialPort } = require('serialport')

const port = new SerialPort({
    path: '/dev/ttyACM0',
    baudRate: 38400
  });
      
port.setEncoding('utf8');

port.on('readable', function () {
  let data = port.read();
  console.log('rx', data.trim())

  //      K5151525513
  //      K514952551B
  //      K514852551B
  //      K514852551A
  //      KaaTTHTHH
  //data = 'K5152525510';
  if (data[0] === 'K') {
      
    console.log(`data[1:2]=${data[1]}${data[2]}`)
      const firstbyte = parseInt(data[1], 16);
      const typbyte = parseInt(data[2], 16) & 7;
      const sfirstbyte = firstbyte & 7;
      console.log(`sfirstbyte=${sfirstbyte} typbyte=${typbyte}`)
      //if (sfirstbyte === 7 && typbyte === 1 && data.length > 8) {
        const sgn = (firstbyte & 8) ? -1 : 1;
        const t = sgn * parseFloat(`${data[6]}${data[3]}.${data[4]}`);
        const h = parseFloat(`${data[7]}${data[8]}.${data[5]}`);
        console.log(`[${Date.now()}] t=${t} h=${h}`);
      //}
    
    //console.log('S300TH id=%s tt=%s t=%s hh=%s h=%s', aa, tt, t, hh, h);

  } else if (data[0] === 'F') {
    let housecode = data.slice(1,5);
    let device = data.slice(6,7);
    let command = data.slice(8,9);
    let timespec = data.slice(10,11);
    console.log('FS20 id=%s btn=%s cmd=%s t=%s', housecode, device, command, timespec);
  }
});

// get version
port.write('V\n');

 
function setFreq(freqMhz) {

  const f = (freqMhz / 26) * 65536;
  const f2 = ((f / 65536) & 0xff).toString(16).padStart(2, "0");
  const f1 = (Math.floor(f % 65536 / 256) & 0xff).toString(16).padStart(2, "0");
  const f0 = (Math.floor(f % 256) & 0xff).toString(16).padStart(2, "0");

  const revcalc = (
    ((parseInt(f2, 16) * 65536 +
      parseInt(f1, 16) * 256 +
      parseInt(f0, 16)) /
      65536) *
    26
  ).toFixed(3);

  console.log(
    `Setting FREQ2..0 (0D,0E,0F) to ${f2} ${f1} ${f0} = ${revcalc} MHz`
  );

  port.write(`W0F${f2}\n`);
  port.write(`W10${f1}\n`);
  port.write(`W11${f0}\n`);
}

function setBandwith(argKhz) {
  let bits = 0, bw = 0;

  // CC1101 bandwidth is encoded in MDMCFG4 with exponent (e) and mantissa (m)
  // bits[7:6] = e (exponent), bits[5:4] = m (mantissa), bits[3:0] = other config
  // Formula: BW = 26MHz / (8 * (4 + m) * 2^e)

  for (let e = 0; e < 4; e++) {
    for (let m = 0; m < 4; m++) {
      const testBw = Math.floor(26000 / (8 * (4 + m) * (1 << e))); // KHz
      if (argKhz >= testBw) {
        bits = (e << 6) + (m << 4); // pack exponent and mantissa into bits
        bw = testBw;
        e = m = 4; // break both loops
      }
    }
  }

  // old register lower nibble would be preserved; here assume 0
  port.write('C10\n');
  port.read();
  const ob = 0x00;
  const newVal = ((ob & 0x0f) + bits).toString(16).padStart(2, "0");

  console.log(`MDMCFG4=0x${newVal} (${bw} KHz)`);
  //port.write(`W1F${v}\n`);
}


function setAmp(arg) {
  const amplList = [24, 27, 30, 33, 36, 38, 40, 42]; //rAmpl(dB)

  if (typeof arg !== "number" || arg < 24 || arg > 42) {
    throw new Error("Amp: value 24–42 expected");
  }

  // find index where amplList > arg, then use previous
  let v = 0;
  for (; v < amplList.length; v++) {
    if (amplList[v] > arg) break;
  }
  v = v - 1;
  const w = amplList[v];
  const regVal = v.toString().padStart(2, "0"); // two digits, like "05"

  console.log(`AGCCTRL2=0x1B -> ${regVal} (${w} dB)`);
  port.write(`W1D${regVal}\n`);
}

function setSens(arg) {
  if (typeof arg !== "number" || arg < 4 || arg > 16) {
    throw new Error("Sens: value 4–16 expected");
  }

  const w = Math.floor(arg / 4) * 4; // step 4
  const v = "9" + (arg / 4 - 1);     // register code string

  console.log(`AGCCTRL0=0x1D -> ${v} (${w} dB)`);
  port.write(`W1F${v}\n`);
}


function parseItAddr(address) {
  if (typeof address !== "string") throw new Error("address must be a string like 'A1'");
  const m = address.trim().toUpperCase().match(/^([A-P])(1[0-6]|[1-9])$/);
  if (!m) throw new Error("address must be A1..P16");
  return {
    house: m[1].charCodeAt(0) - 65,   // A=0..P=15
    unit: parseInt(m[2], 10) - 1      // 1..16 -> 0..15
  };
}

// Table per Intertechno (V1) mapping (tristate nibbles)
const TRI = [
  "0000","F000","0F00","FF00",
  "00F0","F0F0","0FF0","FFF0",
  "000F","F00F","0F0F","FF0F",
  "00FF","F0FF","0FFF","FFFF"
];

// address: string like "A1", "C12", "P16"
// state:   true/false
function setSwitch(address, state) {
  
  if (typeof address !== "string") 
    throw new Error("address must be a string like 'A1'");

  const m = address.trim().toUpperCase().match(/^([A-P])(1[0-6]|[1-9])$/);
  if (!m) 
    throw new Error("address must be A1..P16");

  const { houseIdx, unitIdx } = parseItAddr(address);
  const onOff = state ? "FF" : "F0";
  const payload = TRI[house] + TRI[unit] + "0F" + onOff; // [house][unit][fixed][cmd]
  port.write('is' + payload + '\n');
}

function dipsFor(address) {
  const { house, unit } = parseItAddr(address);
  const houseNibble = TRI[house];
  const unitNibble  = TRI[unit];

  // 10 DIP switches: 1–5 (house), A–E (unit). Fifth in each row is typically unused -> 0.
  const houseRow = houseNibble.padEnd(5, "0");
  const unitRow  = unitNibble.padEnd(5, "0");

  return '12345ABCDE\n' + houseRow + unitRow;
}

/*
setFreq(433.92);
//setFreq(868.3);
setSens(8);
//setBandwith(425)

// X09 tx strength 5-9
port.write('x09\n');
*/

console.log(dipsFor('A2'));
// X21 normal Modus
port.write('X21\n');
setSwitch('A1', false);
// 868.35 MHz
