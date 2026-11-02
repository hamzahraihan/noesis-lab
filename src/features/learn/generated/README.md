# Generated — do not edit by hand

Every file in this folder is written by a script. Editing one is wasted work:
the next `npm run generate:gallery` (or `npm install`, which runs it through
`prepare`) overwrites it.

| File                  | Source                                   |
| --------------------- | ---------------------------------------- |
| `gallery-projects.ts` | `../gallery-projects.json`               |
| `circuits-registry.ts`| `../circuits/*.json`                     |
| `checks-map.ts`       | project ids × check-function table       |
| `test-coverage.ts`    | project ids, board labels, wire floors   |

Regenerate after changing any input:

```bash
npm run generate:gallery
```

Why these exist: a gallery project used to require hand-editing five files in
step (the JSON document, its registry entry, a sketch, a test leg, and a
diagnostics check). The generated layer keeps the project list in one place so
those five can no longer disagree.

`test-coverage.ts` defaults a project's wire floor to `1` when
`scripts/generate-gallery.ts` has no explicit entry, because the generated type
is `Record<GalleryProjectId, number>`. Adding a project therefore needs no edit
to the floor table.
