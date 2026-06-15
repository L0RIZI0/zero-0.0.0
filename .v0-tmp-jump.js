// Sample the vertical position of the first do-list row in the day-job body
// over time, to catch the end-of-close jump.
window.__j = []
window.__jiv = setInterval(() => {
  const body = document.querySelector('[data-window="day-job"] [data-body]')
  if (!body) return
  const row = body.querySelector("button, [role='button'], li, a")
  if (!row) return
  const r = row.getBoundingClientRect()
  const cs = getComputedStyle(body)
  window.__j.push({ t: Date.now(), rowTop: Math.round(r.top), overflow: cs.overflowY })
}, 50)
