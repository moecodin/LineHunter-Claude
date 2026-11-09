// Studio design: Ticket stub (flat accent color, arch-shaped photo with a round "100%" sticker, rows as tickets with a dashed stub).
// Same data shape as night-poster.js. tokens.rule = the ticket paper color.
(function () {
  const FOOT = 190, GAP = 14;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sc = (d) => ({ hs: (d.style && d.style.hero) || 1, ts: (d.style && d.style.title) || 1, rs: (d.style && d.style.rows) || 1 });
  const topH = (size) => Math.round(Math.min(560, size.h * 0.4));
  function capacity(size, d) {
    const k = sc(d || {}), rowH = Math.round(92 * k.rs) + GAP;
    return Math.max(3, Math.min(10, Math.floor((size.h - topH(size) - 60 - FOOT) / rowH)));
  }
  function render(d) {
    const { hs, ts, rs } = sc(d), st = d.style || {}, tH = topH(d);
    const rows = d.rows.slice(0, capacity(d, d));
    // Few rows: let the tickets grow to fill the space instead of leaving a hole above the footer.
    const avail = d.h - (tH + 50) - FOOT - 20, base = Math.round(92 * rs);
    const rowH = Math.max(base, Math.min(Math.round(base * 1.7), Math.floor(avail / Math.max(1, rows.length)) - GAP));
    const archW = Math.round(tH * 0.78), titleSize = Math.round(Math.min(118, (d.w - archW - 130) / Math.max(5, Math.max(...String(d.title).split(/\s+/).map((w) => w.length)) * 0.6)) * ts);
    const listTop = tH + 50;
    const stickerSize = Math.round(tH * 0.36);
    return `
    <div class="sd-card" style="width:${d.w}px;height:${d.h}px">
      ${st.showLogo === false ? "" : `<img class="sd-logo" src="${d.logoLight}" alt="LineHunter">`}
      <div class="sd-arch" style="width:${archW}px;height:${tH - 60}px">
        ${d.photo ? `<img src="${d.photo.url}" alt="">` : `<div class="sd-noph"><img src="${d.logo}" alt=""></div>`}
      </div>
      ${d.photo && d.photo.credit ? `<div class="sd-credit" style="top:${tH + 6}px;right:${d.w - 64 - archW}px;width:${archW}px">${esc(d.photo.credit)}</div>` : ""}
      <div class="sd-sticker" style="width:${stickerSize}px;height:${stickerSize}px;right:${64 + archW - Math.round(stickerSize * 0.45)}px;top:${tH - 60 - Math.round(stickerSize * 0.55)}px;font-size:${Math.round(stickerSize * 0.3 * hs)}px">${esc(d.hero)}</div>
      <div class="sd-head" style="top:120px;width:${d.w - archW - 150}px">
        <div class="sd-title" style="font-size:${titleSize}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sd-sub">${esc(d.subtitle)}</div>`}
      </div>
      <div class="sd-list" style="top:${listTop}px;--rs:${rs};--rh:${rowH}px;--gap:${GAP}px">
        ${rows.map((r, i) => `<div class="sd-ticket"><span class="sd-notch l"></span><span class="sd-notch r"></span><span class="sd-no">${i + 1}</span><div class="sd-info"><b>${esc(r.n)}</b><span><i>${esc(r.t)}</i>${esc(r.stat)}</span></div><div class="sd-stub">${esc(r.rec)}</div></div>`).join("")}
      </div>
      <div class="sd-foot"><strong>${esc(d.footer)}</strong><p>${esc(d.note).replace(/\n/g, "<br>")}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "ticket-stub", name: "Ticket stub", photo: "plain", capacity, render,
    tokens: { bg: "#9a93ff", ink: "#060a16", mut: "#2a2f66", accent: "#280ea1", rule: "#fbfaff" },
    toggles: { showLogo: "Logo", showSub: "Date line" },
  });
})();
