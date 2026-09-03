/** Canvas palette — chrome stays muted; chips use CAL_PALETTE. */

import type { DaylineTheme } from "./contract";

export const C = {
  bg: "#080809",
  bgElevated: "#121214",
  fg: "#ececee",
  muted: "#8c8c94",
  subtle: "#5c5c64",
  faint: "#2a2a30",
  line: "#3a3a42",
  tick: "#6a6a72",
  tickMajor: "#9a9aa2",
  now: "#f4f4f6",
  nowGlow: "rgba(244,244,246,0.14)",
  bandStroke: "rgba(236,236,238,0.12)",
  handle: "#f4f4f6",
  snap: "rgba(210,212,216,0.35)",
  selection: "#d2d4d8",
  work: "#3b82f6",
  life: "#22c55e",
  travel: "#f97316",
  personal: "#ec4899",
  focus: "#eab308",
};

export function applyChrome(theme: DaylineTheme) {
  if (theme.background) {
    C.bg = theme.background;
    C.bgElevated = theme.scheme === "light" ? theme.background : "#121214";
  }
  if (theme.foreground) {
    C.fg = theme.foreground;
    C.handle = theme.foreground;
    C.selection = theme.foreground;
  }
  if (theme.muted) {
    C.muted = theme.muted;
    C.tick = theme.muted;
    C.tickMajor = theme.muted;
  }
  if (theme.border) {
    C.line = theme.border;
    C.faint = theme.border;
  }
  if (theme.now) {
    C.now = theme.now;
    C.nowGlow = theme.now;
  }
}

/** Calendar item swatches (user picker, including #ec4899). */
export const CAL_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f4f4f6",
  "#6b7280",
] as const;

export const CATEGORY_COLOR: Record<string, string> = {
  work: "#3b82f6",
  life: "#22c55e",
  travel: "#f97316",
  personal: "#ec4899",
  focus: "#eab308",
};

export const FONT_UI = '"IBM Plex Sans", system-ui, sans-serif';
export const FONT_DISPLAY = '"IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable color from title so repeating blocks (Day job) match. */
export function colorOf(title: string, category?: string): string {
  if (!title) return CATEGORY_COLOR[category ?? ""] ?? CAL_PALETTE[6];
  return CAL_PALETTE[hashStr(title) % CAL_PALETTE.length];
}

/** Ink on a chip fill. */
export function inkOn(hex: string): string {
  if (!hex || hex[0] !== "#") return "#f7f7f8";
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(n)) return "#121214";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.62 ? "#121214" : "#f7f7f8";
}