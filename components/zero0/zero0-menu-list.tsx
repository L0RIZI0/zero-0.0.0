"use client"

import { useState } from "react"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0Glyph } from "./zero0-glyph"
import { Zero0ColorPicker } from "./zero0-color-picker"

// Presentational renderer for a generic MenuItem tree. Positioning-agnostic (the DOM
// menu wraps it in a fixed/clamped container; the native overlay window wraps it in a
// full-bleed card): it only draws rows, expands `submenu` items inline, and reports the
// chosen leaf action id via `onSelect`. Shared so the in-DOM menu and the over-the-web
// native overlay look and behave identically.
export function Zero0MenuList({
  items,
  onSelect,
}: {
  items: MenuItem[]
  onSelect: (id: string) => void
}) {
  return (
    <div role="menu" className="min-w-40 py-1 text-[11px] tabular-nums">
      {items.map((item, i) => (
        <MenuRow key={rowKey(item, i)} item={item} onSelect={onSelect} />
      ))}
    </div>
  )
}

function rowKey(item: MenuItem, i: number): string {
  if (item.type === "item") return item.id
  if (item.type === "submenu") return `sub:${item.label}`
  if (item.type === "colorInput") return "colorinput"
  return `div:${i}`
}

/**
 * Resolve a user-typed color — a hex ("#8b5a2b", "#abc") OR a CSS color name ("brown",
 * "grey") — to a normalized "#rrggbb" hex, using the browser's own parser. Returns null
 * for anything the browser rejects, so an invalid entry simply can't be committed.
 */
export function cssColorToHex(input: string): string | null {
  const s = input.trim()
  if (!s || typeof document === "undefined") return null
  const el = document.createElement("span")
  el.style.color = ""
  el.style.color = s // invalid values are ignored, leaving color === ""
  if (!el.style.color) return null
  el.style.position = "absolute"
  el.style.opacity = "0"
  el.style.pointerEvents = "none"
  document.body.appendChild(el)
  const rgb = getComputedStyle(el).color
  el.remove()
  const m = rgb.match(/\d+(?:\.\d+)?/g)
  if (!m || m.length < 3) return null
  return (
    "#" +
    m
      .slice(0, 3)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("")
  )
}

function MenuRow({ item, onSelect }: { item: Indentable; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)

  if (item.type === "divider") {
    return <div className="my-1 border-t border-border/60" />
  }

  if (item.type === "colorInput") {
    return <ColorInputRow onSelect={onSelect} />
  }

  if (item.type === "submenu") {
    return (
      <>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span>{item.label}</span>
          <span aria-hidden className="text-muted-foreground/60">
            {open ? "−" : "+"}
          </span>
        </button>
        {open && (
          <div className="border-t border-border/60">
            {item.items.map((child, i) => (
              <MenuRow key={rowKey(child, i)} item={indent(child)} onSelect={onSelect} />
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <button
      type="button"
      role="menuitem"
      aria-current={item.current ? "true" : undefined}
      onClick={() => onSelect(item.id)}
      className={
        "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-muted hover:text-foreground " +
        (item.current ? "text-foreground" : "text-muted-foreground") +
        (item._indent ? " pl-5" : "")
      }
    >
      {item.glyphKind && <Zero0Glyph kind={item.glyphKind} className="h-3 w-3" />}
      {item.swatch && (
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/60"
          style={{ backgroundColor: item.swatch }}
        />
      )}
      <span>{item.label}</span>
      {item.current && (
        <span aria-hidden className="ml-auto pl-3 text-muted-foreground/70">
          {"\u2022"}
        </span>
      )}
    </button>
  )
}

// Internal flag so nested (submenu-child) rows render indented without leaking into the
// serialisable model.
type Indentable = MenuItem & { _indent?: boolean }
function indent(item: MenuItem): Indentable {
  return item.type === "item" ? { ...item, _indent: true } : item
}

// The free-text color entry (hex or CSS name) — the SINGLE color field. Live-resolves to a hex:
// the leading dot previews it, Enter (or clicking the dot) commits it through `color:<hex>`.
// Invalid text can't commit. Enter is IME-guarded. v0.2.148: FOCUSING the field reveals the visual
// HSV picker inline (no separate toggle button); dragging the picker feeds this field + its dot,
// and the field's own Enter/dot stays the single commit path (the picker never auto-commits).
function ColorInputRow({ onSelect }: { onSelect: (id: string) => void }) {
  const [text, setText] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const hex = cssColorToHex(text)
  const commit = () => {
    if (hex) onSelect(`color:${hex}`)
  }
  return (
    <div className="py-1 pl-5 pr-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Apply typed color"
          disabled={!hex}
          onClick={commit}
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/60 disabled:opacity-40"
          style={{ backgroundColor: hex ?? "transparent" }}
        />
        <input
          type="text"
          value={text}
          onFocus={() => setPickerOpen(true)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="hex or name…"
          aria-label="Custom color (hex or CSS name)"
          className="w-40 rounded border border-border bg-background px-1 py-0.5 text-foreground placeholder:text-muted-foreground/60"
        />
      </div>
      {pickerOpen && (
        <div className="mt-2">
          {/* Feeds this field live as you drag (onChange → setText); the field's Enter/dot is the
              single commit path (no onCommit, so dragging never fires the terminal action). Seeds
              from whatever hex the field currently resolves to. */}
          <Zero0ColorPicker value={hex ?? undefined} onChange={(picked) => setText(picked)} />
        </div>
      )}
    </div>
  )
}
