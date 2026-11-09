// Studio design: Player card (one player + one prop: photo, name, the hit count, and a bar chart of the window's games vs the line).
// Player sources only. data.player = { first, last, team, code, line, side, games: [{ v, hit, opp, date }] oldest first, hits, total, avg, win }.
(function () {
  const K = window.StudioKit, FOOT = 190;
  function render(d) {
    const p = d.player, st = d.style || {}, { hs, ts, rs } = K.scales(d), esc = K.esc;
    const ph = Math.round(d.h * 0.42);
    d.photoBox = { w: d.w, h: ph };
    const max = Math.max(p.line * 1.25, ...p.games.map((g) => g.v), 1);
    const linePct = Math.min(96, (p.line / max) * 100);
    const lastSize = Math.round(Math.min(118, 900 / Math.max(5, String(d.name || "").split(" ").slice(1).join(" ").length * 0.62)) * ts);
    const parts = String(d.name || "").split(" "), first = parts.shift() || "", last = parts.join(" ");
    // Each column: a slot the bar grows in (the value sits on top of the bar), then the opponent under it.
    const bars = p.games.map((g) => `<div class="sp-col"><div class="sp-slot"><div class="sp-bar${g.hit ? " hit" : ""}" style="height:${Math.max(2, (g.v / max) * 100)}%">${st.showValues === false ? "" : `<span class="sp-val">${esc(g.v)}</span>`}</div></div><span class="sp-opp">${esc(g.opp)}</span></div>`).join("");
    return `
    <div class="sp-card" style="width:${d.w}px;height:${d.h}px">
      ${d.photo ? `<div class="sp-photo" data-el="photo" style="height:${ph}px"><img src="${d.photo.url}" alt="">${st.naturalPhoto === false ? '<div class="sp-night"></div>' : ""}<div class="sp-fade"></div></div>` : `<div class="sp-glow" style="height:${ph}px"></div>`}
      ${st.showLogo === false ? "" : `<img class="sp-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      ${d.photo && d.photo.credit ? `<div class="sp-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="sp-body" style="top:${ph - 170}px;--rs:${rs}">
        <div data-el="name" data-text="name"><div class="sp-first">${esc(first)} ${p.team ? `<i>${esc(p.team)}</i>` : ""}</div><div class="sp-last st-h" style="font-size:${lastSize}px">${esc(last)}</div></div>
        ${st.showSub === false ? "" : `<div class="sp-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
        <div class="sp-stat">
          <div class="sp-hero st-h" data-el="hero" data-text="hero" style="font-size:${Math.round(150 * hs * Math.min(1, 5 / Math.max(1, String(d.hero).length)))}px">${esc(d.hero)}</div>
          <div class="sp-pick"><div class="sp-title st-h" data-el="title" data-text="title" style="font-size:${Math.round(46 * ts)}px">${esc(d.title)}</div>
            <div class="sp-meta">L${p.win} · ${p.total ? Math.round((p.hits / p.total) * 100) : 0}% · avg ${p.avg.toFixed(1)}</div></div>
        </div>
        <div class="sp-chart" data-el="list">
          <div class="sp-cols">${bars}</div>
          <div class="sp-plot"><div class="sp-line" style="bottom:${linePct}%"><span>${esc(p.line)}</span></div></div>
        </div>
      </div>
      <div class="sp-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "player-card", name: "Player card", kinds: ["player"], photo: "plain", fade: 45,
    // "Natural photo" off = the Night poster look: the photo in duotone (card color to purple) plus a soft purple wash on top.
    photoModeFor: (off) => (off.naturalPhoto ? "duotone" : "color"), focus: { x: 50, y: 20 }, capacity: () => 0, render,
    tokens: { bg: "#060a16", ink: "#f4f6ff", mut: "#93a1cb", accent: "#9a93ff", good: "#46a98f", rule: "#1f2e5a" },
    toggles: { naturalPhoto: "Natural photo", showLogo: "Logo", showSub: "Matchup line", showValues: "Bar numbers", showSite: "Website" },
  });
})();
