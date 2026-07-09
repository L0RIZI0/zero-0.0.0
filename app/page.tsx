import { JetBrains_Mono } from "next/font/google"
import { Zero0Canvas } from "@/components/zero0/zero0-canvas"

// The root `/` (shown as "0" in the version switcher) is now a stripped, blank
// data-styled canvas — the slate for Zero's next iteration. The full previous app
// lives on, frozen and independent, at `/2` (and the pre-ribbon snapshot at `/1`).
//
// The new "screams DATA" styling is SCOPED to this route: JetBrains Mono is loaded
// here as a page-local CSS variable and applied only inside the canvas, so the
// shared layout.tsx/globals.css stay on Geist and `/1` + `/2` are untouched.
const zero0Mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-zero0-mono",
  display: "swap",
})

export default function Page() {
  return (
    <div className={zero0Mono.variable}>
      <Zero0Canvas />
    </div>
  )
}
