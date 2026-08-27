# Zero Dayline Contract

The **only** shared surface between Zero's model and a dayline **view engine**. If an engine implements
`mountDayline` against these types, Zero can render it — without either side importing the other's code.

- `index.ts` — the typed boundary (marks in, intent events out, imperative mount handle).
- `sample.ts` — a deterministic fixture exercising every tricky case (ongoing, cancelled ghost, instant,
  nested Space, far-future compression, recorded + auto sessions). Develop the engine against this.

## Why this exists

Zero is a **model** (entities, occurrences vs. recorded sessions, recurrence, watchdog, glyphs, nesting)
plus a **view** (the dayline render). The model is expensive and settled; the view is being rebuilt. This
contract lets the view be rebuilt — in a separate engine, by a separate tool — with **zero risk to the
model**, because the engine never sees the ontology. It only ever receives absolute-time marks and emits
user-intent events.

This is not a new invention: Zero already renders its dayline and calendar from a shared absolute-time bar
type (`CalBar`) with no view geometry. This contract promotes that internal boundary to a public one.

## Responsibilities

| The ENGINE owns (view) | ZERO owns (model + shell) |
| --- | --- |
| Canvas render, 60fps | The ontology and all its rules |
| The time axis — fisheye / scroll / linear, pan, zoom | Producing `DaylineData` from the model |
| The sun, springs, easing, enter/exit animations | Validating + committing intent (retime, cancel, create) |
| Label placement, guides, now-marker, dead-space compression | Theme values (reads CSS vars → passes concrete colors) |
| Hit-testing → firing intent callbacks | Electron shell, git tags, auto-update, releases |

The engine is **pure view + intent**: data in, events out, no mutation. Zero validates every intent and
pushes fresh data back. Dispatch tokens (`occRef`, `sessionAnchorId`) are **opaque** to the engine — it
echoes them back so Zero can resolve what was acted on, which is what keeps recurrence/definite/rule
semantics entirely on Zero's side.

## Engine entry point

```ts
import { mountDayline } from "@zero/dayline-view"
import { sampleData } from "@zero/dayline-contract/sample"

const handle = mountDayline({
  surface: canvasEl,
  data: sampleData,
  theme: { scheme: "dark", now: "#ff8a00" },
  callbacks: {
    onOccurrenceRetime: (entityId, occRef, start, end) => { /* Zero commits */ },
    onEmptyClick: (centerTime) => { /* Zero expands to calendar */ },
    // ...
  },
})

handle.update(nextData) // on every model change
handle.destroy()        // on unmount
```

## Zero-side adapter (sketch)

A thin React wrapper mounts the engine and re-`update`s it when the model changes. This is the entire
integration on Zero's side — no second rewrite:

```tsx
function DaylineView(props: { marks: DaylineMark[]; now: number; theme: DaylineTheme }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const handle = useRef<DaylineHandle | null>(null)

  useEffect(() => {
    if (!ref.current) return
    handle.current = mountDayline({
      surface: ref.current,
      data: { now: props.now, marks: props.marks },
      theme: props.theme,
      callbacks: {
        onOccurrenceRetime: (id, occRef, s, e) => commitOccurrenceRetime(id, occRef, s, e),
        onSessionRetime: (id, anchor, s, e) => editSession(id, anchor, s, e),
        onOccurrenceMenu: (id, occRef, x, y) => openOccurrenceMenu(id, occRef, x, y),
        onEmptyClick: (t) => expandToCalendar(t),
        onBandMenu: (x, y) => openBandMenu(x, y),
      },
    })
    return () => handle.current?.destroy()
  }, [])

  useEffect(() => {
    handle.current?.update({ now: props.now, marks: props.marks })
  }, [props.now, props.marks])

  return <canvas ref={ref} />
}
```

## How updates flow (the "Zero pulls it seamlessly" mechanism)

The engine ships as a **versioned package** Zero depends on — nothing is copy/pasted between tools:

1. The engine lives in its **own repo**, implementing `mountDayline` against this contract.
2. It publishes as `@zero/dayline-view` (npm, or a GitHub package / git-ref dependency).
3. Zero adds it as a dependency. The adapter above is the only glue.
4. Engine improves → publishes a new version → Zero bumps the version → Zero's existing **git-tag
   auto-update** ships it to the Electron client. No manual code transfer, ever — just a version bump.

Both sides depend on **this** package for the types, so a breaking change is a compile error, not a
surprise. Bump `DAYLINE_CONTRACT_VERSION` (and the major) on any breaking shape change.

## Open questions for v1 → v2

- **Glyphs:** v1 passes `kind` + state flags and lets the engine draw. If Zero's exact silhouettes matter,
  v2 adds an optional `svgPath` the adapter supplies.
- **Calendar:** out of scope here — this contract is dayline-only. The calendar is a separate view that
  currently shares geometry with the dayline; if the engine also replaces the calendar later, it gets its
  own contract.
- **Access rail:** modelled as a `track`, but Zero's access band has its own semantics (machine truth). If
  the engine renders it specially, we may split it out.
