// Public seam for features/learn (learning content + pages).
// Code outside this folder must import from '@/features/learn', never deep.
// (EXERCISES + the value/type surface below serve the composition layer and
// BenchProps; everything else stays reachable only through this seam.)
export { HomePage } from './HomePage';
export { ExercisesPage, ExercisePage, ReferencesPage } from './ExercisePages';
export { ProjectPage } from './ProjectPages';
export { ExerciseGuide } from './ExerciseGuide';
export { EXERCISES, exerciseById, exerciseBoard, exerciseLanguage } from './exercises';
export type { Exercise } from './exercises';
export { buildFor, firmwareForBuild, galleryById } from './gallery';
export type { GalleryBuild, GalleryProject } from './gallery';
export {
  BLINK_EXAMPLE,
  EXAMPLE_DEVICES,
  EXAMPLES,
  LCD_LINES,
  PI_BLINK_SKETCH,
} from './examples';
export type { Example, ExampleDevice } from './examples';
export {
  BOARDS,
  boardOption,
  DEFAULT_BOARD_ID,
  isBoardId,
  STARTER_WIRING,
} from './boardRegistry';
export type { BoardId, BoardOption, StarterWiring } from './boardRegistry';
export { isGuideDismissed, setGuideDismissed } from './guide-dismissal';
