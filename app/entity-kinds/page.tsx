import { redirect } from "next/navigation"

/**
 * The Entity Kinds reference moved to `/zero-entities` ("Zero Entities"). This
 * stub permanently redirects the old path so any existing links keep working.
 */
export default function EntityKindsRedirect() {
  redirect("/zero-entities")
}
