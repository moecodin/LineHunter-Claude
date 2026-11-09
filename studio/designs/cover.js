// Studio design: Cover (the photo fills the whole card; everything sits low over a dark scrim). Player and list sources.
// Player: first name + team small, the last name huge (Bebas Neue), the hit count, the pick, one square per game (teal = hit).
// List: the kicker small, the title huge, then ruled rows; the photo is the top row's player (the Studio's auto photo).
// Top: logo left, the subtitle as a small outlined tag right. Every photo Look, Fade and Vignette apply to the full-card photo.
(function () {
  const K = window.StudioKit, FOOT = 120, PAD = 64;
  const bebas = (txt, px, maxW) => Math.min(px, Math.round(maxW / Math.max(1, String(txt || "").length * 0.42)));
  function listLayout(d) {
    const { ts, rs } = K.scales(d), rowH = Math.round(62 * rs);
    const cap = Math.max(3, Math.min(8, Math.floor((d.h * 0.5 - 220) / rowH)));
    const titlePx = Math.round(bebas(d.title, 150, d.w - PAD * 2) * ts);
    return { rowH, cap, titlePx };
  }
  function capacity(size, d) { return d && d.player ? 0 : listLayout({ ...(d || {}), w: size.w, h: size.h }).cap; }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, esc = K.esc;
    d.photoBox = { w: d.w, h: d.h };
    let low, contentH;
    if (d.player) {
      const p = d.player, parts = String(d.name || "").split(" "), first = parts.shift() || "", last = parts.join(" ");
      const lastPx = Math.round(bebas(last, 240, d.w - PAD * 2) * ts), heroPx = Math.round(150 * hs * Math.min(1, 5 / Math.max(1, String(d.hero).length)));
      const dots = st.showPips === false ? "" : `<div class="cv-dots">${p.games.map((g) => `<i class="${g.hit ? "h" : ""}"></i>`).join("")}</div>`;
      low = `<div data-el="name" data-text="name"><div class="cv-k">${esc(first)}${p.team ? ` · ${esc(p.team)}` : ""}</div><div class="cv-big" style="font-size:${lastPx}px">${esc(last)}</div></div>
        <div class="cv-pick"><div class="cv-hero st-h" data-el="hero" data-text="hero" style="font-size:${heroPx}px">${esc(d.hero)}</div>
          <div><div class="cv-title st-h" data-el="title" data-text="title" style="font-size:${Math.round(48 * ts)}px">${esc(d.title)}</div>
          <div class="cv-meta">Last ${p.total} · avg ${p.avg.toFixed(1)} ${esc(p.code)}</div></div></div>${dots}`;
      contentH = lastPx * 0.9 + 40 + heroPx + (dots ? 70 : 0) + 40;
    } else {
      const L = listLayout(d), rows = d.rows.slice(0, L.cap);
      low = `${st.showKicker === false ? "" : `<div class="cv-k" data-el="kicker" data-text="kicker">${esc(d.kicker || "")}</div>`}
        <div class="cv-big" data-el="title" data-text="title" style="font-size:${L.titlePx}px">${esc(d.title)}</div>
        <div class="cv-list" data-el="list" style="--rs:${rs};--rh:${L.rowH}px">${rows.map((r) => `<div class="cv-row"><span class="cv-nm st-h">${esc(r.n)}${K.tag(r)}</span><span class="cv-st">${esc(r.stat)}</span><span class="cv-rec st-h">${esc(r.rec)}</span></div>`).join("")}</div>`;
      contentH = 40 + L.titlePx * 0.9 + 30 + rows.length * L.rowH;
    }
    // The scrim turns dark a little above where the text starts, whatever the photo.
    const start = Math.max(0.2, Math.min(0.75, (d.h - FOOT - 70 - contentH) / d.h)), a = (start - 0.16) * 100, b = (start + 0.06) * 100;
    return `
    <div class="cv-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo ? `<div class="cv-photo" data-el="photo"><img src="${d.photo.url}" alt=""></div>` : `<div class="cv-glow"></div>`}
      <div class="cv-scrim" style="background:linear-gradient(180deg,rgba(var(--c-bg-rgb),.4) 0%,rgba(var(--c-bg-rgb),0) 16%,rgba(var(--c-bg-rgb),0) ${a.toFixed(1)}%,rgba(var(--c-bg-rgb),.82) ${b.toFixed(1)}%,var(--c-bg) ${Math.min(100, b + 18).toFixed(1)}%)"></div>
      ${st.showLogo === false ? "" : `<img class="cv-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      ${st.showSub === false ? "" : `<div class="cv-tag" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
      ${d.photo && d.photo.credit ? `<div class="cv-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="cv-low" style="bottom:${FOOT + 46}px">${low}</div>
      <div class="cv-foot" data-el="foot"><strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p>${K.site(d)}</div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "cover", name: "Cover", kinds: ["list", "player"], photo: "plain", focus: { x: 50, y: 22 }, capacity, render,
    tokens: { bg: "#060a16", ink: "#f2f0fa", mut: "#b8bdd6", accent: "#b9b4ff", good: "#7fdcc0", rule: "#f2f0fa" },
    toggles: { showLogo: "Logo", showSub: "Top tag", showKicker: "Small label", showPips: "Game squares", showSite: "Website" },
  });
})();
