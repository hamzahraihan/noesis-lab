import { BenchBuilder } from './src/sim/bench'
import { breadboardDefinition, columnX, railRowY, stripRowY } from './src/sim/breadboard'
import { esp32DevKitV1 } from './src/sim/boards'
import { ledDefinition, resistorDefinition } from './src/sim/passives'
import { DIODE_PROFILES } from './src/sim/elements'
import { Engine } from './src/sim/engine'
import { McuRuntime } from './src/sim/mcu'
import { FirmwareRunner } from './src/sim/firmware/interpreter'
import { measureFrequency } from './src/sim/probe'

const OX = 230, SIG = 20
const holeX = (c: number) => OX + columnX(c)
const holeY = (r: number) => stripRowY(r)
const link = (b: BenchBuilder, f: any, t: any) => b.addWire(f.x, f.y, t.x, t.y)

const b = new BenchBuilder()
const esp32 = b.addPart(esp32DevKitV1(), 0, 0)
b.addPart(breadboardDefinition(), OX, 0)
const pinAt = (id: string) => esp32.definition.pins.find(p => p.id === id)!
const railY = railRowY(2)
link(b, pinAt('R_D2'), { x: holeX(SIG), y: holeY(8) })
b.addPart(resistorDefinition(330), holeX(SIG), holeY(8) - 1.6)
b.addPart(ledDefinition(DIODE_PROFILES.red, 'Red'), holeX(SIG + 4), holeY(8) - 3)
link(b, { x: holeX(SIG + 5), y: holeY(8) }, { x: holeX(SIG + 5), y: railY })
link(b, pinAt('L_GND'), { x: holeX(10), y: railY })

const mcu = new McuRuntime(esp32.definition)
const engine = new Engine({ bench: b.build(), mcu })
engine.rebuild()
const net = engine.netOfMcuPin('R_D2')
engine.probes.watch(net)

const src = `void setup() { pinMode(2, OUTPUT); }
void loop() { digitalWrite(2, HIGH); delay(400); digitalWrite(2, LOW); delay(400); }`
const runner = new FirmwareRunner(src, {
  nowMs: () => engine.timeMs,
  pinMode: (p, mo) => { engine.settle(); mcu.setDirection(p, mo === 2 ? 'inputPullUp' : mo === 0 ? 'input' : 'output') },
  digitalWrite: (p, l) => { mcu.writeDigital(p, l !== 0, engine.timeMs); engine.settle() },
  digitalRead: () => 0, analogWrite: () => {}, analogRead: () => 0,
  serialBegin: () => {}, serialWrite: () => {},
  spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
  wire: { begin: () => {}, beginTransmission: () => {}, write: () => 1, endTransmission: () => 0 },
} as never)

let g = 0
while (engine.timeMs < 1500 && g++ < 100000) {
  const r = runner.step(); if (r === null) break
  const target = engine.timeMs + Math.min(r, 1500 - engine.timeMs)
  while (engine.timeMs < target) engine.step(0.002)
}
const s = engine.probes.waveform(net)!.toArray()
console.log('samples', s.length, 'span', (s[s.length-1].t - s[0].t).toFixed(1), 'freq', measureFrequency(s).toFixed(2))
console.log('first 30:', s.slice(0,30).map(x => x.v.toFixed(1)).join(' '))
