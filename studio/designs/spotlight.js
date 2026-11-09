// Studio design: Spotlight (full-bleed color photo, big "100%", the rows as frosted glass cards at the bottom).
// Same data shape as night-poster.js. Colors / fonts come in as CSS variables from studio.js.
(function () {
  const FOOT = 190, GAP = 10;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sc = (d) => ({ hs: (d.style && d.style.hero) || 1, ts: (d.style && d.style.title) || 1, rs: (d.style && d.style.rows) || 1 });
  const heroPx = (d, hs) => Math.round(Math.min(210, 840 / Math.max(4, String(d.hero || "").length)) * hs);
  const headH = (d, hs, ts) => Math.round(heroPx(d, hs) * 0.85) + 20 + Math.round(58 * ts) + 44;
  function capacity(size, d) {
    const k = sc(d || {}), rowH = Math.round(72 * k.rs) + GAP;
    return Math.max(3, Math.min(8, Math.floor((size.h - FOOT - 130 - headH(d || { hero: "100%" }, k.hs, k.ts) - 40) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = sc(d), st = d.style || {}, cardH = Math.round(72 * rs);
    const rows = d.rows.slice(0, capacity(d, d));
    const listTop = d.h - FOOT - rows.length * (cardH + GAP) + GAP;
    const headTop = listTop - 30 - headH(d, hs, ts);
    return `
    <div class="sc-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo ? `<img class="sc-photo" src="${d.photo.url}" alt="">` : `<div class="sc-nophoto"></div>`}
      <div class="sc-top"></div>
      <div class="sc-shade" style="top:${Math.max(0, headTop - 260)}px"></div>
      ${st.showLogo === false ? "" : `<img class="sc-logo" src="${d.logo}" alt="LineHunter">`}
      ${d.photo && d.photo.credit ? `<div class="sc-credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="sc-head" style="top:${headTop}px">
        <div class="sc-hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        <div class="sc-title" style="font-size:${Math.round(58 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sc-sub">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sc-list" style="top:${listTop}px;--rs:${rs};--rh:${cardH}px">
        ${rows.map((r, i) => `<div class="sc-row"><span class="sc-rk">${i + 1}</span><span class="sc-nm">${esc(r.n)}<i>${esc(r.t)}</i></span><span class="sc-st">${esc(r.stat)}</span><span class="sc-rec">${esc(r.rec)}</span></div>`).join("")}
      </div>
      <div class="sc-foot"><strong>${esc(d.footer)}</strong><p>${esc(d.note).replace(/\n/g, "<br>")}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "spotlight", name: "Spotlight", photo: "plain", capacity, render,
    tokens: { bg: "#060a16", ink: "#f4f6ff", mut: "#b9c3e6", accent: "#9a93ff", good: "#7fdcc0", rule: "#ffffff" },
    toggles: { showLogo: "Logo", showSub: "Date line" },
  });
})();
