// Studio design: Night poster (dark, big "100%", the photo fades in from the top right). List sources.
// A design = { id, name, kinds, photo: "duotone" | "plain", focus, tokens, toggles, capacity(size, data), render(data) -> HTML }.
// data = { w, h, rows: [{ n, t, stat, rec }], hero, title, subtitle, footer, note, photo: { url, credit } | null, logo, logoLight, style }.
// Colors and fonts arrive as CSS variables (--c-bg, --f-head ... from studio.js), sizes in data.style. See _shared.js for the markers.
(function () {
  const K = window.StudioKit, FOOT = 210, MIN_HEAD_ROOM = 120;
  const heroPx = (d, hs) => Math.round(Math.min(330, 1320 / Math.max(4, String(d.hero || "").length)) * hs);
  const headH = (d, hs, ts) => Math.round(heroPx(d, hs) * 0.82) + 26 + Math.round(68 * ts) + 40;
  function capacity(size, d) {
    const k = K.scales(d || {}), rowH = Math.round(56 * k.rs);
    return Math.max(3, Math.min(10, Math.floor((size.h - FOOT - headH(d || { hero: "100%" }, k.hs, k.ts) - MIN_HEAD_ROOM - 40) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, rowH = Math.round(56 * rs), esc = K.esc;
    const rows = d.rows.slice(0, capacity(d, d));
    const listTop = d.h - FOOT - rows.length * rowH;
    const headTop = listTop - 34 - headH(d, hs, ts);
    const photoH = listTop + 80, photoW = Math.round(Math.min(820, d.w * 0.76));
    d.photoBox = { w: photoW, h: photoH };
    return `
    <div class="sa-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo
        ? `<div class="sa-photo" data-el="photo" style="width:${photoW}px;height:${photoH}px"><img src="${d.photo.url}" alt="">
             <div class="sa-fade-l"></div><div class="sa-fade-b"></div></div>`
        : `<div class="sa-glow" style="height:${photoH}px"></div>`}
      ${d.photo && d.photo.credit ? `<div class="sa-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      ${st.showLogo === false ? "" : `<img class="sa-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      <div class="sa-head" style="top:${headTop}px">
        <div class="sa-hero st-h" data-el="hero" data-text="hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        <div class="sa-title st-h" data-el="title" data-text="title" style="font-size:${Math.round(68 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sa-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sa-list" data-el="list" style="top:${listTop}px;--rs:${rs};--rh:${rowH}px">
        ${rows.map((r, i) => `<div class="sa-row"><span class="sa-rk">${i + 1}</span><span class="sa-nm st-h">${esc(r.n)}${K.tag(r)}</span><span class="sa-st">${esc(r.stat)}</span><span class="sa-pips">${st.showPips === false ? "" : '<span class="sa-pip"></span>'.repeat(K.pipCount(r.rec))}</span><span class="sa-rec st-h">${esc(r.rec)}</span></div>`).join("")}
      </div>
      <div class="sa-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "night-poster", name: "Night poster", kinds: ["list"], photo: "duotone", focus: { x: 50, y: 12 }, capacity, render,
    tokens: { bg: "#060a16", ink: "#d8dff5", mut: "#93a1cb", accent: "#9a93ff", good: "#7fdcc0", rule: "#1f2e5a" },
    toggles: { showLogo: "Logo", showSub: "Date line", showPips: "Streak bars", showSite: "Website" },
  });
})();
