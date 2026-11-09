// Studio design: Night poster (dark, big "100%", the photo fades in from the top right).
// A design = { id, name, photo: "duotone" | "plain", capacity(size), render(data) -> HTML string }.
// data = { w, h, rows: [{ n, t, stat, rec }], hero, title, subtitle, footer, note, photo: { url, credit } | null, logo }.
// Only things html2canvas can draw: plain gradients, no blend modes or masks (the photo is tinted in studio.js before it gets here).
(function () {
  const ROW_H = 56, FOOT = 210, HEAD_H = 405, MIN_HEAD_ROOM = 120;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function capacity(size) { return Math.max(3, Math.min(10, Math.floor((size.h - FOOT - HEAD_H - MIN_HEAD_ROOM - 40) / ROW_H))); }
  function render(d) {
    const rows = d.rows.slice(0, capacity(d));
    const listTop = d.h - FOOT - rows.length * ROW_H;
    const headTop = listTop - 34 - HEAD_H;
    const heroSize = Math.round(Math.min(330, 1320 / Math.max(4, d.hero.length)));
    const photoH = listTop + 80, photoW = Math.round(Math.min(820, d.w * 0.76));
    const pips = (rec) => { const n = Math.min(12, parseInt(rec, 10) || 0); return '<span class="sa-pip"></span>'.repeat(n); };
    return `
    <div class="sa-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo
        ? `<div class="sa-photo" style="width:${photoW}px;height:${photoH}px"><img src="${d.photo.url}" alt="">
             <div class="sa-fade-l"></div><div class="sa-fade-b"></div></div>`
        : `<div class="sa-glow" style="height:${photoH}px"></div>`}
      ${d.photo && d.photo.credit ? `<div class="sa-credit">${esc(d.photo.credit)}</div>` : ""}
      <img class="sa-logo" src="${d.logo}" alt="LineHunter">
      <div class="sa-head" style="top:${headTop}px">
        <div class="sa-hero" style="font-size:${heroSize}px">${esc(d.hero)}</div>
        <div class="sa-title">${esc(d.title)}</div>
        <div class="sa-sub">${esc(d.subtitle)}</div>
      </div>
      <div class="sa-list" style="top:${listTop}px">
        ${rows.map((r, i) => `<div class="sa-row"><span class="sa-rk">${i + 1}</span><span class="sa-nm">${esc(r.n)}<i>${esc(r.t)}</i></span><span class="sa-st">${esc(r.stat)}</span><span class="sa-pips">${pips(r.rec)}</span><span class="sa-rec">${esc(r.rec)}</span></div>`).join("")}
      </div>
      <div class="sa-foot"><strong>${esc(d.footer)}</strong><p>${esc(d.note).replace(/\n/g, "<br>")}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({ id: "night-poster", name: "Night poster", photo: "duotone", capacity, render });
})();
