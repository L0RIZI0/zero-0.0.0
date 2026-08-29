// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER DAYLINE ENGINE
//
// ⚠️ THIS FILE IS A STAND-IN. Grok's real canvas engine ships as `@/lib/dayline` and
// REPLACES this file/directory wholesale. It exists only so Zero compiles and the
// adapter (`lib/dayline-adapter`) + host (`zero0-dayline-canvas.tsx`) have something
// concrete to mount against before the engine lands. Do not build features on it.
//
// It implements the contract's `MountDayline` exactly, so swapping in the real engine
// is a drop-in: same import, same args, same handle. The render is intentionally crude
// (a baseline, a now-marker at 1/3, one dot per mark on a LINEAR scale) — no warp, no
// sun, no springs. That's the whole point of handing the view to a dedicated engine.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MountDayline,
  DaylineHandle,
  DaylineData,
  DaylineTheme,
  MountDaylineArgs,
} from "@/packages/dayline-contract"

export const mountDayline: MountDayline = (args: MountDaylineArgs): DaylineHandle => {
  const { surface } = args
  let data: DaylineData = args.data
  let theme: DaylineTheme = args.theme ?? {}
  let raf = 0

  const ctx = surface.getContext("2d")

  const paint = () => {
    raf = 0
    if (!ctx) return
    const w = surface.width
    const h = surface.height
    const dpr = window.devicePixelRatio || 1
    ctx.save()
    ctx.scale(dpr, dpr)
    const cw = w / dpr
    const ch = h / dpr
    ctx.clearRect(0, 0, cw, ch)

    const fg = theme.foreground ?? "#888"
    const nowColor = theme.now ?? "#e08a3c"
    const midY = ch / 2

    // baseline
    ctx.strokeStyle = theme.border ?? "rgba(128,128,128,0.4)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(cw, midY)
    ctx.stroke()

    // Linear window: earliest mark start → latest mark end, with `now` anchored at 1/3.
    const starts = data.marks.map((m) => m.start ?? m.end)
    const ends = data.marks.map((m) => m.end)
    const lo = Math.min(data.now, ...(starts.length ? starts : [data.now]))
    const hi = Math.max(data.now, ...(ends.length ? ends : [data.now]))
    const span = Math.max(1, hi - lo)
    const xFor = (t: number) => ((t - lo) / span) * cw

    // now marker
    const nx = xFor(data.now)
    ctx.strokeStyle = nowColor
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(nx, midY - 14)
    ctx.lineTo(nx, midY + 14)
    ctx.stroke()

    // marks
    for (const m of data.marks) {
      const x0 = xFor(m.start ?? m.end)
      const x1 = xFor(m.end)
      ctx.globalAlpha = m.cancelled ? 0.25 : m.auto ? 0.5 : 1
      ctx.fillStyle = m.glyph.accent || fg
      if (m.point || m.instant || x1 - x0 < 2) {
        ctx.beginPath()
        ctx.arc(x0, midY, 4, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(x0, midY - 6, Math.max(2, x1 - x0), 12)
      }
      ctx.globalAlpha = 1
    }

    // banner
    ctx.fillStyle = fg
    ctx.font = "11px ui-monospace, monospace"
    ctx.fillText("dayline engine placeholder — awaiting @/lib/dayline", 8, 14)
    ctx.restore()
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(paint)
  }

  schedule()

  return {
    update(next: DaylineData) {
      data = next
      schedule()
    },
    setTheme(next: DaylineTheme) {
      theme = next
      schedule()
    },
    resize(width: number, height: number) {
      const dpr = window.devicePixelRatio || 1
      surface.width = Math.round(width * dpr)
      surface.height = Math.round(height * dpr)
      schedule()
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
  }
}
