// LineHunter - js/pages/hunts.js
// The Hunts builder (hunts.html): the Board on the left picks props, this draws the sticky ticket on the right from My Hunts
// (js/core/hunts.js): the legs with warnings, combined odds, implied chance, stake / to win, "Hit together" for legs that share a
// game, Share / Post to X (the drawer's own buttons), Save as image, and plain links to the books.
//
// Needs js/core/hunts.js, js/components/my-hunts.js (its Share / Post buttons and the toast), js/core/stats.js (game logs) and
// js/components/share.js (the picture) loaded first.

(function () {
  const box = document.getElementById("huntsTicket");
  if (!box) return;
  document.body.classList.add("lh-hunts-page");

  const STAKE_KEY = "lh-hunts-stake";
  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (odds) => (odds === null || odds === undefined ? "–" : odds > 0 ? `+${odds}` : `−${Math.abs(odds)}`);
  const toDecimal = (odds) => (odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds));
  const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sideWord = (leg) => (leg.side === "under" ? "Under" : "Over");
  const lastName = (name) => name.trim().split(/\s+/).slice(1).join(" ") || name;

  let stake = (() => {
    try { const v = Number(localStorage.getItem(STAKE_KEY)); return Number.isFinite(v) && v > 0 ? v : 10; } catch (error) { return 10; }
  })();
  let injuries = {};           // playerId -> status, from the Board's slate
  const games = {};            // gameId -> { away, home } | false
  const together = {};         // signature -> { state: "loading" | "done" | "failed", ... }

  document.addEventListener("lh-top-slate", (event) => {
    const slate = event.detail && event.detail.slate;
    if (slate && slate.injuries) { injuries = slate.injuries; render(); }
  });

  // ---------- game info (AWY @ HME), shared with the drawer's sessionStorage entries ----------
  function gameFor(id) {
    if (!id) return false;
    if (id in games) return games[id];
    try {
      const saved = JSON.parse(sessionStorage.getItem(`lh-game:${id}`));
      if (saved && saved.away && saved.home) return (games[id] = saved);
    } catch (error) { /* storage blocked */ }
    return undefined;
  }
  function loadGames(legs) {
    [...new Set(legs.map((leg) => leg.gameId))].filter((id) => id && gameFor(id) === undefined).forEach((id) => {
      games[id] = "loading";
      fetch(`/api/bdl/v1/games/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then(({ data }) => {
        games[id] = { away: data.visitor_team.abbreviation, home: data.home_team.abbreviation, datetime: data.datetime || null };
        try { sessionStorage.setItem(`lh-game:${id}`, JSON.stringify(games[id])); } catch (error) { /* fine */ }
      }).catch(() => { games[id] = false; }).finally(render);
    });
  }

  // ---------- Hit together: games where every leg of a same-game group hit ----------
  // Legs sharing a game (two players, or two props of one player) have the same games to compare; legs in different games don't,
  // so only same-game groups get a number.
  function groupsOf(legs) {
    const byGame = {};
    legs.forEach((leg, index) => { (byGame[leg.gameId] = byGame[leg.gameId] || []).push({ leg, index }); });
    return Object.values(byGame).filter((group) => group.length > 1);
  }
  const signature = (group) => group.map(({ leg }) => leg.id).sort().join("|");

  function startTogether(group) {
    const key = signature(group);
    if (together[key]) return;
    together[key] = { state: "loading" };
    const ids = [...new Set(group.map(({ leg }) => leg.playerId))];
    loadPlayerGameLogs(ids, 10, { recent: true }).then(({ logsByPlayer }) => {
      const byPlayer = {};
      ids.forEach((id) => {
        const all = [...(logsByPlayer[id].current || []), ...(logsByPlayer[id].previous || [])].filter(playedInGame);
        byPlayer[id] = new Map(all.map((log) => [log.game.id, log]));
      });
      // Games every player in the group played, newest first (the first player's order), the last 10.
      const first = [...byPlayer[ids[0]].values()];
      const shared = first.filter((log) => ids.every((id) => byPlayer[id].has(log.game.id))).slice(0, 10);
      const cells = shared.map((log) => group.every(({ leg }) => {
        const mine = byPlayer[leg.playerId].get(log.game.id);
        const value = statValue(mine, propStatKey(leg.stat));
        return leg.side === "under" ? value < leg.line : value > leg.line;
      }));
      together[key] = { state: "done", cells: cells.reverse() }; // oldest left, newest right
    }).catch(() => { together[key] = { state: "failed" }; }).finally(render);
  }

  function togetherHtml(group) {
    const t = together[signature(group)];
    const label = `<div class="lh-hbt-t">Hit together · same game · last 10 games</div>`;
    if (!t || t.state === "loading") return `<div class="lh-hbt">${label}<div class="lh-hbt-note">Counting...</div></div>`;
    if (t.state === "failed") return `<div class="lh-hbt">${label}<div class="lh-hbt-note">Couldn't load the games.</div></div>`;
    if (!t.cells.length) {
      const teams = new Set(group.map(({ leg }) => leg.team));
      return `<div class="lh-hbt">${label}<div class="lh-hbt-note">${teams.size > 1 ? "These players are on opposite teams, so they have no past games together to count." : "No shared games yet."}</div></div>`;
    }
    const hits = t.cells.filter(Boolean).length;
    const names = [...new Set(group.map(({ leg }) => lastName(leg.player)))].join(" and ");
    return `<div class="lh-hbt">${label}
      <b>${hits}/${t.cells.length}</b>
      <span class="lh-hbt-dots" aria-hidden="true">${t.cells.map((hit) => `<i class="${hit ? "" : "is-miss"}"></i>`).join("")}</span>
      <p>Every leg for ${esc(names)} hit in ${hits} of ${t.cells.length} games${t.cells.length < 8 ? " (small sample)" : ""}. Legs from one game aren't independent, so the odds above can mislead.</p></div>`;
  }

  // ---------- drawing ----------
  function totals(legs) {
    const priced = legs.filter((leg) => leg.odds !== null && leg.odds !== undefined);
    if (!legs.length || priced.length !== legs.length) return null;
    const decimal = priced.reduce((t, leg) => t * toDecimal(leg.odds), 1);
    return { decimal, american: lhHunts.combinedOdds(priced.map((leg) => leg.odds)), implied: 100 / decimal };
  }

  function legHtml(leg, index, firstIndexInGame) {
    const info = gameFor(leg.gameId);
    const match = info && info !== "loading" ? `${info.away} @ ${info.home}` : [leg.team, leg.opp].filter(Boolean).join(" · ");
    const warns = [];
    if (firstIndexInGame !== index) warns.push(`Same game as leg ${firstIndexInGame + 1}`);
    const status = injuries[leg.playerId];
    if (status) warns.push(`${esc(status)} on the injury report`);
    if (leg.tipoff && Date.parse(leg.tipoff) <= Date.now()) warns.push("Game started");
    if (leg.odds === null || leg.odds === undefined) warns.push("No odds posted");
    return `
      <li class="lh-hbl lh-hbl--${leg.side}">
        <div><b>${esc(lastName(leg.player))} ${sideWord(leg)} ${leg.line} ${esc(huntStatName(leg.stat))}</b>
          <span>${esc(match)}${leg.book ? ` · ${esc(lhHunts.bookLabel(leg.book))}` : ""}${leg.isAlt ? " · Alt line" : ""}</span>
          ${warns.map((w) => `<div class="lh-hbl-warn">${w}</div>`).join("")}</div>
        <div class="lh-hbl-r"><span class="lh-hbl-odds">${fmt(leg.odds)}</span>
          <button type="button" class="lh-hbl-x" data-hb-remove="${esc(leg.id)}" aria-label="Remove ${esc(leg.player)}"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
      </li>`;
  }

  // Phones and tablets: the ticket is a bottom sheet (the bar opens it). Desktop keeps it sticky on the right.
  const sheetTop = () => `<div class="lh-hb-grab" aria-hidden="true"></div><button type="button" class="lh-hb-close" data-hb="close" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>`;
  const SHEET = window.matchMedia("(max-width: 991.98px)");
  const backdrop = document.createElement("div");
  backdrop.className = "lh-hb-backdrop";
  backdrop.setAttribute("data-hb", "close");
  document.body.appendChild(backdrop);
  function openTicket() {
    if (!SHEET.matches) { box.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    box.classList.add("is-open");
    backdrop.classList.add("is-open");
    document.body.classList.add("lh-hb-sheet-open");
  }
  function closeTicket() {
    box.classList.remove("is-open");
    box.style.transform = "";
    backdrop.classList.remove("is-open");
    backdrop.style.opacity = "";
    document.body.classList.remove("lh-hb-sheet-open");
  }
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeTicket(); });
  backdrop.addEventListener("click", closeTicket);
  SHEET.addEventListener("change", () => { if (!SHEET.matches) closeTicket(); });
  // Drag the handle down to close (past 110px or a quick flick), otherwise it springs back.
  (function () {
    let startY = 0, dy = 0, dragging = false, lastY = 0, lastT = 0, velocity = 0, pid = null;
    box.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".lh-hb-grab, .lh-hb-h") || !SHEET.matches) return;
      dragging = true; dy = 0; velocity = 0; pid = event.pointerId; startY = lastY = event.clientY; lastT = event.timeStamp;
      box.style.transition = "none"; backdrop.style.transition = "none";
      try { box.setPointerCapture(pid); } catch (error) { /* fine */ }
    });
    box.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pid) return;
      dy = Math.max(0, event.clientY - startY);
      const dt = event.timeStamp - lastT;
      if (dt > 0) velocity = (event.clientY - lastY) / dt;
      lastY = event.clientY; lastT = event.timeStamp;
      box.style.transform = `translateY(${dy}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - dy / (box.offsetHeight || 400)));
    });
    const end = (event) => {
      if (!dragging || event.pointerId !== pid) return;
      dragging = false;
      box.style.transition = ""; backdrop.style.transition = "";
      if (dy > 110 || velocity > 0.6) closeTicket();
      else { box.style.transform = ""; backdrop.style.opacity = ""; }
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  })();

  function render() {
    const legs = lhHunts.getAll();
    const bar = document.getElementById("huntsBar");
    const t = totals(legs);
    if (bar) {
      bar.hidden = legs.length === 0;
      bar.innerHTML = `<span>My hunt · ${legs.length} leg${legs.length === 1 ? "" : "s"}</span><span>${t ? `${fmt(t.american)} · to win ${money(Math.round(stake * (t.decimal - 1) * 100) / 100)}` : ""} ›</span>`;
    }
    if (!legs.length) {
      box.innerHTML = `${sheetTop()}<h2 class="lh-hb-h">My hunt</h2><p class="lh-hb-empty">No legs yet. Tap + ADD on any prop to start a hunt.</p>`;
      return;
    }
    loadGames(legs);
    const firstOfGame = {};
    legs.forEach((leg, i) => { if (!(leg.gameId in firstOfGame)) firstOfGame[leg.gameId] = i; });
    const groups = groupsOf(legs);
    groups.forEach(startTogether);
    const same = groups.length ? " · same game" : "";
    const win = t && stake > 0 ? money(Math.round(stake * (t.decimal - 1) * 100) / 100) : "–";
    const hadFocus = document.activeElement && document.activeElement.id === "huntsStake";
    box.innerHTML = `
      ${sheetTop()}
      <h2 class="lh-hb-h">My hunt <small>${legs.length} leg${legs.length === 1 ? "" : "s"}${same}</small></h2>
      <ul class="lh-hbl-list">${legs.map((leg, i) => legHtml(leg, i, firstOfGame[leg.gameId])).join("")}</ul>
      <div class="lh-hbs">
        <div class="lh-hbs-big"><span>Combined odds</span><b>${t ? fmt(t.american) : "–"}</b></div>
        <div><span>Implied chance</span><b>${t ? `${t.implied.toFixed(1)}%` : "–"}</b></div>
        <div><span>Stake</span><b><span class="lh-hbs-stake">$<input id="huntsStake" type="number" min="0" step="1" inputmode="decimal" value="${stake}" aria-label="Stake"></span></b></div>
        <div><span>To win</span><b class="lh-hbs-win">${win}</b></div>
      </div>
      ${groups.map(togetherHtml).join("")}
      <div class="lh-hb-btns">
        <button type="button" data-hb="share">Share</button>
        <button type="button" data-hb="post">Post to X</button>
        <button type="button" data-hb="image" class="is-wide"><i class="bi bi-image" aria-hidden="true"></i> Save as image</button>
      </div>
      <div class="lh-hb-books-label">Open the book</div>
      <div class="lh-hb-books">
        <a href="https://sportsbook.fanduel.com/" target="_blank" rel="noopener">FanDuel ›</a>
        <a href="https://sportsbook.draftkings.com/" target="_blank" rel="noopener">DraftKings ›</a>
      </div>
      <button type="button" class="lh-hb-clear" data-hb="clear">Clear all</button>
      <p class="lh-hb-legal">Past results, not a prediction. Bet within your limits · 21+ · 1-800-GAMBLER.</p>`;
    if (hadFocus) { const input = document.getElementById("huntsStake"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  // ---------- Save as image (the picture follows the page's theme, like the other share pictures) ----------
  function imageHtml(legs) {
    const t = totals(legs);
    const info = gameFor(legs[0].gameId);
    const sub = legs.length === 1 && info && info !== "loading" ? `${info.away} @ ${info.home}` : "";
    const when = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const groups = groupsOf(legs);
    const best = groups.map((g) => ({ g, t: together[signature(g)] })).find((x) => x.t && x.t.state === "done" && x.t.cells.length);
    return `
      ${shareBrandHtml(when)}
      <div class="lh-hi">
        <h2 class="lh-hi-title">${legs.length}-leg hunt</h2>
        ${sub ? `<div class="lh-hi-sub">${esc(sub)}</div>` : ""}
        ${legs.map((leg) => `
          <div class="lh-hi-leg lh-hi-leg--${leg.side}">
            <div><b>${esc(lastName(leg.player))} ${sideWord(leg)} ${leg.line} ${esc(huntStatName(leg.stat))}</b></div>
            <div class="lh-hi-odds">${fmt(leg.odds)}<small>${esc(lhHunts.bookLabel(leg.book) || "")}</small></div>
          </div>`).join("")}
        <div class="lh-hi-total"><span>Combined odds</span><b>${t ? fmt(t.american) : "–"}</b></div>
        ${best ? `<div class="lh-hi-hit"><div class="lh-hi-t">Hit together · same game · last ${best.t.cells.length} games</div>
          <b>${best.t.cells.filter(Boolean).length}/${best.t.cells.length}</b>
          <span class="lh-hbt-dots">${best.t.cells.map((hit) => `<i class="${hit ? "" : "is-miss"}"></i>`).join("")}</span></div>` : ""}
      </div>
      ${SHARE_NOTE_HTML}`;
  }

  box.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-hb-remove]");
    if (remove) { lhHunts.remove(remove.dataset.hbRemove); return; }
    const action = event.target.closest("[data-hb]");
    if (!action) return;
    const legs = lhHunts.getAll();
    const kind = action.dataset.hb;
    if (kind === "close") { closeTicket(); return; }
    if (kind === "share") document.getElementById("lhHuntsShare").click();
    else if (kind === "post") document.getElementById("lhHuntsPost").click();
    else if (kind === "clear") { if (window.confirm("Clear every leg from My Hunts?")) lhHunts.clear(); }
    else if (kind === "image" && legs.length) {
      shareNodeAsImage(imageHtml(legs), { filename: "linehunter-hunt.png", title: "My hunt", text: "My hunt on LineHunter.", button: action });
    }
  });

  box.addEventListener("input", (event) => {
    if (event.target.id !== "huntsStake") return;
    const value = Math.round(Number(event.target.value) * 100) / 100;
    stake = Number.isFinite(value) && value > 0 ? value : 0;
    try { if (stake > 0) localStorage.setItem(STAKE_KEY, String(stake)); } catch (error) { /* kept for this visit */ }
    const t = totals(lhHunts.getAll());
    const win = box.querySelector(".lh-hbs-win");
    if (win) win.textContent = t && stake > 0 ? money(Math.round(stake * (t.decimal - 1) * 100) / 100) : "–";
  });

  const bar = document.getElementById("huntsBar");
  if (bar) bar.addEventListener("click", openTicket);

  document.addEventListener("lh-hunts-change", render);
  render();
})();

// ---------- The picker: simple prop rows from the slate (js/components/top-hit-rates.js builds and announces it) ----------
(function () {
  const list = document.getElementById("hbpList");
  if (!list) return;
  const CODES = ["pts", "reb", "ast", "3pm", "pra", "stl", "blk"];
  const SHORT = { pts: "PTS", reb: "REB", ast: "AST", "3pm": "3PM", pra: "PRA", stl: "STL", blk: "BLK" };
  const PAGE = 30;
  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const state = { game: "all", code: "all", side: "over", query: "", shown: PAGE };
  let slate = null;

  const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
  const gameLabel = (rows) => {
    const r = rows[0];
    const opp = r.opp || (r.matchup || "").split(" ").pop();
    return String(r.matchup || "").startsWith("@") ? `${r.team} @ ${opp}` : `${opp} @ ${r.team}`;
  };

  function items() {
    const injuries = (slate && slate.injuries) || {};
    const out = [];
    slate.rows.forEach((row) => {
      if (!CODES.includes(row.code)) return;
      if (state.code !== "all" && row.code !== state.code) return;
      if (state.game !== "all" && String(row.gameId) !== state.game) return;
      if (state.query && !plNameMatches(row.name, state.query)) return;
      if (plIsInjuredOut(injuries[row.playerId])) return;
      const games = row.w && row.w[10] ? row.w[10].games : [];
      if (games.length < 8 || row.line === null || row.line === undefined) return;
      const over = plStatsAtLine(games, row.line, "over");
      const under = plStatsAtLine(games, row.line, "under");
      const side = state.side === "both" ? (under.hitRate > over.hitRate ? "under" : "over") : state.side;
      out.push({ row, side, stats: side === "under" ? under : over });
    });
    out.sort((a, b) => (new Date(a.row.tip) - new Date(b.row.tip)) || (a.row.gameId - b.row.gameId) || (b.stats.hitRate - a.stats.hitRate)
      || (b.stats.totalGames - a.stats.totalGames) || (b.stats.streak - a.stats.streak));
    return out;
  }

  function rowHtml({ row, side, stats }) {
    const name = row.name.trim().split(/\s+/);
    const first = name[0];
    const last = name.slice(1).join(" ") || name[0];
    const type = PROP_CODES[row.code];
    const best = lhOdds.getOdds(row.playerId, type, row.line, side)[0];
    const leg = { playerId: row.playerId, player: row.name, team: row.team, opp: row.opp || (row.matchup || "").split(" ").pop(), gameId: row.gameId,
      tipoff: row.tip || null, stat: type, side, line: row.line, odds: best ? Number(best.odds) : null, book: best ? best.vendor : null, isAlt: false };
    const hit = stats.hitRate >= 75 ? "lh-hr-hi" : stats.hitRate >= 50 ? "lh-hr-md" : "lh-hr-lo";
    return `
      <div class="lh-hbp-row">
        ${typeof playerAvatarHtml === "function" ? playerAvatarHtml({ first, last, team: row.team, className: "lh-bd-avatar" }) : ""}
        <div class="lh-hbp-who"><small>${esc(first)}</small><b>${esc(last)}</b><span>${esc(row.matchup)}${row.tip ? ` · ${timeOf(row.tip)}` : ""}</span></div>
        <div class="lh-hbp-pick is-${side}"><b>${side === "under" ? "Under" : "Over"} ${lineText(row.line)} ${SHORT[row.code]}</b>
          <span><i class="${hit}">${stats.hits}/${stats.totalGames}</i> L10 · avg ${formatStatValue(stats.average)}</span></div>
        <span class="lh-hbp-odds${best ? "" : " is-none"}">${best ? `${best.odds > 0 ? "+" : "−"}${Math.abs(best.odds)} <small>${esc(lhHunts.bookLabel(best.vendor))}</small>` : "no odds"}</span>
        ${best ? huntButtonHtml(leg, { labelOut: "Add to builder", labelIn: "Added", iconFirst: true, className: "lh-hbp-add" })
          : `<button type="button" class="lh-hbp-add" disabled aria-disabled="true" title="No odds posted for this prop"><i class="lh-add-icon bi bi-plus-lg" aria-hidden="true"></i> Add to builder</button>`}
      </div>`;
  }

  function drawGames() {
    const byGame = {};
    slate.rows.forEach((row) => { (byGame[row.gameId] = byGame[row.gameId] || []).push(row); });
    const games = Object.entries(byGame).sort((a, b) => new Date(a[1][0].tip) - new Date(b[1][0].tip));
    document.getElementById("hbpGames").innerHTML = `<button type="button" class="lh-hbp-chip${state.game === "all" ? " is-on" : ""}" data-game="all">All games<small>${games.length} games</small></button>`
      + games.map(([id, rows]) => `<button type="button" class="lh-hbp-chip${state.game === id ? " is-on" : ""}" data-game="${id}">${esc(gameLabel(rows))}<small>${timeOf(rows[0].tip)}</small></button>`).join("");
    document.getElementById("hbpProps").innerHTML = ["all", ...CODES].map((c) =>
      `<li class="nav-item"><button type="button" class="nav-link${state.code === c ? " active" : ""}" data-code="${c}">${c === "all" ? "All" : SHORT[c]}</button></li>`).join("");
    document.getElementById("hbpSide").innerHTML = [["over", "Over"], ["under", "Under"], ["both", "Both"]].map(([v, l]) =>
      `<button type="button" class="btn btn-ghost${state.side === v ? " active" : ""}" data-side="${v}" aria-pressed="${state.side === v}">${l}</button>`).join("");
  }

  function render() {
    list.removeAttribute("aria-busy");
    if (!slate) return;
    const found = items();
    const shown = found.slice(0, state.shown);
    document.getElementById("hbpCount").textContent = `${found.length} prop${found.length === 1 ? "" : "s"}`;
    if (!found.length) {
      list.innerHTML = `<div class="lh-top-message text-muted">${state.query ? `No players match “${esc(state.query)}”.` : "No props for these filters."}</div>`;
    } else {
      let lastGame = null;
      list.innerHTML = shown.map((item) => {
        let head = "";
        if (state.game === "all" && item.row.gameId !== lastGame) {
          lastGame = item.row.gameId;
          head = `<div class="lh-hbp-game">${esc(gameLabel([item.row]))} · ${timeOf(item.row.tip)}</div>`;
        }
        return head + rowHtml(item);
      }).join("");
    }
    document.getElementById("hbpMore").hidden = found.length <= shown.length;
  }

  document.addEventListener("lh-top-slate", (event) => {
    const detail = event.detail || {};
    if (detail.message) { list.innerHTML = `<div class="lh-top-message text-muted">${detail.message}</div>`; return; }
    if (!detail.slate) return;
    slate = detail.slate;
    if (state.game !== "all" && !slate.rows.some((r) => String(r.gameId) === state.game)) state.game = "all";
    const date = document.getElementById("hbpDate");
    if (date && slate.date && typeof slateDateLabel === "function") date.textContent = slateDateLabel(slate.date);
    drawGames();
    render();
  });
  document.addEventListener("lh-odds-ready", () => { if (slate) render(); });

  document.getElementById("huntsPicker").addEventListener("click", (event) => {
    const game = event.target.closest("[data-game]");
    const code = event.target.closest("[data-code]");
    const side = event.target.closest("[data-side]");
    if (game) state.game = game.dataset.game;
    else if (code) state.code = code.dataset.code;
    else if (side) state.side = side.dataset.side;
    else if (event.target.closest("#hbpMore")) { state.shown += PAGE; render(); return; }
    else return;
    state.shown = PAGE;
    drawGames();
    render();
  });
  document.getElementById("hbpSearch").addEventListener("input", (event) => { state.query = event.target.value; state.shown = PAGE; render(); });
})();
