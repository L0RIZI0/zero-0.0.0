"use client"

import { createContext, useContext } from "react"
import type { MenuItem } from "@/lib/zero/menu-model"

// Lets any descendant open a menu through the canvas's ONE `showMenu` chokepoint — which draws an
// in-DOM popup normally, or the native overlay window when a web Resource is open (a DOM menu can't
// paint over a native WebView2 content layer, so anything that might overlap it MUST route here
// instead of rendering its own portal). Provided once at the canvas root; consumed by deeply nested
// chrome (e.g. the dayline band menu) without prop-drilling through the agenda/activity layers.
export type ShowMenuFn = (items: MenuItem[], x: number, y: number, onSelect: (id: string) => void) => void

const MenuContext = createContext<ShowMenuFn | null>(null)

export const MenuProvider = MenuContext.Provider

/** The canvas `showMenu`, or null when rendered outside the provider (e.g. a standalone widget or
 *  SSR) — callers fall back to their own in-DOM menu in that case. */
export function useShowMenu(): ShowMenuFn | null {
  return useContext(MenuContext)
}
