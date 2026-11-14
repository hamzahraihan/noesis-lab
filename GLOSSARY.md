# Noesis

The domain language of the bench: what a part is, how the bench decides what it
is connected to, and how a sketch reaches it.

## Language

**World source**:
A device's reading of what the world is doing right now, read at the moment the
chip reports rather than pushed in on a tick. The operator's knob is what stands
in for the world, so a knob turned between two reads is seen by the very next
one.
_Avoid_: conditions, environment, sensor value, live value

**Part definition**:
The catalogue entry that says where a part's holes are, which of them are joined
inside the part, and what device it behaves as. Everything the bench does with a
part -- wiring it, solving it, drawing it, reading its knobs -- reads the same
definition.
_Avoid_: component spec, part model, footprint

**Device**:
What a part does when a sketch talks to it over a bus: the address it answers at
and what it does with the bytes it is given. The bus moves bytes and decides
nothing; the device is the whole of the answer.
_Avoid_: peripheral, chip model, driver

**Bench**:
The circuit under test: the parts placed on it, the wires between their holes,
and the board that runs the sketch. The bench is the unit a Run loads and a
diagnostic check drives.
_Avoid_: board, canvas, circuit

**Gallery project**:
A runnable build in the gallery: the bench it needs, the sketch that runs on it,
and the checks that prove it still runs.
_Avoid_: example, demo, sample