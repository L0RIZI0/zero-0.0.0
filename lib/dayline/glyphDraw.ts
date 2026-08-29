import {
  CANCEL_BAR,
  DONE_CHECK,
  GLYPH_BOX,
  GLYPH_GEOMETRY,
  SCHEDULED_DAMP,
  SPIN,
  SPIN_ORIGIN,
  STROKE,
  TASK_REQUESTED,
  type GlyphPrimitive,
} from "./contract";

export type GlyphDrawFlags = {
  kind: string;
  accent: string;
  bg: string;
  /** Pixel size of the 24-box. */
  size: number;
  cx: number;
  cy: number;
  ongoing?: boolean;
  flip180?: boolean;
  done?: boolean;
  cancelled?: boolean;
  filled?: boolean;
  scheduled?: boolean;
  requested?: boolean;
  timeMs?: number;
  reducedMotion?: boolean;
};

function parsePoints(s: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const re = /(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ x: +m[1], y: +m[2] });
  return out;
}

function parsePath(d: string): { op: "M" | "L"; x: number; y: number }[] {
  const out: { op: "M" | "L"; x: number; y: number }[] = [];
  const re = /([ML])\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    out.push({ op: m[1].toUpperCase() as "M" | "L", x: +m[2], y: +m[3] });
  }
  return out;
}

function polygon(ctx: CanvasRenderingContext2D, points: string) {
  const pts = parsePoints(points);
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function segments(ctx: CanvasRenderingContext2D, d: string, closed: boolean) {
  const cmds = parsePath(d);
  if (!cmds.length) return;
  ctx.beginPath();
  for (const c of cmds) {
    if (c.op === "M") ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  }
  if (closed) ctx.closePath();
}

function primitive(
  ctx: CanvasRenderingContext2D,
  p: GlyphPrimitive,
  accent: string,
  strokeW: number,
  fillable: boolean,
  filled: boolean,
) {
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = strokeW;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (p.op === "polygon") {
    polygon(ctx, p.points);
    if (filled && fillable) ctx.fill();
    else ctx.stroke();
  } else if (p.op === "circle") {
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
    if (p.solid || (filled && fillable)) ctx.fill();
    else ctx.stroke();
  } else if (p.op === "segments") {
    segments(ctx, p.d, p.closed);
    if (filled && fillable && p.closed) ctx.fill();
    else ctx.stroke();
  } else if (p.op === "line") {
    if (p.dash) ctx.setLineDash(p.dash);
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Paint one Zero glyph, 24-box mapped to `size` px, centred on (cx, cy). */
export function drawGlyph(ctx: CanvasRenderingContext2D, g: GlyphDrawFlags) {
  const kind = g.kind in GLYPH_GEOMETRY ? g.kind : "task";
  const spec = GLYPH_GEOMETRY[kind];
  const filled = !!(g.filled && spec.fillable);
  const scheduled = !!(g.scheduled && !filled);
  let strokeW: number = STROKE.base;
  if (filled) strokeW = STROKE.filled;
  else if (scheduled) strokeW = kind === "space" ? STROKE.scheduledSpace : STROKE.scheduled;

  const origin = SPIN_ORIGIN[kind] ?? [12, 12];
  let spin = 0;
  if (g.ongoing && !g.reducedMotion) {
    const t = (g.timeMs ?? 0) % SPIN.fullTurnMs;
    spin = (t / SPIN.fullTurnMs) * Math.PI * 2;
  }

  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.scale(g.size / GLYPH_BOX, g.size / GLYPH_BOX);
  ctx.translate(-12, -12);

  ctx.translate(origin[0], origin[1]);
  ctx.rotate(spin);
  ctx.translate(-origin[0], -origin[1]);

  if (g.flip180) {
    ctx.translate(12, 12);
    ctx.rotate(Math.PI);
    ctx.translate(-12, -12);
  }

  if (scheduled && (kind === "space" || kind === "community" || kind === "resource")) {
    ctx.translate(SCHEDULED_DAMP.about[0], SCHEDULED_DAMP.about[1]);
    ctx.scale(SCHEDULED_DAMP.scale, SCHEDULED_DAMP.scale);
    ctx.translate(-SCHEDULED_DAMP.about[0], -SCHEDULED_DAMP.about[1]);
  }

  if (kind === "individual") {
    ctx.translate(12, 12);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-12, -12);
  }

  const prims =
    kind === "task" && g.requested
      ? ([{ op: "polygon", points: TASK_REQUESTED, closed: true }] as GlyphPrimitive[])
      : spec.primitives;

  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    ctx.save();
    if (kind === "space" && i === 1 && !filled) ctx.globalAlpha *= 0.5;
    if (kind === "space" && i === 2 && !filled) ctx.globalAlpha *= 0.42;
    if (kind === "space" && i > 0 && filled) {
      ctx.restore();
      continue;
    }
    primitive(ctx, p, g.accent, strokeW || STROKE.base, spec.fillable, filled);
    ctx.restore();
  }
  ctx.restore();

  // Overlays stay upright (no spin, no flip).
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.scale(g.size / GLYPH_BOX, g.size / GLYPH_BOX);
  ctx.translate(-12, -12);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (g.done) {
    ctx.strokeStyle = filled ? g.bg : g.accent;
    ctx.lineWidth = 1.8;
    segments(ctx, DONE_CHECK, false);
    ctx.stroke();
  }
  if (g.cancelled) {
    ctx.strokeStyle = g.bg;
    ctx.lineWidth = CANCEL_BAR.casingWidth;
    ctx.beginPath();
    ctx.moveTo(CANCEL_BAR.x1, CANCEL_BAR.y1);
    ctx.lineTo(CANCEL_BAR.x2, CANCEL_BAR.y2);
    ctx.stroke();
    ctx.strokeStyle = g.accent;
    ctx.lineWidth = CANCEL_BAR.barWidth;
    ctx.beginPath();
    ctx.moveTo(CANCEL_BAR.x1, CANCEL_BAR.y1);
    ctx.lineTo(CANCEL_BAR.x2, CANCEL_BAR.y2);
    ctx.stroke();
  }
  ctx.restore();
}
