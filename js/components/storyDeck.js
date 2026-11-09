// LineHunter - js/components/storyDeck.js
// The "Top picks" story deck on the Today page (phones only, lines mode): one card per player (top 20, nobody twice) from the slate
// js/components/top-hit-rates.js builds (event "lh-top-slate", so no extra requests for the picks). Swipe left = skip, swipe right (or the
// Report button) = the full report in a bottom sheet (js/components/scoutReport.js), "Add to hunt" = My Hunts (huntButtonHtml). A Filter
// sheet picks props, Over / Under / Both and the order (Mix = best over, best under, longest streak in turn; Hit rate; Streak).
// Players are rotation players or better (season average of 10+ PTS, 5+ REB or 4+ AST). Jersey number and position come from one
// players request for the deck's players. The filter is remembered (localStorage "lh-deck").
//
// Needs js/core/stats.js, js/components/prop-list.js (plStatsAtLine), js/components/hunt-button.js, js/components/scoutReport.js,
// js/components/playerPhoto.js and js/data/odds.js loaded first.

(function () {
  const box = document.getElementById("storyDeck");
  if (!box) return;

  const DECK_SIZE = 20;
  const MIN_GAMES = 8;
  const CODES = ["pts", "reb", "ast", "3pm", "pra", "stl", "blk"];
  const WORD = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes", pra: "PRA", stl: "Steals", blk: "Blocks" };
  const LOW_LINE = ["3pm", "stl", "blk"];
  const PHONE = window.matchMedia("(max-width: 767.98px)");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  const STORE = "lh-deck";

  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtOdds = (odds) => (odds > 0 ? `+${odds}` : `−${Math.abs(odds)}`);
  const lt = (value) => (typeof lineText === "function" ? lineText(value) : String(value));
  const nameParts = (name) => { const p = name.trim().split(/\s+/); return { first: p[0], last: p.slice(1).join(" ") || p[0] }; };

  let filter = { props: [], side: "both", order: "mix" };
  try { Object.assign(filter, JSON.parse(localStorage.getItem(STORE)) || {}); } catch (error) { /* storage blocked: defaults */ }
  const saveFilter = () => { try { localStorage.setItem(STORE, JSON.stringify(filter)); } catch (error) { /* kept for this visit */ } };

  let slate = null;        // the slate on screen
  let starIds = null;      // Set of allowed player ids, or null (no filtering)
  let people = {};         // playerId -> { jersey_number, position }
  let deck = [];           // [{ row, side, stats, key }]
  let index = 0;
  let built = false;

  // ---------- who is on the deck ----------
  const starCache = {};
  async function loadStars(sl) {
    const key = `${sl.date}|${sl.rows.length}`;
    if (starCache[key]) return starCache[key];
    const ids = [...new Set(sl.rows.map((row) => row.playerId))];
    const averages = typeof loadSeasonAverages === "function" ? await loadSeasonAverages(ids).catch(() => null) : null;
    if (!averages) return (starCache[key] = null);
    const ok = new Set(ids.filter((id) => {
      const a = averages[id];
      return a && ((a.pts || 0) >= 10 || (a.reb || 0) >= 5 || (a.ast || 0) >= 4);
    }));
    return (starCache[key] = ok.size >= 4 ? ok : null);
  }

  const rankOf = (c) => c.stats.hitRate - (c.side === "under" && c.row.line <= 1.5 && LOW_LINE.includes(c.row.code) ? 15 : 0);
  const byRank = (a, b) => (rankOf(b) - rankOf(a)) || (b.stats.totalGames - a.stats.totalGames) || (b.stats.streak - a.stats.streak)
    || ((a.side === "over" ? 0 : 1) - (b.side === "over" ? 0 : 1));
  const byStreak = (a, b) => (b.stats.streak - a.stats.streak) || byRank(a, b);

  function candidates() {
    const injuries = (slate && slate.injuries) || {};
    const out = [];
    (slate.rows || []).forEach((row) => {
      if (!CODES.includes(row.code)) return;
      if (filter.props.length && !filter.props.includes(row.code)) return;
      if (starIds && !starIds.has(row.playerId)) return;
      if (typeof plIsInjuredOut === "function" && plIsInjuredOut(injuries[row.playerId])) return;
      const games = row.w && row.w[10] ? row.w[10].games : [];
      if (games.length < MIN_GAMES || row.line === null || row.line === undefined) return;
      ["over", "under"].forEach((side) => {
        if (filter.side !== "both" && filter.side !== side) return;
        out.push({ row, side, stats: plStatsAtLine(games, row.line, side), key: `${row.gameId}|${row.playerId}|${row.code}|${side}` });
      });
    });
    return out;
  }

  function buildDeck() {
    const all = candidates();
    const lists = {
      over: all.filter((c) => c.side === "over").sort(byRank),
      under: all.filter((c) => c.side === "under").sort(byRank),
      streak: [...all].sort(byStreak),
      rate: [...all].sort(byRank),
    };
    // Mix is "best over, best under, longest streak" in turn; a single side leaves its list empty and the others carry on.
    const order = filter.order === "rate" ? [lists.rate] : filter.order === "streak" ? [lists.streak] : [lists.over, lists.under, lists.streak];
    const seen = new Set();
    const picked = [];
    const cursor = order.map(() => 0);
    let guard = 0;
    while (picked.length < DECK_SIZE && guard++ < 400) {
      let progressed = false;
      for (let i = 0; i < order.length && picked.length < DECK_SIZE; i++) {
        const list = order[i];
        while (cursor[i] < list.length && seen.has(list[cursor[i]].row.playerId)) cursor[i]++;
        if (cursor[i] < list.length) {
          const next = list[cursor[i]++];
          seen.add(next.row.playerId);
          picked.push(next);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    return picked;
  }

  // ---------- one card ----------
  const propType = (code) => (typeof PROP_CODES !== "undefined" ? PROP_CODES[code] || code : code);
  function legFor(c) {
    const { row } = c;
    const best = typeof lhOdds !== "undefined" ? lhOdds.getOdds(row.playerId, propType(row.code), row.line, c.side)[0] : null;
    return {
      best,
      leg: { playerId: row.playerId, player: row.name, team: row.team, opp: row.opp || (row.matchup || "").split(" ").pop(), gameId: row.gameId,
        tipoff: row.tip || null, stat: propType(row.code), side: c.side, line: row.line, odds: best ? Number(best.odds) : null, book: best ? best.vendor : null, isAlt: false },
    };
  }

  function cardHtml(c) {
    const { row, stats } = c;
    const { first, last } = nameParts(row.name);
    const person = people[row.playerId] || {};
    const { best, leg } = legFor(c);
    const team = typeof teamBaseColor === "function" ? teamBaseColor(row.team) : "#14234c";
    const onTeam = typeof readableTextOn === "function" ? readableTextOn(team) : "#fff"; // white or dark, whichever reads on the team color
    const time = row.tip ? new Date(row.tip).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    const meta = [person.position, row.team, row.matchup, time].filter(Boolean).join(" · ");
    const sideWord = c.side === "under" ? "Under" : "Over";
    const sub = `${stats.streak >= 3 ? `${stats.streak} straight ${c.side === "under" ? "unders" : "overs"}` : `${stats.hits} of ${stats.totalGames} ${c.side}`} · averaging ${formatStatValue(stats.average)}`;
    const vals = [...row.w[10].games].reverse();
    const max = Math.max(...vals.map((g) => g.value), row.line) * 1.15 || 1;
    const bars = vals.map((g) => {
      const hit = c.side === "under" ? g.value < row.line : g.value > row.line;
      return `<i class="${hit ? "" : "is-miss"}" style="height:${Math.max((g.value / max) * 100, 4).toFixed(1)}%"></i>`;
    }).join("");
    const initials = (first[0] || "") + (last[0] || "");
    return `
      <article class="lh-sd-card" style="--team:${team};--on-team:${onTeam}" data-sd-key="${esc(c.key)}">
        <span class="lh-sd-wm" aria-hidden="true">${esc(row.team)}</span>
        <div class="lh-sd-who">
          <span class="lh-sd-av" data-player-id="${row.playerId}" data-name-key="${esc(typeof nbaNameKey === "function" ? nbaNameKey(first, last) : "")}">${esc(initials)}</span>
          <span class="lh-sd-tag">${stats.hits} of ${stats.totalGames}</span>
        </div>
        <div class="lh-sd-name"><small>${esc(first)}</small><b>${esc(last)}</b></div>
        <div class="lh-sd-meta">${person.jersey_number ? `<span class="lh-sd-jn">#${esc(person.jersey_number)}</span> ` : ""}${esc(meta)}</div>
        <div class="lh-sd-pick is-${c.side}"><b>${sideWord} ${lt(row.line)} ${WORD[row.code]}</b><span>${esc(sub)}</span></div>
        <div class="lh-sd-stats"><div class="lh-sd-rate is-${stats.hitRate >= 75 ? "hi" : stats.hitRate >= 50 ? "md" : "lo"}">${Math.round(stats.hitRate)}%<small>last ${stats.totalGames}</small></div>
          ${best ? `<span class="lh-sd-odds">${fmtOdds(Number(best.odds))} <small>${esc(lhHunts.bookLabel(best.vendor))}</small></span>` : `<span class="lh-sd-odds is-none">no odds</span>`}</div>
        <div class="lh-sd-bars">${bars}<span class="lh-sd-line" style="bottom:${((row.line / max) * 100).toFixed(1)}%"></span></div>
        <div class="lh-sd-actions">
          <button type="button" class="lh-sd-btn" data-sd="skip">‹ Skip</button>
          ${huntButtonHtml(leg, { labelOut: "Add to hunt", labelIn: "Added", iconFirst: true, className: "lh-sd-add" })}
          <button type="button" class="lh-sd-btn" data-sd="report">Report ›</button>
        </div>
      </article>`;
  }

  // ---------- the section ----------
  function summary() {
    const parts = [];
    if (filter.props.length) parts.push(filter.props.map((c) => c.toUpperCase()).join(", "));
    if (filter.side !== "both") parts.push(filter.side === "over" ? "Over" : "Under");
    return parts.length ? parts.join(" · ") : "All";
  }

  function render(animate) {
    if (!slate) return;
    const n = deck.length;
    if (index >= n) index = n;
    const done = n > 0 && index >= n;
    const segs = Array.from({ length: n }, (_, i) => `<i class="${i < index || (!done && i === index) ? "on" : ""}"></i>`).join("");
    let body;
    if (!n) {
      body = `<div class="lh-sd-end"><b>No picks match this filter</b><p>Try another prop or both sides.</p><button type="button" class="lh-sd-btn" data-sd="reset">Reset filter</button></div>`;
    } else if (done) {
      body = `<div class="lh-sd-end"><b>That's all ${n} picks</b><p>Past results, not a prediction. The full list is on The Board below.</p><button type="button" class="lh-sd-btn" data-sd="restart">Start over</button></div>`;
    } else {
      const next = deck[index + 1];
      body = `${next ? `<div class="lh-sd-back" aria-hidden="true" style="--team:${typeof teamBaseColor === "function" ? teamBaseColor(next.row.team) : "#14234c"}"></div>` : ""}${cardHtml(deck[index])}`;
    }
    box.innerHTML = `
      <div class="lh-sd-head">
        <h2>Top picks <small>${n && !done ? `${index + 1} of ${n}` : n ? `${n} of ${n}` : ""}</small></h2>
        <div class="lh-sd-headr">${index > 0 && n ? `<button type="button" class="lh-sd-link" data-sd="back">Back</button>` : ""}<button type="button" class="lh-sd-filterbtn" data-sd="filter">Filter · ${esc(summary())}</button></div>
      </div>
      <div class="lh-sd-prog" aria-hidden="true">${segs}</div>
      <div class="lh-sd-deck${animate ? " is-enter" : ""}" id="sdDeck">${body}</div>
      <div class="lh-sd-hint">Swipe left to skip · swipe right for the full report</div>`;
    box.hidden = false;
    if (typeof loadPlayerPhoto === "function") box.querySelectorAll(".lh-sd-av[data-player-id]").forEach(loadPlayerPhoto);
    bindSwipe();
  }

  // ---------- swipe ----------
  function bindSwipe() {
    const card = box.querySelector(".lh-sd-card");
    if (!card) return;
    let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, pid = null;
    const stampL = document.createElement("span");
    const stampR = document.createElement("span");
    stampL.className = "lh-sd-stamp is-l"; stampL.textContent = "SKIP";
    stampR.className = "lh-sd-stamp is-r"; stampR.textContent = "FULL REPORT";
    const deckEl = box.querySelector("#sdDeck");
    deckEl.append(stampL, stampR);
    const set = (x, animated) => {
      card.style.transition = animated && !REDUCED.matches ? "transform 250ms ease-out" : "none";
      card.style.transform = `translateX(${x}px) rotate(${(x * 0.05).toFixed(2)}deg)`;
      stampL.style.opacity = Math.min(Math.max(-x / 110, 0), 1);
      stampR.style.opacity = Math.min(Math.max(x / 110, 0), 1);
    };
    card.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a")) return;
      dragging = true; decided = false; dx = 0; startX = event.clientX; startY = event.clientY; pid = event.pointerId;
    });
    card.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pid) return;
      const mx = event.clientX - startX;
      const my = event.clientY - startY;
      if (!decided) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { dragging = false; return; } // a vertical scroll
        if (Math.abs(mx) > 8) { decided = true; try { card.setPointerCapture(pid); } catch (error) { /* fine */ } }
        else return;
      }
      dx = mx;
      set(dx, false);
    });
    const end = (event) => {
      if (!dragging || (event && event.pointerId !== pid)) return;
      dragging = false;
      const width = card.offsetWidth;
      if (dx <= -90) { fling(-width * 1.3, () => skip()); }
      else if (dx >= 90) { set(0, true); openReport(deck[index]); }
      else set(0, true);
      dx = 0;
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    function fling(x, done) {
      set(x, true);
      if (REDUCED.matches) { done(); return; }
      setTimeout(done, 240);
    }
    card._fling = () => fling(-card.offsetWidth * 1.3, () => skip());
  }

  function skip() { index += 1; render(false); }

  // ---------- sheets (filter and report) ----------
  let sheet = null;
  function openSheet(title, html, onReady) {
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "lh-sd-sheetwrap";
    sheet.innerHTML = `<div class="lh-sd-backdrop" data-sd="close"></div>
      <div class="lh-sd-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="lh-sd-grab" aria-hidden="true"></div>${html}</div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet && sheet.classList.add("is-open"));
    if (onReady) onReady(sheet);
  }
  function closeSheet() {
    if (!sheet) return;
    const old = sheet;
    sheet = null;
    old.classList.remove("is-open");
    setTimeout(() => old.remove(), REDUCED.matches ? 0 : 200);
  }
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });

  function filterSheetHtml() {
    const chip = (on, attr, label) => `<button type="button" class="lh-sd-chip${on ? " is-on" : ""}" ${attr}>${label}</button>`;
    return `
      <h3 class="lh-sd-sheeth">Filter <span id="sdCount">${deck.length} picks</span></h3>
      <div class="lh-sd-lab">Prop</div>
      <div class="lh-sd-chips">${chip(!filter.props.length, 'data-sd-prop="all"', "All")}${CODES.map((c) => chip(filter.props.includes(c), `data-sd-prop="${c}"`, c.toUpperCase())).join("")}</div>
      <div class="lh-sd-lab">Side</div>
      <div class="lh-sd-chips">${["over", "under", "both"].map((s) => chip(filter.side === s, `data-sd-side="${s}"`, s[0].toUpperCase() + s.slice(1))).join("")}</div>
      <div class="lh-sd-lab">Order</div>
      <div class="lh-sd-chips">${[["mix", "Mix"], ["rate", "Hit rate"], ["streak", "Streak"]].map(([k, l]) => chip(filter.order === k, `data-sd-order="${k}"`, l)).join("")}</div>
      <button type="button" class="lh-sd-btn is-primary lh-sd-show" data-sd="close">Show picks</button>`;
  }

  function refreshFilterSheet() {
    deck = buildDeck();
    index = 0;
    if (sheet) {
      const body = sheet.querySelector(".lh-sd-sheet");
      const grab = body.querySelector(".lh-sd-grab");
      body.innerHTML = "";
      body.appendChild(grab);
      body.insertAdjacentHTML("beforeend", filterSheetHtml());
    }
    render(false);
  }

  function reportCtx(c) {
    const { row } = c;
    const mine = slate.rows.filter((r) => r.playerId === row.playerId && r.gameId === row.gameId);
    const cands = mine.map((r) => {
      const games = r.w[10].games;
      const over = plStatsAtLine(games, r.line, "over");
      const under = plStatsAtLine(games, r.line, "under");
      const side = under.hitRate > over.hitRate ? "under" : "over";
      return { code: r.code, line: r.line, side, stats: side === "under" ? under : over };
    });
    const { best, all } = scoutBestProp(cands);
    const pack = (x) => ({ code: x.code, side: x.side, line: x.line, hits: x.stats.hits, total: x.stats.totalGames, rate: x.stats.hitRate, streak: x.stats.streak, average: x.stats.average });
    const offer = best ? lhOdds.getOdds(row.playerId, propType(best.code), best.line, best.side)[0] : null;
    const byGame = {};
    mine.forEach((r) => r.w[20].games.forEach((g) => {
      const e = byGame[g.gameId] = byGame[g.gameId] || { date: g.date, minutes: g.minutes, opponent: g.opponent, homeAway: g.homeAway, teamScore: g.teamScore, opponentScore: g.opponentScore, stats: {} };
      e.stats[(WORD[r.code] ? r.code : r.code).toUpperCase()] = g.value;
    }));
    return {
      gameId: row.gameId, playerId: row.playerId, team: row.team, opp: row.opp || (row.matchup || "").split(" ").pop(), activeCode: row.code,
      gamesNewestFirst: Object.values(byGame).sort((a, b) => b.date.localeCompare(a.date)), best: best ? pack(best) : null, props: all.map(pack),
      odds: offer ? scoutOddsText(offer) : "",
    };
  }

  function openReport(c) {
    if (!c || typeof renderScoutReport !== "function") return;
    const { row } = c;
    const { first, last } = nameParts(row.name);
    openSheet(`${row.name} full report`, `
      <h3 class="lh-sd-sheeth">${esc(first)} ${esc(last)} <span>${esc(row.team)} ${esc(row.matchup)}</span></h3>
      <div class="lh-sr lh-sd-report" id="sdReport"></div>
      <div class="lh-sd-reportbtns">
        <a class="lh-sd-btn" href="player.html?id=${row.playerId}&prop=${row.code}">Player page ›</a>
        <button type="button" class="lh-sd-btn is-primary" data-sd="close">Done</button>
      </div>`, () => renderScoutReport(document.getElementById("sdReport"), reportCtx(c)));
  }

  // ---------- events ----------
  box.addEventListener("click", (event) => {
    const el = event.target.closest("[data-sd]");
    if (!el) return;
    const act = el.dataset.sd;
    if (act === "skip") { const card = box.querySelector(".lh-sd-card"); if (card && card._fling) card._fling(); else skip(); }
    else if (act === "report") openReport(deck[index]);
    else if (act === "back") { index = Math.max(0, index - 1); render(false); }
    else if (act === "restart") { index = 0; render(true); }
    else if (act === "reset") { filter = { props: [], side: "both", order: "mix" }; saveFilter(); deck = buildDeck(); index = 0; render(false); }
    else if (act === "filter") openSheet("Filter", filterSheetHtml());
  });

  document.addEventListener("click", (event) => {
    if (!sheet) return;
    if (event.target.closest('[data-sd="close"]')) { closeSheet(); return; }
    const prop = event.target.closest("[data-sd-prop]");
    const side = event.target.closest("[data-sd-side]");
    const order = event.target.closest("[data-sd-order]");
    if (!prop && !side && !order) return;
    if (prop) {
      const code = prop.dataset.sdProp;
      if (code === "all") filter.props = [];
      else filter.props = filter.props.includes(code) ? filter.props.filter((c) => c !== code) : [...filter.props, code];
    }
    if (side) filter.side = side.dataset.sdSide;
    if (order) filter.order = order.dataset.sdOrder;
    saveFilter();
    refreshFilterSheet();
  });

  // ---------- data ----------
  async function load(newSlate) {
    if (!PHONE.matches || !newSlate || !newSlate.rows || !newSlate.rows.length) { if (!newSlate || !newSlate.rows || !newSlate.rows.length) box.hidden = true; return; }
    slate = newSlate;
    starIds = await loadStars(newSlate);
    const before = deck.length ? deck[Math.min(index, deck.length - 1)].key : null;
    deck = buildDeck();
    const same = before ? deck.findIndex((c) => c.key === before) : -1;
    index = same >= 0 ? same : 0;
    render(!built);
    built = true;
    // jersey numbers and positions for the deck's players (one request), then redraw the card
    const ids = [...new Set(deck.map((c) => c.row.playerId))].filter((id) => !people[id]);
    if (ids.length && typeof fetchPlayers === "function") {
      fetchPlayers(ids).then((found) => { Object.assign(people, found); if (slate === newSlate) render(false); }).catch(() => {});
    }
  }

  document.addEventListener("lh-top-slate", (event) => { const s = event.detail && event.detail.slate; if (s) load(s); else if (event.detail && event.detail.message) box.hidden = true; });
  document.addEventListener("lh-odds-ready", () => { if (slate && deck.length) render(false); });
  document.addEventListener("lh-hunts-change", () => { /* huntButtonState updates the Add button itself */ });
  PHONE.addEventListener("change", () => { if (PHONE.matches && slate) load(slate); });
})();
