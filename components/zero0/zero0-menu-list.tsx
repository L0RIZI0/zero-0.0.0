"use client"

import { useState } from "react"
import type { MenuItem } from "@/lib/zero/menu-model"
import { Zero0Glyph } from "./zero0-glyph"
import { Zero0ColorField } from "./zero0-color-picker"

// Re-exported for back-compat: `cssColorToHex` used to live here. Its canonical home is now
// zero0-color-picker (next to the field/picker that use it), but other modules import it from here.
export { cssColorToHex } from "./zero0-color-picker"

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

function MenuRow({ item, onSelect }: { item: Indentable; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)

  if (item.type === "divider") {
    return <div className="my-1 border-t border-border/60" />
  }

  if (item.type === "colorInput") {
    return <ColorInputRow onSelect={onSelect} seed={item.current} />
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
      disabled={item.disabled}
      onClick={() => !item.disabled && onSelect(item.id)}
      className={
        "flex w-full items-center gap-2 px-3 py-1 text-left " +
        (item.disabled
          ? "cursor-default text-muted-foreground/40"
          : "hover:bg-muted hover:text-foreground " + (item.current ? "text-foreground" : "text-muted-foreground")) +
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

// The color entry row — now the shared Zero0ColorField (swatch ramp + "hex or name…" field that
// reveals the HSV picker on focus), identical to the create-field picker (v0.2.149). Here a swatch
// click OR Enter in the field commits through the `color:<hex>` action id (apply + close the menu);
// `seed` prefills from the entity's current accent.
function ColorInputRow({ onSelect, seed }: { onSelect: (id: string) => void; seed?: string }) {
  return (
    <div className="py-1 pl-5 pr-3">
      <Zero0ColorField seedHex={seed} onCommit={(hex) => onSelect(`color:${hex}`)} />
    </div>
  )
}
