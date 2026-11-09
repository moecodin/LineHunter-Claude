// Helpers every Studio design uses. Loaded before the design files (studio.html).
//   data-el="key"   = a piece the on-card editor can select, move, resize, recolor or hide (studio.js applyEdits)
//   data-text="key" = double-click edits that text (hero, title, subtitle, footer, name)
//   class "st-h"    = a heading: follows the Style panel's letter spacing / uppercase / weight
//   d.photoBox      = set by render(): the photo's box in px, so studio.js can crop the photo to exactly that shape
window.StudioKit = {
  esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  norm: (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase(),
  scales: (d) => ({ hs: (d.style && d.style.hero) || 1, ts: (d.style && d.style.title) || 1, rs: (d.style && d.style.rows) || 1 }),
  // Team tag after a name (nothing when the row hides it).
  tag: (r) => (r.t ? `<i>${window.StudioKit.esc(r.t)}</i>` : ""),
  // How many streak bars a record earns: "5/5" -> 5, "7 straight" -> 7, anything else -> 0.
  pipCount: (rec) => { const s = String(rec || ""); const m = /^(\d+)\s*\/\s*\d+/.exec(s) || /^(\d+)\s+straight/.exec(s); return m ? Math.min(12, +m[1]) : 0; },
  note: (d) => window.StudioKit.esc(d.note).replace(/\n/g, "<br>"),
};
