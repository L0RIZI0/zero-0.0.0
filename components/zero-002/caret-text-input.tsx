"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A single-line text input with a custom CARET: a thicker block bar that blinks
 * slowly (terminal "▮" style) instead of the thin, fast native caret. The native
 * caret is hidden (`caret-color: transparent`) and we render our own bar.
 *
 * The bar is positioned by mirroring the text BEFORE the caret into a hidden span
 * (with the input's exact font metrics) and measuring its width, then offsetting by
 * the input's own horizontal scroll so it stays correct mid-text and when the value
 * overflows the box. The bar only shows while focused with a COLLAPSED selection;
 * during a range-selection we hide it (the browser's selection highlight reads the
 * position instead). Reusable for every Zero text field so the caret feels uniform.
 */
export type CaretTextInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Optional class for the relative wrapper (the input gets `className`). */
  wrapperClassName?: string
}

export const CaretTextInput = forwardRef<HTMLInputElement, CaretTextInputProps>(function CaretTextInput(
  { className, wrapperClassName, value, onChange, onSelect, onKeyUp, onClick, onFocus, onBlur, style, ...rest },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement)
  const mirrorRef = useRef<HTMLSpanElement>(null)

  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState<{ x: number; h: number; visible: boolean }>({ x: 0, h: 0, visible: false })

  // Position the bar at the current caret offset. Mirrors the pre-caret text using
  // the input's live computed font metrics so the measurement matches exactly.
  const measure = useCallback(() => {
    const el = inputRef.current
    const mirror = mirrorRef.current
    if (!el || !mirror) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) {
      setCaret((c) => (c.visible ? { ...c, visible: false } : c))
      return
    }
    const cs = getComputedStyle(el)
    mirror.style.font = cs.font
    mirror.style.fontFamily = cs.fontFamily
    mirror.style.fontSize = cs.fontSize
    mirror.style.fontWeight = cs.fontWeight
    mirror.style.letterSpacing = cs.letterSpacing
    mirror.textContent = (el.value ?? "").slice(0, start)
    const textW = mirror.getBoundingClientRect().width
    const padLeft = parseFloat(cs.paddingLeft) || 0
    const fontPx = parseFloat(cs.fontSize) || 13
    const x = Math.max(0, padLeft + textW - el.scrollLeft)
    setCaret({ x, h: Math.round(fontPx * 1.15), visible: true })
  }, [])

  // Re-measure synchronously after any value/focus change so the bar never lags.
  useLayoutEffect(() => {
    if (focused) measure()
  }, [value, focused, measure])

  // Keep the bar correct on container/font resize (e.g. window or layout changes).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const ro = new ResizeObserver(() => focused && measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [focused, measure])

  return (
    <span className={cn("relative inline-flex min-w-0 flex-1", wrapperClassName)}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange?.(e)
          measure()
        }}
        onSelect={(e) => {
          onSelect?.(e)
          measure()
        }}
        onKeyUp={(e) => {
          onKeyUp?.(e)
          measure()
        }}
        onClick={(e) => {
          onClick?.(e)
          measure()
        }}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
          // Next frame: selection is settled, scrollLeft is final.
          requestAnimationFrame(measure)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        // Hide the native caret; our bar stands in for it.
        style={{ caretColor: "transparent", ...style }}
        className={cn("min-w-0 flex-1", className)}
        {...rest}
      />
      {/* Hidden mirror used purely to measure pre-caret text width. */}
      <span
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre"
      />
      {/* The block caret bar. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 w-[3px] -translate-y-1/2 rounded-[1px] bg-foreground",
          focused && caret.visible ? "zero-caret-blink" : "opacity-0",
        )}
        style={{ left: caret.x, height: caret.h }}
      />
    </span>
  )
})
