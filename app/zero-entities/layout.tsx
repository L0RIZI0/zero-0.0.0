import type { Metadata } from "next"
import type { ReactNode } from "react"

// The page itself is a client component, so its title lives here in a sibling layout. This is
// the <title> that /api/web-title reads to give the "/zero-entities" resource its display label.
export const metadata: Metadata = {
  title: "Zero Entities",
}

export default function ZeroEntitiesLayout({ children }: { children: ReactNode }) {
  return children
}
