/**
 * Every circuit the curriculum and the gallery ship, as documents.
 *
 * One file per circuit, named after the exercise or project it belongs to, and
 * every one of them entering through `parseCircuit`: a broken document throws
 * here, at import, naming the circuit — an educator editing these files finds
 * out immediately rather than when a bench quietly comes up half wired.
 *
 * The documents are what the canvas writes on save (`decompile`), so a file
 * here is the same text a share link carries and a submission will arrive as.
 * The imperative `setup` builders they replaced are gone; nothing keeps two
 * representations of one circuit in step.
 */

import type { CircuitDocument } from '@/features/simulation';
import { parseCircuit } from '@/features/simulation';

import circuit01 from './0.1.json';
import circuit11 from './1.1.json';
import circuit12 from './1.2.json';
import circuit21 from './2.1.json';
import circuit22 from './2.2.json';
import circuit31 from './3.1.json';
import circuit32 from './3.2.json';
import circuit41 from './4.1.json';
import circuit42 from './4.2.json';
import circuit51 from './5.1.json';
import circuit52 from './5.2.json';
import alarmClock from './alarm-clock.json';
import dashboard from './dashboard.json';
import esp32Tft from './esp32-tft.json';
import instrumentBench from './instrument-bench.json';
import max7219 from './max7219.json';
import nokia5110 from './nokia-5110.json';
import parking from './parking.json';
import reaction from './reaction.json';
import safe from './safe.json';
import shiftRegister from './shift-register.json';
import soilProbe from './soil-probe.json';
import weather from './weather.json';

/** The exercise or project id a document belongs to. */
export type CircuitId =
  | '0.1'
  | '1.1'
  | '1.2'
  | '2.1'
  | '2.2'
  | '3.1'
  | '3.2'
  | '4.1'
  | '4.2'
  | '5.1'
  | '5.2'
  | 'alarm-clock'
  | 'dashboard'
  | 'esp32-tft'
  | 'instrument-bench'
  | 'max7219'
  | 'nokia-5110'
  | 'parking'
  | 'reaction'
  | 'safe'
  | 'shift-register'
  | 'soil-probe'
  | 'weather';

export const CIRCUITS: Readonly<Record<CircuitId, CircuitDocument>> = {
  '0.1': parseCircuit(circuit01, '0.1'),
  '1.1': parseCircuit(circuit11, '1.1'),
  '1.2': parseCircuit(circuit12, '1.2'),
  '2.1': parseCircuit(circuit21, '2.1'),
  '2.2': parseCircuit(circuit22, '2.2'),
  '3.1': parseCircuit(circuit31, '3.1'),
  '3.2': parseCircuit(circuit32, '3.2'),
  '4.1': parseCircuit(circuit41, '4.1'),
  '4.2': parseCircuit(circuit42, '4.2'),
  '5.1': parseCircuit(circuit51, '5.1'),
  '5.2': parseCircuit(circuit52, '5.2'),
  'alarm-clock': parseCircuit(alarmClock, 'alarm-clock'),
  dashboard: parseCircuit(dashboard, 'dashboard'),
  'esp32-tft': parseCircuit(esp32Tft, 'esp32-tft'),
  'instrument-bench': parseCircuit(instrumentBench, 'instrument-bench'),
  max7219: parseCircuit(max7219, 'max7219'),
  'nokia-5110': parseCircuit(nokia5110, 'nokia-5110'),
  parking: parseCircuit(parking, 'parking'),
  reaction: parseCircuit(reaction, 'reaction'),
  safe: parseCircuit(safe, 'safe'),
  'shift-register': parseCircuit(shiftRegister, 'shift-register'),
  'soil-probe': parseCircuit(soilProbe, 'soil-probe'),
  weather: parseCircuit(weather, 'weather'),
};
