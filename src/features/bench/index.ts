// Public seam for features/bench (workbench canvas module).
// Code outside this folder must import from '@/features/bench', never deep.
// Routes compose Bench through this seam (see Task 7 BenchRoute).
export { default as Bench, default } from './Bench';
export { Workbench } from './Workbench';
export { Simulation } from './simulation';
