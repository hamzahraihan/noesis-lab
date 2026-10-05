
import { Simulation } from './src/ui/simulation';
import { esp32DevKitV1 } from './src/sim/boards';
import { breadboardDefinition } from './src/sim/breadboard';

const s = new Simulation(esp32DevKitV1());
s.addPart(breadboardDefinition(), 230, 0);
s.routeWire({ id: -1, x: 20, y: 20 }, { id: -1, x: 60, y: 20 });
const before = JSON.stringify(s.bench);
const id = s.bench.wires[0].id;
s.removeWire(id);
s.undo();
s.redo();
const after = JSON.stringify(s.bench);
console.log('equal', before === after, before.length, after.length);
if (before !== after) {
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) {
      console.log('first diff at', i);
      console.log('before:', before.slice(Math.max(0,i-160), i+160));
      console.log('after :', after.slice(Math.max(0,i-160), i+160));
      break;
    }
  }
}
