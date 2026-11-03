# Examples

Reference sources showing how a host composes the companion and what student
Python looks like. They are documentation-grade (not built by CI). To run them,
install the packed tarballs (or a `file:` reference) into a Vite + React app as
shown in [`host-app.tsx`](host-app.tsx); the repository's browser QA does exactly
this against the packed candidate.

- [`host-app.tsx`](host-app.tsx) — composing `pythonGraphicsPlugin`, including an
  optional mock second service sharing the one byte device.
- `programs/shapes.py` — every shape, fill/outline/width, text anchors, layering.
- `programs/bounce.py` — animation with `pause` and `get_bounds`.
- `programs/paint.py` — mouse drag + keyboard (focus-scoped input).
- `programs/turtle_spiral.py` — the turtle-style adapter.

See [`../docs/INTEGRATION.md`](../docs/INTEGRATION.md) for the wire contract.
