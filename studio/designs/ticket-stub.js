// Studio design: Ticket stub (flat accent color, arch-shaped photo with a round sticker, rows as tickets with a dashed stub).
// List sources. tokens.rule = the ticket paper color.
(function () {
  const K = window.StudioKit, FOOT = 190, GAP = 14;
  const topH = (size) => Math.round(Math.min(560, size.h * 0.4));
  function capacity(size, d) {
    const k = K.scales(d || {}), rowH = Math.round(92 * k.rs) + GAP;
    return Math.max(3, Math.min(10, Math.floor((size.h - topH(size) - 60 - FOOT) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, tH = topH(d), esc = K.esc;
    const rows = d.rows.slice(0, capacity(d, d));
    // Few rows: let the tickets grow to fill the space instead of leaving a hole above the footer.
    const avail = d.h - (tH + 50) - FOOT - 20, base = Math.round(92 * rs);
    const rowH = Math.max(base, Math.min(Math.round(base * 1.7), Math.floor(avail / Math.max(1, rows.length)) - GAP));
    const archW = Math.round(tH * 0.78), archH = tH - 60;
    const titleSize = Math.round(Math.min(118, (d.w - archW - 130) / Math.max(5, Math.max(...String(d.title).split(/\s+/).map((w) => w.length)) * 0.6)) * ts);
    const sticker = Math.round(tH * 0.36), heroLen = String(d.hero || "").length;
    d.photoBox = { w: archW, h: archH };
    return `
    <div class="sd-card" style="width:${d.w}px;height:${d.h}px">
      ${st.showLogo === false ? "" : `<img class="sd-logo" data-el="logo" src="${d.logoLight}" alt="LineHunter">`}
      <div class="sd-arch" data-el="photo" style="width:${archW}px;height:${archH}px">
        ${d.photo ? `<img src="${d.photo.url}" alt="">` : `<div class="sd-noph"><img src="${d.logo}" alt=""></div>`}
      </div>
      ${d.photo && d.photo.credit ? `<div class="sd-credit" data-el="credit" style="top:${tH + 6}px;right:${d.w - 64 - archW}px;width:${archW}px">${esc(d.photo.credit)}</div>` : ""}
      <div class="sd-sticker st-h" data-el="hero" data-text="hero" style="width:${sticker}px;height:${sticker}px;right:${64 + archW - Math.round(sticker * 0.45)}px;top:${archH - Math.round(sticker * 0.55)}px;font-size:${Math.round(sticker * 0.3 * hs * Math.min(1, 5 / Math.max(1, heroLen)))}px">${esc(d.hero)}</div>
      <div class="sd-head" style="top:120px;width:${d.w - archW - 150}px">
        <div class="sd-title st-h" data-el="title" data-text="title" style="font-size:${titleSize}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sd-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sd-list" data-el="list" style="top:${tH + 50}px;--rs:${rs};--rh:${rowH}px;--gap:${GAP}px">
        ${rows.map((r, i) => `<div class="sd-ticket"><span class="sd-notch l"></span><span class="sd-notch r"></span><span class="sd-no">${i + 1}</span><div class="sd-info"><b class="st-h">${esc(r.n)}</b><span>${K.tag(r)}${esc(r.stat)}</span></div><div class="sd-stub st-h">${esc(r.rec)}</div></div>`).join("")}
      </div>
      <div class="sd-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "ticket-stub", name: "Ticket stub", kinds: ["list"], photo: "plain", focus: { x: 50, y: 25 }, capacity, render,
    tokens: { bg: "#9a93ff", ink: "#060a16", mut: "#2a2f66", accent: "#280ea1", rule: "#fbfaff" },
    toggles: { showLogo: "Logo", showSub: "Date line", showSite: "Website" },
  });
})();
