// LineHunter - js/components/homeReel.js
// The homepage hero's right side (the beta front page's, PR #5 beta-website/signin.html; mockup design/indigo-mockup/home.html):
// one slanted plane holding a small stat sheet and two columns of 9:16 player cards that scroll forever in opposite directions
// (the owner's rule from the beta: they never stop, even with reduced motion on).
//
// Cards = the next slate's top hit rates (the slate js/components/top-hit-rates.js builds for the homepage and announces with the
// "lh-top-slate" event): one per player, L10, the side that hit more often, 8+ games, at most 4 unders, and only the league's stars
// (starIds: a season average of 20+ points, 10+ rebounds or 8+ assists, padded to at least 6 players; one season-averages request).
// Each card: team-color band, the player's headshot (js/components/playerPhoto.js; initials until it loads or if there is none), "9 of 10", the L10 average, the pick,
// mini bars against the line; it opens the player page on that prop. The sheet shows the best points prop (else the top card):
// the pick, hit rate, what the best odds need, the odds, the last 10 against the line and four nearby lines.
// Until the slate arrives (or when there is none) sample cards show, and the line under the buttons says so.

(function () {
  const colA = document.getElementById("homeReelA");
  const colB = document.getElementById("homeReelB");
  if (!colA || !colB) return;
  const sheet = document.getElementById("homeSheet");
  const tonight = document.getElementById("homeTonight");
  const WORD = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes", pra: "PRA" };
  const LOOP_MS = 40000;

  // Shown before the slate loads, or when there is none (clearly called samples in the line under the buttons).
  const SAMPLES = [
    { name: "Sample Guard", team: "PHI", matchup: "@ CHI", code: "pts", line: 25.5, side: "over", vals: [28, 32, 26, 29, 27, 27, 38, 26, 19, 17] },
    { name: "Sample Wing", team: "MIN", matchup: "vs UTA", code: "ast", line: 2.5, side: "over", vals: [1, 3, 3, 4, 4, 7, 3, 3, 4, 5] },
    { name: "Sample Forward", team: "MIL", matchup: "vs BOS", code: "pts", line: 20.5, side: "over", vals: [23, 24, 34, 13, 23, 23, 15, 21, 25, 23] },
    { name: "Sample Center", team: "DET", matchup: "vs LAL", code: "reb", line: 9.5, side: "under", vals: [8, 5, 8, 8, 8, 8, 7, 4, 7, 11] },
    { name: "Sample Shooter", team: "LAC", matchup: "vs NOP", code: "3pm", line: 1.5, side: "under", vals: [0, 1, 2, 1, 1, 1, 0, 0, 1, 1] },
    { name: "Sample Big", team: "SAC", matchup: "vs MIA", code: "reb", line: 6.5, side: "over", vals: [8, 7, 9, 5, 8, 10, 7, 9, 6, 8] },
  ].map((item) => ({ ...item, sample: true }));

  const lt = (value) => (typeof lineText === "function" ? lineText(value) : String(value)); // "24.5"
  const hit = (value, line, side) => (side === "under" ? value < line : value > line);
  const initials = (name) => name.split(" ").filter((word) => /^[A-Z]/.test(word)).slice(0, 2).map((word) => word[0]).join("");
  const teamColor = (team) => (typeof teamBaseColor === "function" ? teamBaseColor(team) : "#14234c");
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // "Jaden McDaniels" -> the key playerPhoto.js uses to find the headshot.
  const nameKey = (name) => {
    const parts = name.trim().split(/\s+/);
    return typeof nbaNameKey === "function" ? nbaNameKey(parts[0], parts.slice(1).join(" ")) : "";
  };

  // The league's stars on the slate: season average of 20+ PTS, 10+ REB or 8+ AST (last season's until he has games this season),
  // padded to at least 6 players so a thin slate still fills the reel. One request for every player on the slate.
  const starsBySlate = {};
  async function starIdsFor(slate) {
    const key = `${slate.date}|${slate.rows.length}`;
    if (starsBySlate[key]) return starsBySlate[key];
    const ids = [...new Set(slate.rows.map((row) => row.playerId))];
    const averages = typeof loadSeasonAverages === "function" ? await loadSeasonAverages(ids).catch(() => ({})) : {};
    const scored = ids.map((id) => {
      const a = averages[id];
      return { id, score: a ? Math.max((a.pts || 0) / 20, (a.reb || 0) / 10, (a.ast || 0) / 8) : 0 };
    }).sort((x, y) => y.score - x.score);
    const stars = new Set(scored.filter((x) => x.score >= 1).map((x) => x.id));
    scored.forEach((x) => { if (stars.size < 6 && x.score > 0) stars.add(x.id); });
    return (starsBySlate[key] = stars);
  }

  // The slate's rows -> card entries (one per player, best L10 side). stars = the Set of player ids allowed (null = everyone).
  function picksFrom(slate, stars) {
    const injuries = slate.injuries || {};
    const entries = (slate.rows || []).map((row) => {
      const games = (row.w && row.w[10] && row.w[10].games) || [];
      if (games.length < 8 || !WORD[row.code]) return null;
      if (stars && !stars.has(row.playerId)) return null;
      if (typeof plIsInjuredOut === "function" && plIsInjuredOut(injuries[row.playerId])) return null;
      const overs = games.filter((game) => game.overUnder === "over").length;
      const unders = games.filter((game) => game.overUnder === "under").length;
      return { playerId: row.playerId, name: row.name, team: row.team, matchup: row.matchup, code: row.code, line: row.line,
        side: unders > overs ? "under" : "over", hits: Math.max(overs, unders), vals: [...games].reverse().map((game) => game.value) };
    }).filter(Boolean).sort((a, b) => (b.hits / b.vals.length) - (a.hits / a.vals.length) || (b.code === "pts") - (a.code === "pts"));
    const picked = [];
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.playerId)) continue;
      if (entry.side === "under" && picked.filter((p) => p.side === "under").length >= 4) continue;
      seen.add(entry.playerId);
      picked.push(entry);
      if (picked.length >= 10) break;
    }
    return picked;
  }

  function cardHtml(item) {
    const n = item.vals.length;
    const hits = item.vals.filter((v) => hit(v, item.line, item.side)).length;
    const avg = item.vals.reduce((sum, v) => sum + v, 0) / n;
    const max = Math.max(...item.vals, item.line) * 1.15 || 1;
    const bars = item.vals.map((v) => `<i class="${hit(v, item.line, item.side) ? "is-hit" : "is-miss"}" style="height:${Math.max((v / max) * 100, 4).toFixed(1)}%"></i>`).join("");
    const sideWord = item.side === "under" ? "Under" : "Over";
    const href = item.sample ? "schedule.html" : `player.html?id=${item.playerId}&prop=${encodeURIComponent(item.code)}&side=${item.side}`;
    return `
      <a class="lh-rc" href="${href}" style="--team:${teamColor(item.team)}" tabindex="-1" aria-hidden="true">
        <span class="lh-rc-who"><span class="lh-rc-av"${item.playerId ? ` data-player-id="${item.playerId}" data-name-key="${esc(nameKey(item.name))}"` : ""}>${initials(item.name)}</span><span class="lh-rc-tag lines-only">${hits} of ${n}</span></span>
        <span class="lh-rc-name">${esc(item.name)}</span>
        <span class="lh-rc-meta">${item.team} · ${esc(item.matchup)}</span>
        <span class="lh-rc-avg">${avg.toFixed(1)}</span>
        <span class="lh-rc-label">${WORD[item.code]}, last ${n} average</span>
        <span class="lh-rc-prop lines-only is-${item.side}">${sideWord} ${lt(item.line)} ${WORD[item.code]}</span>
        <span class="lh-rc-bars">${bars}<span class="lh-rc-line lines-only" style="bottom:${((item.line / max) * 100).toFixed(1)}%"></span></span>
      </a>`;
  }

  function fillColumns(items) {
    [[colA, 0], [colB, 1]].forEach(([track, side]) => {
      let list = items.filter((_, i) => i % 2 === side);
      while (list.length && list.length < 4) list = list.concat(list); // enough cards to fill a tall column
      const once = list.map(cardHtml).join("");
      track.innerHTML = once + once; // doubled, so the loop has no seam
    });
    if (typeof loadPlayerPhoto === "function") document.querySelectorAll(".lh-rc-av[data-player-id]").forEach(loadPlayerPhoto);
  }

  // What the best odds need to break even, in %.
  const needs = (odds) => (odds < 0 ? (-odds / (-odds + 100)) * 100 : (100 / (odds + 100)) * 100);

  function fillSheet(item) {
    if (!sheet || !item) return;
    const n = item.vals.length;
    const hits = item.vals.filter((v) => hit(v, item.line, item.side)).length;
    const avg = item.vals.reduce((sum, v) => sum + v, 0) / n;
    const max = Math.max(...item.vals, item.line) * 1.2 || 1;
    const propType = typeof PROP_CODES !== "undefined" ? PROP_CODES[item.code] || item.code : item.code;
    const best = !item.sample && typeof lhOdds !== "undefined" ? lhOdds.getOdds(item.playerId, propType, item.line, item.side)[0] : null;
    const odds = best ? Number(best.odds) : null;
    const sideWord = item.side === "under" ? "Under" : "Over";
    const ladder = [-1, 0, 1, 2].map((step) => {
      const at = item.line + step;
      if (at < 0.5) return "";
      const rate = Math.round((item.vals.filter((v) => hit(v, at, item.side)).length / n) * 100);
      return `<span class="${step === 0 ? "is-on" : ""}">${lt(at)}<b>${rate}%</b></span>`;
    }).join("");
    sheet.innerHTML = `
      <div class="lh-sh-bar">
        <span class="lh-sh-av"${item.playerId ? ` data-player-id="${item.playerId}" data-name-key="${esc(nameKey(item.name))}"` : ""} style="background:${teamColor(item.team)}">${initials(item.name)}</span>
        <span class="lh-sh-name">${esc(item.name)}<small>${item.team} · ${esc(item.matchup)}</small></span>
        <span class="lh-sh-tabs">${["pts", "reb", "ast", "pra"].map((code) => `<span class="${code === item.code ? "is-on" : ""}">${code.toUpperCase()}</span>`).join("")}</span>
      </div>
      <div class="lh-sh-verdict">
        <div class="lh-sh-left"><b><span class="is-${item.side}">${sideWord}</span> ${lt(item.line)} ${WORD[item.code]}</b><small>Cleared it in ${hits} of his last ${n} · avg ${avg.toFixed(1)}</small></div>
        <div class="lh-sh-wedge lines-only">
          <div><small>Hit rate</small><b class="is-hi">${Math.round((hits / n) * 100)}%</b></div>
          <div><small>Needs</small><b>${odds === null ? "–" : `${needs(odds).toFixed(1)}%`}</b></div>
          <div><small>Odds</small><b>${odds === null ? "–" : odds > 0 ? `+${odds}` : odds}</b></div>
        </div>
      </div>
      <div class="lh-sh-chart">${item.vals.map((v) => `<i class="${hit(v, item.line, item.side) ? "is-hit" : "is-miss"}" data-v="${v}" style="height:${((v / max) * 100).toFixed(1)}%"></i>`).join("")}<span class="lh-sh-line lines-only" style="bottom:${((item.line / max) * 100).toFixed(1)}%"><span>${lt(item.line)}</span></span></div>
      <div class="lh-sh-ladder lines-only">${ladder}</div>`;
    if (typeof loadPlayerPhoto === "function") sheet.querySelectorAll(".lh-sh-av[data-player-id]").forEach(loadPlayerPhoto);
  }

  function dayWord(date) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (!date || date === today) return "Tonight";
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (date === tomorrow) return "Tomorrow";
    return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  }

  function show(items, slate) {
    fillColumns(items);
    fillSheet(items.find((item) => item.code === "pts") || items[0]);
    if (!tonight) return;
    if (!slate) {
      tonight.innerHTML = `Sample cards while tonight's slate loads · free, no sign-up`;
      return;
    }
    const games = new Set(slate.rows.map((row) => row.gameId)).size;
    tonight.innerHTML = `${dayWord(slate.date)}: <b>${games} game${games === 1 ? "" : "s"}</b><span class="lines-only"> · <b>${slate.rows.length} props</b> on The Board</span> · free, no sign-up`;
  }

  show(SAMPLES, null);
  document.addEventListener("lh-top-slate", async (event) => {
    const slate = event.detail && event.detail.slate;
    if (!slate || !slate.rows || !slate.rows.length) return;
    window.lhHomeLastSlate = slate;
    const stars = await starIdsFor(slate);
    window.lhHomeStars = stars;
    const items = picksFrom(slate, stars);
    if (items.length >= 4) show(items, slate);
  });
  document.addEventListener("lh-odds-ready", () => {
    const first = colA.querySelector(".lh-rc");
    if (first && !first.getAttribute("href").startsWith("schedule")) {
      // redraw the sheet's odds once the books' prices are in
      const evt = window.lhHomeLastSlate;
      if (evt) {
        const items = picksFrom(evt, window.lhHomeStars || null);
        fillSheet(items.find((item) => item.code === "pts") || items[0]);
      }
    }
  });

  // The two columns scroll forever: left up, right down; moving by half a doubled list loops without a jump.
  (function frame(now) {
    const shift = ((now % LOOP_MS) / LOOP_MS) * 50;
    colA.style.transform = `translate3d(0, ${-shift}%, 0)`;
    colB.style.transform = `translate3d(0, ${shift - 50}%, 0)`;
    requestAnimationFrame(frame);
  })(0);
})();
