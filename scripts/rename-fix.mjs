// One-off: apply tsc's OWN "Did you mean 'X'" suggestions for the field rename,
// column-precisely, so Schedule→startDate/endDate/dueDate and Session/occurrence→
// startedAt/endedAt each land correctly (tsc disambiguates by type). Iterates until
// no more suggestion-bearing errors. Scope: lib/zero + components/** only.
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const SUGG = [
  // TS2551: Property 'OLD' does not exist on type '...'. Did you mean 'NEW'?
  /^(.+?)\((\d+),(\d+)\): error TS2551: Property '([^']+)' does not exist on type .*Did you mean '([^']+)'\?$/,
  // TS2561: Object literal ... 'OLD' does not exist in type '...'. Did you mean to write 'NEW'?
  /^(.+?)\((\d+),(\d+)\): error TS2561: Object literal may only specify known properties, but '([^']+)' does not exist in type .*Did you mean to write '([^']+)'\?$/,
]

for (let pass = 0; pass < 12; pass++) {
  let out = ""
  try {
    out = execSync("npx tsc --noEmit -p tsconfig.json 2>&1", { encoding: "utf8", maxBuffer: 1 << 28 })
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "")
  }
  const lines = out.split("\n")
  // Collect edits per file: {line, col, old, new}
  const byFile = new Map()
  for (const ln of lines) {
    for (const re of SUGG) {
      const m = ln.match(re)
      if (!m) continue
      const [, file, row, col, oldTok, newTok] = m
      if (!file.startsWith("lib/zero/") && !file.startsWith("components/")) continue
      if (!byFile.has(file)) byFile.set(file, [])
      byFile.get(file).push({ row: +row, col: +col, oldTok, newTok })
      break
    }
  }
  if (byFile.size === 0) {
    console.log(`pass ${pass}: no more suggestion errors`)
    break
  }
  let applied = 0
  for (const [file, edits] of byFile) {
    const src = readFileSync(file, "utf8").split("\n")
    // Apply per row, descending col so earlier cols keep their positions.
    const byRow = new Map()
    for (const e of edits) {
      if (!byRow.has(e.row)) byRow.set(e.row, [])
      byRow.get(e.row).push(e)
    }
    for (const [row, es] of byRow) {
      let line = src[row - 1]
      es.sort((a, b) => b.col - a.col)
      for (const e of es) {
        const i = e.col - 1
        if (line.slice(i, i + e.oldTok.length) === e.oldTok) {
          line = line.slice(0, i) + e.newTok + line.slice(i + e.oldTok.length)
          applied++
        } else {
          // Fallback: unique replace on the line if column drifted
          const before = line
          line = line.replace(new RegExp(`\\b${e.oldTok}\\b`), e.newTok)
          if (line !== before) applied++
        }
      }
      src[row - 1] = line
    }
    writeFileSync(file, src.join("\n"))
  }
  console.log(`pass ${pass}: applied ${applied} edits across ${byFile.size} files`)
  if (applied === 0) break
}
