// Composition only: no logic, no state. Wires the learn seam into the bench
// DOM shell as props.
//
// The deep `@/features/bench/Bench` path is the T7 dispatch §2 composition
// exemption: the shell is the DOM half of the bench, so it stays out of the
// node-safe `@/features/bench` barrel, and only src/app/** and src/routes/**
// may import it deep. Passing learn content as props (rather than letting
// Bench import it) is what keeps the bench → learn value direction at zero —
// the boundary gate forbids it.
import Bench from '@/features/bench/components/Bench';
import {
  BOARDS,
  boardOption,
  buildFor,
  DEFAULT_BOARD_ID,
  EXAMPLES,
  exerciseBoard,
  exerciseById,
  ExerciseGuide,
  exerciseLanguage,
  exampleProjectFor,
  firmwareForBuild,
  galleryById,
  isBoardId,
  isGuideDismissed,
  starterSketchFor,
  starterCircuitFor,
  exampleCircuitFor,
} from '@/features/learn';

export default function BenchRoute() {
  return (
    <Bench
      EXAMPLES={EXAMPLES}
      starterSketchFor={starterSketchFor}
      exampleProjectFor={exampleProjectFor}
      BOARDS={BOARDS}
      boardOption={boardOption}
      DEFAULT_BOARD_ID={DEFAULT_BOARD_ID}
      isBoardId={isBoardId}
      starterCircuitFor={starterCircuitFor}
      exampleCircuitFor={exampleCircuitFor}
      exerciseBoard={exerciseBoard}
      exerciseById={exerciseById}
      exerciseLanguage={exerciseLanguage}
      buildFor={buildFor}
      firmwareForBuild={firmwareForBuild}
      galleryById={galleryById}
      ExerciseGuide={ExerciseGuide}
      isGuideDismissed={isGuideDismissed}
    />
  );
}
