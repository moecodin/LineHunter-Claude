// Studio design: Night poster (dark, big "100%", the photo fades in from the top right).
// A design = { id, name, photo: "duotone" | "plain", tokens, capacity(size, data), render(data) -> HTML string }.
// data = { w, h, rows: [{ n, t, stat, rec }], hero, title, subtitle, footer, note, photo: { url, credit } | null, logo, style }.
// data.style = { hero, title, rows (scales, 1 = normal), showLogo, showSub, showPips }. Colors and fonts come in as CSS variables
// (--c-bg, --c-ink, --f-head ... set by studio.js on a wrapper), so this file only does sizes and layout.
// Only things html2canvas can draw: plain gradients, no blend modes or masks (the photo is tinted in studio.js before it gets here).
(function () {
  const FOOT = 210, MIN_HEAD_ROOM = 120;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sc = (d) => ({ hs: (d.style && d.style.hero) || 1, ts: (d.style && d.style.title) || 1, rs: (d.style && d.style.rows) || 1 });
  const heroPx = (d, hs) => Math.round(Math.min(330, 1320 / Math.max(4, String(d.hero || "").length)) * hs);
  const headH = (d, hs, ts) => Math.round(heroPx(d, hs) * 0.82) + 26 + Math.round(68 * ts) + 40;
  function capacity(size, d) {
    const k = sc(d || {}), rowH = Math.round(56 * k.rs);
    return Math.max(3, Math.min(10, Math.floor((size.h - FOOT - headH(d || { hero: "100%" }, k.hs, k.ts) - MIN_HEAD_ROOM - 40) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = sc(d), st = d.style || {}, rowH = Math.round(56 * rs);
    const rows = d.rows.slice(0, capacity(d, d));
    const listTop = d.h - FOOT - rows.length * rowH;
    const headTop = listTop - 34 - headH(d, hs, ts);
    const photoH = listTop + 80, photoW = Math.round(Math.min(820, d.w * 0.76));
    const pips = (rec) => { const n = Math.min(12, parseInt(rec, 10) || 0); return '<span class="sa-pip"></span>'.repeat(n); };
    return `
    <div class="sa-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo
        ? `<div class="sa-photo" style="width:${photoW}px;height:${photoH}px"><img src="${d.photo.url}" alt="">
             <div class="sa-fade-l"></div><div class="sa-fade-b"></div></div>`
        : `<div class="sa-glow" style="height:${photoH}px"></div>`}
      ${d.photo && d.photo.credit ? `<div class="sa-credit">${esc(d.photo.credit)}</div>` : ""}
      ${st.showLogo === false ? "" : `<img class="sa-logo" src="${d.logo}" alt="LineHunter">`}
      <div class="sa-head" style="top:${headTop}px">
        <div class="sa-hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        <div class="sa-title" style="font-size:${Math.round(68 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sa-sub">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sa-list" style="top:${listTop}px;--rs:${rs};--rh:${rowH}px">
        ${rows.map((r, i) => `<div class="sa-row"><span class="sa-rk">${i + 1}</span><span class="sa-nm">${esc(r.n)}<i>${esc(r.t)}</i></span><span class="sa-st">${esc(r.stat)}</span><span class="sa-pips">${st.showPips === false ? "" : pips(r.rec)}</span><span class="sa-rec">${esc(r.rec)}</span></div>`).join("")}
      </div>
      <div class="sa-foot"><strong>${esc(d.footer)}</strong><p>${esc(d.note).replace(/\n/g, "<br>")}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "night-poster", name: "Night poster", photo: "duotone", capacity, render,
    tokens: { bg: "#060a16", ink: "#d8dff5", mut: "#93a1cb", accent: "#9a93ff", good: "#7fdcc0", rule: "#1f2e5a" },
    toggles: { showLogo: "Logo", showSub: "Date line", showPips: "Streak bars" },
  });
})();
