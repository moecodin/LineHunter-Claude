// Studio design: Big stat (one huge number, the player in front of it, the other stats around him without frames). List sources;
// made for the Research source "Player stats" (rows = stats: n = label, rec = value), but any list works (n = name, rec = record).
// Switch "Team color": on = the team's color behind everything, photo in color; off = black, photo in black and white, numbers in the
// highlight color. The big number follows the Style panel's "Big text size" slider (up to 220%). Cut-out PNGs keep their transparency
// (alpha: true), so a player photo with no background stands in front of the number like the reference poster.
(function () {
  const K = window.StudioKit, FOOT = 190;
  const rgb = (hex) => { const n = parseInt(String(hex || "#000000").slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(","); };
  function capacity() { return 6; }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, esc = K.esc, team = st.teamColor !== false;
    const bg = d.cardBg || (team ? "#1d2a52" : "#0b0b0b");
    // The big number's own stat isn't repeated around the player.
    const rows = d.rows.filter((r) => !(d.kicker && String(r.n).toLowerCase() === String(d.kicker).toLowerCase())).slice(0, capacity());
    const top = 150, heroLen = Math.max(2, String(d.hero || "").length);
    const heroTop = top + 70, kickH = st.showKicker === false ? 0 : 36;
    // The slider can grow the number, but its bottom stays above ~52% of the card so the photo and the stats keep room.
    const heroMax = Math.max(120, (d.h * 0.52 - heroTop - kickH) / 0.86);
    const heroPx = Math.round(Math.min(heroMax, Math.min(380, 1150 / heroLen) * hs));
    // A cut-out stands in front of the number (its head over the lower half); a photo with a background starts under the number,
    // narrower, with its edges faded into the card so the stats beside it stay readable.
    const cut = !!(d.photo && d.photo.cutout);
    const heroBottom = heroTop + kickH + Math.round(heroPx * 0.86);
    const photoTop = cut ? heroTop + kickH + Math.round(heroPx * 0.35) : heroBottom + 10;
    const photoBottom = d.h - FOOT + 20, photoH = Math.max(200, photoBottom - photoTop);
    const photoW = Math.round(Math.min(d.w * (cut ? 0.64 : 0.58), photoH * (cut ? 0.9 : 0.95))); // the side columns stay clear
    d.photoBox = { w: photoW, h: photoH };
    // Stats: left column 0, 2, 4 and right column 1, 3, 5 (the right one a half step lower), between under the big number and the footer.
    const areaTop = Math.min(d.h - FOOT - 300, heroBottom + 40), areaBot = d.h - FOOT - 40;
    const perCol = Math.max(1, Math.ceil(rows.length / 2)), step = (areaBot - areaTop) / perCol;
    // Smaller cards (square) shrink the stats to the room each one has, so they never run into each other.
    const numPx = Math.round(Math.min(78 * rs, step * 0.52)), labPx = Math.round(Math.max(14, Math.min(21 * rs, step * 0.15)));
    const items = rows.map((r, i) => {
      const right = i % 2 === 1, slot = Math.floor(i / 2), y = Math.round(areaTop + step * slot + (right ? step * 0.45 : 0));
      return `<div class="sx-it${right ? " r" : ""}" style="top:${y}px"><b class="st-h" style="font-size:${numPx}px">${esc(r.rec)}</b><span style="font-size:${labPx}px">${esc(r.n)}</span></div>`;
    }).join("");
    return `
    <div class="sx-card ${team ? "is-team" : "is-mono"}" style="width:${d.w}px;height:${d.h}px;--c-bg:${bg};--c-bg-rgb:${rgb(bg)}">
      ${st.showSub === false && st.showLogo === false ? "" : ""}
      <div class="sx-head" data-el="title"><div class="sx-name st-h" data-text="title" style="font-size:${Math.round(44 * ts)}px">${esc(d.title)}</div>
        ${st.showSub === false ? "" : `<div class="sx-sub" data-el="sub" data-text="subtitle">${esc(d.subtitle)}</div>`}</div>
      ${st.showLogo === false ? "" : `<img class="sx-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      <div class="sx-rule" style="top:${top}px"></div>
      <div class="sx-heroWrap" data-el="hero" style="top:${heroTop}px">${st.showKicker === false ? "" : `<div class="sx-kick" data-text="kicker">${esc(d.kicker || "")}</div>`}<div class="sx-hero st-h" data-text="hero" style="font-size:${heroPx}px">${esc(d.hero)}</div></div>
      ${d.photo ? `<div class="sx-photo${cut ? " is-cut" : ""}" data-el="photo" style="width:${photoW}px;height:${photoH}px;top:${photoTop}px"><img src="${d.photo.url}" alt="">${cut ? "" : '<div class="sx-fl"></div><div class="sx-fr"></div><div class="sx-ft"></div>'}<div class="sx-fade"></div></div>` : ""}
      ${d.photo && d.photo.credit ? `<div class="sx-credit" data-el="credit">${esc(d.photo.credit)}</div>` : ""}
      <div class="sx-list" data-el="list">${items}</div>
      <div class="sx-foot" data-el="foot">${K.site(d)}<strong data-text="footer">${esc(d.footer)}</strong><p>${K.note(d)}</p></div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "big-stat", name: "Big stat", kinds: ["list"], photo: "plain", alpha: true, teamSwitch: true, focus: { x: 50, y: 30 }, capacity, render,
    photoModeFor: (off) => (off.teamColor ? "bw" : "color"),
    tokens: { bg: "#0b0b0b", ink: "#f2ebdd", mut: "#cfc8ba", accent: "#f2ebdd", good: "#5dcaa5", rule: "#ffffff" },
    toggles: { teamColor: "Team color", showLogo: "Logo", showSub: "Date line", showKicker: "Big number label", showSite: "Website" },
  });
})();
