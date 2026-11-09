// Studio design: App promo (Night poster look). Three layouts, picked by the App promo source:
//   feature = small label, two-line headline (line 2 in the accent), the points (rows), a call to action, one screenshot in a phone frame
//   hook    = the faint background word, the big headline, "Swipe →", two phones (tilted unless the switch is off)
//   closing = the headline centered, the site address in an outlined box, the call to action, a strip of up to 5 phones with labels
// Screenshots come from the marketing kit (studio/photos/shots/); each frame shows the top of its screenshot. Promo sources only.
(function () {
  const K = window.StudioKit, FOOT = 120;
  const phone = (s, st, extra) => `<div class="pm-phone" style="${st}">${s && s.ok ? `<img src="${s.url}" alt="">` : `<div class="pm-miss">${K.esc(s ? s.file : "")}<br>missing</div>`}</div>${extra || ""}`;
  function capacity(size, d) { const l = d && d.promo ? d.promo.layout : "feature"; return l === "closing" ? 5 : l === "hook" ? 0 : 5; }
  function render(d) {
    const { hs, ts, rs } = K.scales(d), st = d.style || {}, esc = K.esc, P = d.promo || { layout: "feature", shots: [], have: [] };
    const shots = P.shots.map((s) => ({ ...s, ok: P.have.includes(s.file) })), tilt = st.tilt !== false, W = d.w, H = d.h;
    const head = (px, align) => `
      ${st.showKicker === false ? "" : `<div class="pm-k" data-el="kicker" data-text="kicker" style="text-align:${align}">${esc(d.kicker)}</div>`}
      <div class="pm-h st-h" data-el="title" style="font-size:${px}px;text-align:${align}"><span data-text="title">${esc(d.title)}</span><br><em data-text="hero">${esc(d.hero)}</em></div>`;
    let body = "";
    const kick = st.showKicker === false ? 0 : 40, headH = (px) => kick + 18 + px * 0.98 * 2;
    if (P.layout === "hook") {
      // Headline, "Swipe →" under it, then two phones that run off the bottom (more room on a story card = bigger phones).
      const hp = Math.round(116 * ts), textTop = Math.round(H * 0.14), textBot = textTop + headH(hp) + 70;
      const phTop = Math.round(textBot + Math.min(140, H * 0.06)), ph = Math.round(Math.min(W * (H / W > 1.5 ? 0.47 : 0.41), (H - phTop) * 0.62)), phH = Math.round(ph * 2.16);
      body = `${P.wall ? `<div class="pm-wall" data-el="hero" style="font-size:${Math.round(360 * hs)}px;top:${Math.max(110, textTop - 60)}px">${esc(P.wall)}</div>` : ""}
        <div class="pm-top" style="top:${textTop}px">${head(hp, "left")}<div class="pm-cta" data-el="sub" data-text="footer">${esc(d.footer)}</div></div>
        ${phone(shots[0], `left:${Math.round(W * 0.08)}px;top:${phTop + 70}px;width:${ph}px;height:${phH}px;transform:rotate(${tilt ? -6 : 0}deg)`)}
        ${phone(shots[1], `right:${Math.round(W * 0.08)}px;top:${phTop}px;width:${ph}px;height:${phH}px;transform:rotate(${tilt ? 5 : 0}deg)`)}
        <div class="pm-scrim"></div>`;
    } else if (P.layout === "closing") {
      // Headline, site box and call to action, then the strip; the whole group is centered in the room above the footer.
      const rows = d.rows.slice(0, 5), n = Math.max(1, rows.length), gap = 16, w = Math.floor((W - 128 - gap * (n - 1)) / n);
      let hh = Math.round(w * (H / W > 1.5 ? 1.9 : 1.5));
      const hp = Math.round(104 * ts), textH = headH(hp) + 52 + 112 + 70;
      hh = Math.max(120, Math.min(hh, H - FOOT - 60 - 150 - textH - 90 - 50)); // a short (square) card: smaller screens so the labels clear the footer
      const groupH = textH + 90 + hh + 40;
      const top = Math.max(150, Math.round((H - FOOT - groupH) / 2 + 30));
      body = `<div class="pm-top pm-center" style="top:${top}px">${head(hp, "center")}
          <div class="pm-site">linehunterapp.com</div><div class="pm-sub2" data-el="sub" data-text="footer">${esc(d.footer)}</div></div>
        <div class="pm-strip" data-el="list" style="top:${top + textH + 90}px;gap:${gap}px">${rows.map((r, i) => `<div style="width:${w}px">${phone(shots[i], `position:relative;width:${w}px;height:${hh}px;border-radius:26px;border-width:3px`)}<div class="pm-lab">${esc(r.n)}</div></div>`).join("")}</div>`;
    } else {
      const rows = d.rows.slice(0, 5), desk = /desktop/.test(shots[0] ? shots[0].file : ""), stack = desk || H / W > 1.5;
      const pts = `<ul class="pm-pts" data-el="list" style="--rs:${rs}">${rows.map((r) => `<li>${esc(r.n)}</li>`).join("")}</ul>${d.footer ? `<div class="pm-cta2" data-el="sub" data-text="footer">${esc(d.footer)}</div>` : ""}`;
      if (stack) {
        // Tall card or a desktop screenshot: text on top across the card, the screen below it (browser frame for desktop shots).
        const hp = Math.round(88 * ts), textTop = 170, textH = headH(hp) + 36 + rows.length * 54 * rs + (d.footer ? 60 : 0), sTop = Math.round(textTop + textH + 50);
        const room = H - FOOT - 30 - sTop;
        const frame = desk ? `<div class="pm-browser" style="left:64px;right:64px;top:${sTop}px;height:${Math.max(200, Math.min(room, Math.round((W - 128) * 0.66)))}px"><div class="pm-bar"><i></i><i></i><i></i></div>${shots[0] && shots[0].ok ? `<img src="${shots[0].url}" alt="">` : ""}</div>`
          : phone(shots[0], `left:50%;margin-left:-${Math.round(Math.min(W * 0.56, room / 2.0) / 2)}px;top:${sTop}px;width:${Math.round(Math.min(W * 0.56, room / 2.0))}px;height:${room + 60}px`);
        body = `<div class="pm-top" style="top:${textTop}px">${head(hp, "left")}${pts}</div>${frame}<div class="pm-scrim" style="height:${FOOT + 90}px"></div>`;
      } else {
        const pw = Math.round(W * 0.4), top = 184, phH = Math.min(Math.round(pw * 2.16), H - top - FOOT - 40);
        body = `<div class="pm-top" style="top:${top + 20}px;right:${pw + 110}px">${head(Math.round(92 * ts), "left")}${pts}</div>
          ${phone(shots[0], `right:64px;top:${top}px;width:${pw}px;height:${phH}px`)}`;
      }
    }
    return `
    <div class="pm-card pm-${P.layout}" style="width:${W}px;height:${H}px">
      <div class="pm-glow"></div>
      ${st.showLogo === false ? "" : `<img class="pm-logo" data-el="logo" src="${d.logo}" alt="LineHunter">`}
      ${st.showSub === false || !d.subtitle ? "" : `<div class="pm-num" data-el="num" data-text="subtitle">${esc(d.subtitle)}</div>`}
      ${body}
      <div class="pm-foot" data-el="foot"><p>${K.note(d)}</p>${K.site(d)}</div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "promo", name: "App promo", kinds: ["promo"], photo: "plain", focus: { x: 50, y: 0 }, capacity, render,
    tokens: { bg: "#060a16", ink: "#f2f0fa", mut: "#93a1cb", accent: "#9a93ff", good: "#9a93ff", rule: "#2a3766" },
    toggles: { tilt: "Tilted phones", showLogo: "Logo", showSub: "Slide number", showKicker: "Small label", showSite: "Website" },
  });
})();
