// Studio design: Night edition (Night poster colors; made for the betting sources: Streaks, Hit List cards, The Board, Matchups, BBQ, Brick).
// The #1 row's player is the photo (the Studio's auto photo already follows the top row), in halftone dots, filling the right side and
// fading into the card; switch "Photo on the side" off and it fills the whole card, darkened. Behind the title the big text ("100%",
// "L10") is a faint condensed wall. Rows are the Night poster's clean ruled lines: rank, name + team tag, stat, streak pips, record.
// A thin vertical line of text runs up the right edge. List sources.
(function () {
  const K = window.StudioKit, FOOT = 200;
  const layout = (d) => {
    const { rs } = K.scales(d), base = Math.round(64 * rs);
    const titleTop = Math.round(Math.max(210, d.h * 0.17)), rowsTop = titleTop + 200, room = d.h - FOOT - 50 - rowsTop;
    const cap = Math.max(3, Math.min(10, Math.floor(room / base)));
    // Fewer rows than fit: they get taller (up to 1.6x) so the list reaches down to the footer instead of leaving a hole.
    const n = Math.min(cap, (d.rows || []).length || cap);
    const rowH = Math.round(Math.min(base * 1.6, Math.max(base, room / Math.max(1, n))));
    // Still room left (a tall story card): the title and the rows sit low, the photo gets the open top like a poster.
    const spare = Math.max(0, room - rowH * n), drop = Math.round(spare * 0.85);
    return { rowH, titleTop: titleTop + drop, rowsTop: rowsTop + drop, cap };
  };
  function capacity(size, d) { return layout({ ...(d || {}), w: size.w, h: size.h }).cap; }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, esc = K.esc, L = layout(d), side = st.sidePhoto !== false;
    const rows = d.rows.slice(0, L.cap);
    const wallPx = Math.round(Math.min(360, 1500 / Math.max(3, String(d.hero || "").length)) * hs);
    const photoW = side ? Math.round(d.w * 0.66) : d.w, photoH = side ? Math.round(d.h * 0.74) : d.h;
    d.photoBox = { w: photoW, h: photoH };
    const edge = `NBA · ${d.title || ""} · LINEHUNTERAPP.COM`.toUpperCase();
    return `
    <div class="ne-card${side ? "" : " is-full"}" style="width:${d.w}px;height:${d.h}px">
      ${d.photo ? `<div class="ne-photo" data-el="photo" style="width:${photoW}px;height:${photoH}px"><img src="${d.photo.url}" alt="">${side ? '<div class="ne-fl"></div><div class="ne-fb"></div>' : '<div class="ne-dim"></div>'}</div>` : `<div class="ne-glow"></div>`}
      ${d.photo && d.photo.credit ? `<div class="ne-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="ne-wall" data-el="hero" data-text="hero" style="font-size:${wallPx}px;top:${Math.max(70, L.titleTop - Math.round(wallPx * 0.62))}px">${esc(d.hero)}</div>
      ${st.showLogo === false ? "" : `<img class="ne-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      <div class="ne-head" style="top:${L.titleTop}px">
        <div class="ne-title st-h" data-el="title" data-text="title" style="font-size:${Math.round(78 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="ne-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}
      </div>
      <div class="ne-list" data-el="list" style="top:${L.rowsTop}px;--rs:${rs};--rh:${L.rowH}px">
        ${rows.map((r, i) => `<div class="ne-row"><span class="ne-rk">${i + 1}</span><span class="ne-nm st-h">${esc(r.n)}${K.tag(r)}</span><span class="ne-st">${esc(r.stat)}</span><span class="ne-pips">${st.showPips === false ? "" : '<b></b>'.repeat(K.pipCount(r.rec))}</span><span class="ne-rec st-h">${esc(r.rec)}</span></div>`).join("")}
      </div>
      ${st.showEdge === false ? "" : `<div class="ne-edge" data-el="edge" style="top:${Math.round(L.rowsTop + 10)}px"><span>${esc(edge)}</span></div>`}
      <div class="ne-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "night-edition", name: "Night edition", kinds: ["list"], photo: "duotone", focus: { x: 50, y: 18 }, capacity, render,
    photoModeFor: () => "halftone",
    tokens: { bg: "#060a16", ink: "#d8dff5", mut: "#93a1cb", accent: "#9a93ff", good: "#7fdcc0", rule: "#1f2e5a" },
    toggles: { sidePhoto: "Photo on the side", showLogo: "Logo", showSub: "Date line", showPips: "Streak bars", showEdge: "Edge text", showSite: "Website" },
  });
})();
