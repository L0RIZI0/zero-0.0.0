import type { Metadata } from "next"
import type { ReactNode } from "react"

// The page itself is a client component, so its title lives here in a sibling layout. This is
// the <title> that /api/web-title reads to label the "/matrix-interactions" resource.
export const metadata: Metadata = {
  title: "Interaction Matrix",
}

export default function MatrixInteractionsLayout({ children }: { children: ReactNode }) {
  return children
}
