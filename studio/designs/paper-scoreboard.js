// Studio design: Paper scoreboard (light, framed photo on an accent block, big record numerals). Same data shape as night-poster.js.
(function () {
  const FOOT = 150;
  const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sc = (d) => ({ hs: (d.style && d.style.hero) || 1, ts: (d.style && d.style.title) || 1, rs: (d.style && d.style.rows) || 1 });
  function titleFit(title, ts) {
    const words = String(title).split(/\s+/).filter(Boolean);
    const longest = Math.max(4, ...words.map((w) => w.length));
    return { words, size: Math.round(Math.min(150, 500 / (longest * 0.6)) * ts) };
  }
  const heroPx = (d, hs) => Math.round(Math.min(150, 560 / Math.max(3, String(d.hero || "").length * 0.62)) * hs);
  function headHeight(d) { const k = sc(d), t = titleFit(d.title, k.ts); return 24 + 10 + Math.round(heroPx(d, k.hs) * 0.9) + t.words.length * Math.round(t.size * 0.9) + 18 + 30 + 34; }
  function capacity(size, d) {
    const k = sc(d || {}), head = d ? headHeight(d) : 420;
    return Math.max(3, Math.min(10, Math.floor((size.h - 60 - head - FOOT - 20) / Math.round(92 * k.rs))));
  }
  function render(d) {
    const { hs, ts, rs } = sc(d), st = d.style || {}, rowH = Math.round(92 * rs), t = titleFit(d.title, ts);
    const rows = d.rows.slice(0, capacity(d, d));
    const frameH = d.h - 96 - 240;
    const pn = d.photo && d.photo.player ? norm(d.photo.player) : "";
    const lead = d.photo ? d.rows.find((r) => norm(r.full || r.n) === pn || (norm(r.full || r.n).split(" ").pop() === pn.split(" ").pop() && norm(r.full || r.n)[0] === pn[0])) : d.rows[0];
    return `
    <div class="sb-card" style="width:${d.w}px;height:${d.h}px">
      <div class="sb-block" style="height:${frameH}px"></div>
      <div class="sb-frame" style="height:${frameH}px">
        ${d.photo ? `<img src="${d.photo.url}" alt="">` : `<div class="sb-nophoto"><img src="${d.logo}" alt=""></div>`}
        ${d.photo && d.photo.player ? `<div class="sb-cap"><b>${esc(d.photo.player)}</b>${lead ? `<span>${esc(lead.stat)} · ${esc(lead.rec)}</span>` : ""}</div>` : lead ? `<div class="sb-cap"><b>${esc(lead.n)}</b><span>${esc(lead.stat)} · ${esc(lead.rec)}</span></div>` : ""}
      </div>
      ${d.photo && d.photo.credit ? `<div class="sb-credit" style="top:${96 + frameH + 10}px">${esc(d.photo.credit)}</div>` : ""}
      <div class="sb-right">
        ${st.showKicker === false ? "" : `<div class="sb-kick">${esc(d.kicker || "Tonight's research")}</div>`}
        <div class="sb-hero" style="font-size:${heroPx(d, hs)}px">${esc(d.hero)}</div>
        ${t.words.map((w) => `<div class="sb-title" style="font-size:${t.size}px">${esc(w)}</div>`).join("")}
        ${st.showSub === false ? "" : `<div class="sb-date">${esc(d.subtitle)}</div>`}
        <div class="sb-list" style="--rs:${rs};--rh:${rowH}px">
          ${rows.map((r) => `<div class="sb-row"><div class="sb-nm">${esc(r.n)}<span><i>${esc(r.t)}</i>${esc(r.stat)}</span></div><div class="sb-rec" style="font-size:${Math.round((String(r.rec).length > 5 ? 36 : 48) * rs)}px">${esc(r.rec)}</div></div>`).join("")}
        </div>
      </div>
      <div class="sb-foot"><p><strong>${esc(d.footer)}</strong><br>${esc(d.note).replace(/\n/g, "<br>")}</p>${st.showLogo === false ? "" : `<img src="${d.logoLight}" alt="LineHunter">`}</div>
    </div>`;
  }
  (window.STUDIO_DESIGNS = window.STUDIO_DESIGNS || []).push({
    id: "paper-scoreboard", name: "Paper scoreboard", photo: "plain", capacity, render,
    tokens: { bg: "#eef1fa", ink: "#052350", mut: "#4c5a85", accent: "#280ea1", rule: "#d8dff5" },
    toggles: { showLogo: "Logo", showSub: "Date line", showKicker: "Top label" },
  });
})();
