// Studio design: Paper scoreboard (light, framed photo on an accent block, big record numerals). List sources.
(function () {
  const K = window.StudioKit, FOOT = 150;
  function titleFit(title, ts) {
    const words = String(title).split(/\s+/).filter(Boolean);
    const longest = Math.max(4, ...words.map((w) => w.length));
    return { words, size: Math.round(Math.min(150, 500 / (longest * 0.6)) * ts) };
  }
  const heroPx = (d, hs) => Math.round(Math.min(150, 560 / Math.max(3, String(d.hero || "").length * 0.62)) * hs);
  function headHeight(d) { const k = K.scales(d), t = titleFit(d.title, k.ts); return 24 + 10 + Math.round(heroPx(d, k.hs) * 0.9) + t.words.length * Math.round(t.size * 0.9) + 18 + 30 + 34; }
  function capacity(size, d) {
    const k = K.scales(d || {}), head = d ? headHeight(d) : 420;
    return Math.max(3, Math.min(10, Math.floor((size.h - 60 - head - FOOT - 20) / Math.round(92 * k.rs))));
  }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, rowH = Math.round(92 * rs), t = titleFit(d.title, ts), esc = K.esc, norm = K.norm;
    const rows = d.rows.slice(0, capacity(d, d));
    const frameH = d.h - 96 - 240;
    d.photoBox = { w: 400, h: frameH };
    const pn = d.photo && d.photo.player ? norm(d.photo.player) : "";
    const lead = d.photo ? d.rows.find((r) => norm(r.full || r.n) === pn || (norm(r.full || r.n).split(" ").pop() === pn.split(" ").pop() && norm(r.full || r.n)[0] === pn[0])) : d.rows[0];
    const cap = d.photo && d.photo.player
      ? `<b>${esc(d.photo.player)}</b>${lead ? `<span>${esc(lead.stat)} · ${esc(lead.rec)}</span>` : ""}`
      : lead ? `<b>${esc(lead.n)}</b><span>${esc(lead.stat)} · ${esc(lead.rec)}</span>` : "";
    return `
    <div class="sb-card" style="width:${d.w}px;height:${d.h}px">
      <div class="sb-block" data-el="block" style="height:${frameH}px"></div>
      <div class="sb-frame" data-el="photo" style="height:${frameH}px">
        ${d.photo ? `<img src="${d.photo.url}" alt="">` : `<div class="sb-nophoto"><img src="${d.logo}" alt=""></div>`}
        ${cap ? `<div class="sb-cap">${cap}</div>` : ""}
      </div>
      ${d.photo && d.photo.credit ? `<div class="sb-credit" data-el="credit" style="top:${96 + frameH + 10}px">${esc(d.photo.credit)}</div>` : ""}
      <div class="sb-right">
        ${st.showKicker === false ? "" : `<div class="sb-kick" data-el="kicker" data-text="kicker">${esc(d.kicker || "Tonight's research")}</div>`}
        <div class="sb-hero st-h" data-el="hero" data-text="hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        <div data-el="title" data-text="title">${t.words.map((w) => `<div class="sb-title st-h" style="font-size:${t.size}px">${esc(w)}</div>`).join("")}</div>
        ${st.showSub === false ? "" : `<div class="sb-date" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
        <div class="sb-list" data-el="list" style="--rs:${rs};--rh:${rowH}px">
          ${rows.map((r) => `<div class="sb-row"><div class="sb-nm st-h">${esc(r.n)}<span>${K.tag(r)}${esc(r.stat)}</span></div><div class="sb-rec st-h" style="font-size:${Math.round((String(r.rec).length > 5 ? 36 : 48) * rs)}px">${esc(r.rec)}</div></div>`).join("")}
        </div>
      </div>
      <div class="sb-foot" data-el="foot"><p><strong data-text="footer">${esc(d.footer)}</strong><br>${K.note(d)}</p><div class="sb-right">${K.site(d)}${st.showLogo === false ? "" : `<img src="${d.logoLight}" alt="LineHunter">`}</div></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "paper-scoreboard", name: "Paper scoreboard", kinds: ["list"], photo: "plain", focus: { x: 46, y: 15 }, capacity, render,
    tokens: { bg: "#eef1fa", ink: "#052350", mut: "#4c5a85", accent: "#280ea1", rule: "#d8dff5" },
    toggles: { showLogo: "Logo", showSub: "Date line", showKicker: "Top label", showSite: "Website" },
  });
})();
