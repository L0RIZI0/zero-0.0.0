# Local patches to Grok's vendored dayline engine

`lib/dayline/` is Grok's engine, VENDORED (copied in from a zip, not a live package). These are the
edits Zero has made ON TOP of what Grok shipped. **A fresh re-vendor (dropping a new zip) will OVERWRITE
these** — re-apply each one, or (better) get it upstreamed into Grok's engine so the next zip already has it.

Keep this list exhaustive. If you edit an engine file, add a row here.

---

## 1. `mount.ts` — `clock: "data"` → `clock: "wall"`  (v0.2.349)

**Why:** Zero was pushing `now` into the engine every second, which rebuilt the marks array and called
`loadData()` — and `loadData` unconditionally replaces `this.events`, clobbering any in-progress drag
(drag snap-back). Switching to the engine's own wall clock lets it advance its now-marker + grow
open-ended bars on its own rAF, so Zero no longer pushes `now` at all.

**Upstream ask:** none really — `clock` is a documented option Grok exposed. Ideally Zero passes this as
an option from the adapter instead of editing `mount.ts`, so it stops being a local patch. (Deferred until
we set up the engine as a real package.)

## 2. `engine.ts` — resize branch of `onMove` now sets `this.moved = true`  (v0.2.351)

**Why:** ENGINE BUG. The `drag-event` (move) branch of `onMove` sets `this.moved = true`; the
`resize-start`/`resize-end` branch did NOT. `onUp` gates the commit on `if (this.moved)`, so a resize
never ran `commitSnap` / `persist` / `emitRetime` — the edge moved visually but the new time was never
emitted to Zero, and the chip snapped back on the next `update()`. Fix mirrors the move branch: on the
first real movement, push undo + set `moved = true`.

**Upstream ask:** YES — report to Grok, this belongs in the engine. Once his zip includes it, delete this
local edit (and this row).
