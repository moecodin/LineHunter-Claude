// Studio design: Spotlight (full-bleed color photo, big "100%", the rows as glass cards at the bottom). List sources.
(function () {
  const K = window.StudioKit, FOOT = 190, GAP = 10;
  const heroPx = (d, hs) => Math.round(Math.min(210, 840 / Math.max(4, String(d.hero || "").length)) * hs);
  const headH = (d, hs, ts) => Math.round(heroPx(d, hs) * 0.85) + 20 + Math.round(58 * ts) + 44;
  function capacity(size, d) {
    const k = K.scales(d || {}), rowH = Math.round(72 * k.rs) + GAP;
    return Math.max(3, Math.min(8, Math.floor((size.h - FOOT - 130 - headH(d || { hero: "100%" }, k.hs, k.ts) - 40) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, cardH = Math.round(72 * rs), esc = K.esc;
    const rows = d.rows.slice(0, capacity(d, d));
    const listTop = d.h - FOOT - rows.length * (cardH + GAP) + GAP;
    const headTop = listTop - 30 - headH(d, hs, ts);
    d.photoBox = { w: d.w, h: d.h };
    return `
    <div class="sc-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo ? `<img class="sc-photo" data-el="photo" src="${d.photo.url}" alt="">` : `<div class="sc-nophoto"></div>`}
      <div class="sc-top"></div>
      <div class="sc-shade" style="top:${Math.max(0, headTop - 260)}px"></div>
      ${st.showLogo === false ? "" : `<img class="sc-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      ${d.photo && d.photo.credit ? `<div class="sc-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="sc-head" style="top:${headTop}px">
        <div class="sc-hero st-h" data-el="hero" data-text="hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        <div class="sc-title st-h" data-el="title" data-text="title" style="font-size:${Math.round(58 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sc-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sc-list" data-el="list" style="top:${listTop}px;--rs:${rs};--rh:${cardH}px">
        ${rows.map((r, i) => `<div class="sc-row"><span class="sc-rk">${i + 1}</span><span class="sc-nm st-h">${esc(r.n)}${K.tag(r)}</span><span class="sc-st">${esc(r.stat)}</span><span class="sc-rec st-h">${esc(r.rec)}</span></div>`).join("")}
      </div>
      <div class="sc-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "spotlight", name: "Spotlight", kinds: ["list"], photo: "plain", focus: { x: 50, y: 30 }, capacity, render,
    tokens: { bg: "#060a16", ink: "#f4f6ff", mut: "#b9c3e6", accent: "#9a93ff", good: "#7fdcc0", rule: "#ffffff" },
    toggles: { showLogo: "Logo", showSub: "Date line", showSite: "Website" },
  });
})();
