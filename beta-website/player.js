// A player's prop research screen: player.html?p=MarcusVale. The data is SAMPLE data from league.js.
(function () {
  const P = LEAGUE.player(new URLSearchParams(location.search).get("p"));
  if (!P) {
    document.title = "Line Hunter | Player not found";
    document.querySelector(".rs-page").innerHTML = '<section class="rs-panel rs-missing"><h1>Player not found</h1><p>We couldn\'t find that player. They may not have an active streak right now.</p><a class="rs-empty-clear" href="streak-board.html" data-wipe>Back to the Streak Board</a></section>';
    document.getElementById("dock").remove();
    document.querySelector(".rs-skip").remove();
    return;
  }
  const { log: LOG, stats: STATS, games: GAMES } = P;
  const MATE = P.mateShort;
  const injuriesOf = LEAGUE.injuries;
  const defenseOf = (opp) => LEAGUE.defense(P, opp);
  const LINE_REACH = 10;    // how far from the posted line the books offer
  const LADDER_REACH = 3;   // rungs shown on each side of the posted line
  const THIN_SAMPLE = 5;    // below this many games, there's no verdict at all
  const SMALL_SAMPLE = 15;  // below this many games, results carry a small-sample warning
  const MIN_BAR_SCALE = 10; // percentage points a full ladder bar stands for, at the least
  const PART_NAMES = { pts: "Pts", reb: "Reb", ast: "Ast", tpm: "3PM" };
  const RANGES = [["L5", "L5"], ["L10", "L10"], ["L20", "L20"], ["H2H", "H2H"], ["26-27", "26-27"], ["25-26", "25-26"], ["ALL", "All"]];
  // Only things you can know before tip-off. Win, loss and minutes would be hindsight.
  const FILTERS = [["home", "Home"], ["away", "Away"], ...(P.mate ? [["noMate", `Without ${MATE}`]] : []), ["b2b", "Back-to-back"], ["rested", "2+ days rest"]];
  const RANGE_NAMES = { L5: "Last 5", L10: "Last 10", L20: "Last 20", "26-27": "2026-27 season", "25-26": "2025-26 season", ALL: "All games" };
  const OPPOSITES = { home: "away", away: "home", b2b: "rested", rested: "b2b" };

  const BOOKS = LEAGUE.BOOKS;

  const state = { stat: P.defaultStat, line: STATS[P.defaultStat].line, side: P.defaultSide, range: "L20", game: 0, filters: new Set(), min: false, usg: false, pin: null };
  const $ = (id) => document.getElementById(id);

  const atLimit = (button, limited) => button.setAttribute("aria-disabled", limited);
  const postedLine = () => STATS[state.stat].line + (STATS[state.stat].moves ? GAMES[state.game].shift : 0);
  const value = (g) => STATS[state.stat].parts.reduce((sum, part) => sum + g[part], 0);
  const hitsAt = (g, line) => (state.side === "Over" ? value(g) > line : value(g) < line);
  const isHit = (g) => hitsAt(g, state.line);
  const fmtOdds = (o) => (o > 0 ? `+${o}` : `−${Math.abs(o)}`);
  const payout = (o) => (o > 0 ? o : 10000 / -o);
  const breakeven = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100)) * 100;
  const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
  // Hit rates only: 49 and below red, 50 to 74 yellow, 75 and up green. Break-even and usage stay neutral.
  const pctClass = (p) => `rs-pct ${Math.round(p) >= 75 ? "rs-pct-high" : Math.round(p) >= 50 ? "rs-pct-mid" : "rs-pct-low"}`;
  const pctSpan = (p, text = `${Math.round(p)}%`) => `<span class="${pctClass(p)}">${text}</span>`;
  const signedGap = (gap, small, percent = "%") => {
    const shown = small ? Math.round(Math.abs(gap)) : Math.abs(gap).toFixed(1);
    return Number(shown) === 0 ? `${shown}${percent}` : `${gap >= 0 ? "\u25b2" : "\u25bc"}${shown}${percent}`;
  };
  const countGames = (n) => `${n} game${n === 1 ? "" : "s"}`;

  // Games for a time range, before the filters are applied. Always oldest to newest.
  function inRange(range) {
    if (range === "ALL") return LOG;
    if (range === "L5") return LOG.slice(-5);
    if (range === "L10") return LOG.slice(-10);
    if (range === "L20") return LOG.slice(-20);
    if (range === "H2H") return LOG.filter((g) => g.opp === GAMES[state.game].opp);
    return LOG.filter((g) => g.season === range);
  }

  function passesFilters(g, f = state.filters) {
    if (f.has("home") && !g.home) return false;
    if (f.has("away") && g.home) return false;
    if (f.has("noMate") && !g.mateOut) return false;
    if (f.has("b2b") && g.restDays !== 1) return false;
    if (f.has("rested") && g.restDays < 2) return false;
    return true;
  }

  const visible = (range = state.range) => inRange(range).filter((g) => passesFilters(g));

  // What a filter chip would leave if it were turned on, given the current range and other filters.
  function countWith(key) {
    const f = new Set(state.filters);
    f.add(key);
    if (OPPOSITES[key]) f.delete(OPPOSITES[key]);
    return inRange(state.range).filter((g) => passesFilters(g, f)).length;
  }

  const mateIsOut = () => Boolean(P.mate);
  // How much each known condition changes his game: a missing star most, then rest, then the building.
  const CONDITION_WEIGHT = { noMate: 4, b2b: 2, rested: 2, home: 1, away: 1 };
  // The closest combination of this game's conditions that still leaves enough games to compare.
  function matchPlan() {
    const g = GAMES[state.game];
    const all = [g.where === "vs" ? "home" : "away", g.backToBack ? "b2b" : "rested"];
    if (mateIsOut()) all.push("noMate");
    const count = (keys) => LOG.filter((x) => passesFilters(x, new Set(keys))).length;
    const weight = (keys) => keys.reduce((sum, k) => sum + CONDITION_WEIGHT[k], 0);
    const options = [];
    for (let mask = 1; mask < 1 << all.length; mask++) options.push(all.filter((_, i) => mask & (1 << i)));
    const kept = options.filter((keys) => count(keys) >= THIN_SAMPLE).sort((a, b) => weight(b) - weight(a))[0] || [];
    return { kept, dropped: all.filter((k) => !kept.includes(k)), count: count(kept) };
  }
  const CONDITION_WORDS = { home: "home", away: "away", b2b: "back-to-back", rested: "2+ days rest", noMate: `without ${MATE}` };
  const CONDITION_LABELS = { home: "Home", away: "Away", b2b: "Back-to-back", rested: "2+ days rest", noMate: `without ${MATE}` };
  const matchLabel = (keys) => {
    const words = keys.map((k) => CONDITION_LABELS[k]).join(" ") || "All games";
    return words[0].toUpperCase() + words.slice(1);
  };
  const leftOutWords = (plan) => (plan.dropped.length
    ? ` Adding ${plan.dropped.map((k) => CONDITION_WORDS[k]).join(" or ")} would leave too few games.`
    : "");
  const filtersArePlan = () => {
    const { kept } = matchPlan();
    return state.filters.size === kept.length && kept.every((k) => state.filters.has(k));
  };
  const isMatched = () => beforeMatch !== null && state.range === "ALL" && filtersArePlan();

  // Plain words for a defense's rank, so "26th toughest" doesn't have to be decoded.
  const defenseRank = () => {
    const stat = STATS[state.stat];
    const d = defenseOf(GAMES[state.game].opp);
    return Math.round(stat.parts.reduce((sum, part) => sum + d[part][1], 0) / stat.parts.length);
  };
  const rankWords = (rank) => (rank <= 15 ? `${ordinal(rank)} toughest` : `${ordinal(31 - rank)} weakest`);
  const rate = (games) => (games.length ? Math.round((games.filter(isHit).length / games.length) * 100) : null);

  // Counts every game, whatever the range and filters are set to. Labeled that way on screen.
  function currentStreak() {
    let streak = 0;
    for (let i = LOG.length - 1; i >= 0 && isHit(LOG[i]); i--) streak++;
    return streak;
  }

  const oddsFor = (book, line = state.line) => LEAGUE.odds(P, state.game, state.stat, state.side, line, book);

  function bestPrice(line = state.line) {
    return BOOKS.map((name, book) => ({ name, book, price: oddsFor(book, line) }))
      .filter((o) => LEAGUE.offers(P, state.game, state.stat, o.book))
      .reduce((best, o) => (payout(o.price) > payout(best.price) ? o : best));
  }

  // A line's hit rate across wider and wider samples. A longer range that adds no games is skipped.
  function sampleSpread(line = state.line) {
    const spread = [];
    ["L10", "L20", "ALL"].forEach((r) => {
      const set = visible(r);
      if (set.length >= THIN_SAMPLE && !spread.some((s) => s.n === set.length)) {
        spread.push({ name: r === "ALL" ? "All" : r, n: set.length, pct: (set.filter((g) => hitsAt(g, line)).length / set.length) * 100 });
      }
    });
    return spread;
  }
  const listWords = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(""));

  // The sample in words, so a percentage always says what it is based on.
  function sampleWords(count) {
    const f = state.filters;
    const kinds = [f.has("home") && "home", f.has("away") && "away", f.has("b2b") && "back-to-back", f.has("rested") && "rested"].filter(Boolean).join(", ");
    const noun = `${count} ${kinds ? `${kinds} ` : ""}game${count === 1 ? "" : "s"}${f.has("noMate") ? ` without ${MATE}` : ""}`;
    if (state.range === "H2H") return `${noun} against ${GAMES[state.game].opp}`;
    if (state.range === "25-26") return `${noun} in the 2025-26 season`;
    if (state.range === "26-27") return `${noun} in the 2026-27 season`;
    if (state.range === "ALL") return f.size === 0 ? `his ${count} games` : `${noun} from all his games`;
    const window = state.range.slice(1);
    return f.size === 0 ? `his last ${window} games` : `${noun} from his last ${window}`;
  }

  let chipStop = FILTERS[0][0]; // the one filter chip that is a Tab stop; arrow keys reach the others
  function renderControls() {
    const posted = postedLine();
    $("line").textContent = state.line.toFixed(1);
    atLimit($("line-down"), state.line <= Math.max(0.5, posted - LINE_REACH));
    atLimit($("line-up"), state.line >= posted + LINE_REACH);
    document.querySelectorAll("#side button, #dock-side button").forEach((b) => {
      b.setAttribute("aria-checked", b.dataset.side === state.side);
      b.tabIndex = b.dataset.side === state.side ? 0 : -1;
    });

    const best = bestPrice();
    $("books").innerHTML = BOOKS.map((name, book) => {
      const isBest = name === best.name;
      return `<li class="${isBest ? "is-best" : ""}"><span>${isBest ? `Best: ${name}` : name}</span><b>${LEAGUE.offers(P, state.game, state.stat, book) ? fmtOdds(oddsFor(book)) : "\u2014"}</b></li>`;
    }).join("");

    $("game-select").value = state.game;

    $("filters").innerHTML = FILTERS.map(([key, label]) => `
      <button type="button" data-filter="${key}" tabindex="${key === chipStop ? 0 : -1}"${countWith(key) === 0 && !state.filters.has(key) ? ' aria-disabled="true"' : ""} aria-pressed="${state.filters.has(key)}" aria-label="${label}: ${countGames(countWith(key))}">${label} <span class="rs-chip-count">${countWith(key)}</span></button>`).join("");
    $("clear-filters").hidden = state.filters.size === 0;
    $("filter-summary").textContent = state.filters.size ? `Filter games \u00b7 ${state.filters.size} on` : "Filter games";

    $("ranges").innerHTML = RANGES.map(([key, label]) => {
      const set = visible(key);
      const hits = set.filter(isHit).length;
      const name = key === "H2H" ? `vs ${GAMES[state.game].opp}` : label;
      const thin = set.length > 0 && set.length < THIN_SAMPLE;
      return `<button type="button" role="radio" class="${thin ? "is-thin" : ""}" data-range="${key}" aria-checked="${state.range === key}" tabindex="${state.range === key ? 0 : -1}">
        <span>${name}</span>
        <small${set.length ? ` class="${pctClass(rate(set))}"` : ""}>${set.length ? `${rate(set)}%` : "–"}</small>
        <small>${set.length ? `${hits}–${set.length - hits}` : "0 games"}</small>
      </button>`;
    }).join("");
  }

  // Phones: the same ranges as a drop menu.
  function renderRangeMenu() {
    $("range-select").innerHTML = RANGES.map(([key]) => {
      const set = visible(key);
      const hits = set.filter(isHit).length;
      const name = key === "H2H" ? `vs ${GAMES[state.game].opp}` : RANGE_NAMES[key];
      return `<option${set.length ? ` class="${pctClass(rate(set))}"` : ""} value="${key}"${state.range === key ? " selected" : ""}>${name}: ${!set.length ? "0 games" : set.length < THIN_SAMPLE ? `${hits}\u2013${set.length - hits} (${rate(set)}%)` : `${rate(set)}% (${hits}\u2013${set.length - hits})`}</option>`;
    }).join("");
    // The closed menu takes the color of what's selected
    const selected = visible();
    $("range-select").className = selected.length ? pctClass(rate(selected)) : "";
  }

  // Skips the first render so a screen reader doesn't read a result before anything has changed.
  const openRows = new Set();
  let rendered = false;
  function announce(message) {
    if (rendered) $("status").textContent = message;
  }

  function renderDock(games) {
    const best = bestPrice();
    const pct = rate(games);
    const posted = postedLine();
    $("dock-bet").textContent = `${state.side} ${state.line.toFixed(1)} ${STATS[state.stat].label}`;
    $("dock-detail").innerHTML = `${fmtOdds(best.price)} \u00b7 ${pct === null ? "No games" : games.length < THIN_SAMPLE ? `${games.filter(isHit).length}\u2013${games.filter((x) => !isHit(x)).length} (${pctSpan(pct)})` : `${pctSpan(pct)} in ${countGames(games.length)}`}`;
    atLimit($("dock-down"), state.line <= Math.max(0.5, posted - LINE_REACH));
    atLimit($("dock-up"), state.line >= posted + LINE_REACH);
  }

  function renderSummary(games) {
    const pct = rate(games);
    const hits = games.filter(isHit).length;
    const bet = `${state.side} ${state.line.toFixed(1)} ${STATS[state.stat].label}`;

    const avg = games.reduce((sum, g) => sum + value(g), 0) / (games.length || 1);
    const off = avg - state.line;
    $("hit-rate").textContent = games.length ? avg.toFixed(1) : "–";
    $("hit-rate").classList.toggle("is-thin", games.length < SMALL_SAMPLE);
    $("hit-record").textContent = games.length
      ? `average, ${Math.abs(off).toFixed(1)} ${off >= 0 ? "above" : "below"} the line${games.length < SMALL_SAMPLE ? ", small sample" : ""}`
      : "";

    if (!games.length) {
      $("hit-sentence").textContent = "No games to measure with these filters.";
      $("hit-sub").textContent = "";
      announce(`${bet}: no games match these filters.`);
      return;
    }
    const words = sampleWords(games.length);
    const gapFromLine = (set) => set.reduce((sum, g) => sum + Math.abs(value(g) - state.line), 0) / set.length;
    const hitGames = games.filter(isHit);
    const missGames = games.filter((g) => !isHit(g));
    const margins = [
      hitGames.length ? `hits ${state.side === "Over" ? "cleared" : "stayed under"} ${state.line.toFixed(1)} by ${gapFromLine(hitGames).toFixed(1)}` : "no hits",
      missGames.length ? `misses ${state.side === "Over" ? "fell short" : "went over"} by ${gapFromLine(missGames).toFixed(1)}` : "no misses",
    ].join(", ");
    $("hit-sentence").textContent = `Across ${words}${games.length === 1 ? "" : ", on average"}: ${margins}.`;
    const price = bestPrice();
    announce(`${bet} hit in ${hits} of ${words}, ${pct}%. Best odds ${fmtOdds(price.price)} at ${price.name}, which needs ${breakeven(price.price).toFixed(1)}%.${isMatched() ? leftOutWords(matchPlan()) : ""}`);
    const streak = currentStreak();
    const streakWords = streak === 0
      ? "missed his last game"
      : `${streak} hit${streak === 1 ? "" : "s"} in a row`;
    const lastSeason = games.filter((g) => g.season === "25-26").length;
    const mixed = lastSeason > 0 && lastSeason < games.length ? `Includes ${countGames(lastSeason)} from last season \u00b7 ` : "";
    $("hit-sub").textContent = `${mixed}Streak across all his games: ${streakWords}`;
  }

  // The signature of the screen: nearby lines side by side, each with its past
  // hit rate and a bar growing up or down from the hit rate its best price needs to break even.
  function renderLadder(games) {
    const posted = postedLine();
    const g = GAMES[state.game];
    const best = bestPrice();
    const need = breakeven(best.price);
    const pct = rate(games);

    $("bet").textContent = `${state.side} ${state.line.toFixed(1)} ${STATS[state.stat].label}`;
    const out = [[P.team, injuriesOf(P.team)], [g.opp, injuriesOf(g.opp)]]
      .flatMap(([team, list]) => list.filter((p) => p[2] === "Out").map((p) => `${p[0]}<span class="rs-wide-only"> (${team} ${p[1]})</span>`));
    $("bet-out").innerHTML = out.length ? `Out: ${out.join(", ")}` : "";

    const matched = isMatched();
    const plan = matchPlan();
    const match = $("match-tonight");
    match.classList.toggle("is-on", matched);
    match.innerHTML = matched
      ? "Undo match"
      : `Match<span class="rs-wide-only"> ${state.game === 0 ? "tonight" : "this game"}</span> \u00b7 ${countGames(plan.count)}<small>${matchLabel(plan.kept)}<span class="rs-wide-only">, all seasons</span></small>`;
    match.title = matched ? "Go back to the games you had" : `Show the games closest to ${state.game === 0 ? "tonight" : "this game"}`;
    const withMate = mateIsOut() && !state.filters.has("noMate") ? games.filter((x) => !x.mateOut).length : 0;
    const mateWords = withMate ? `, ${withMate === games.length ? "all" : withMate} with ${MATE}` : "";
    $("sample-words").textContent = games.length
      ? `${matched ? (state.game === 0 ? "Games like tonight" : "Games like this one") : "Based on"}: ${sampleWords(games.length)}${games.length < SMALL_SAMPLE ? " (small sample)" : ""}${mateWords}.${matched ? leftOutWords(plan) : ""}`
      : "No games match these filters";

    const hitCount = games.filter(isHit).length;
    const small = games.length < SMALL_SAMPLE; // a small sample doesn't earn a decimal
    const thinHead = games.length > 0 && games.length < THIN_SAMPLE;
    const exact = games.length ? (hitCount / games.length) * 100 : 0;
    const gap = exact - need;
    let caution = "";
    if (!games.length) caution = "No games to compare. Remove a filter or widen the range.";
    else if (thinHead) caution = state.filters.size ? "Too few games to compare. Remove a filter for a bigger sample." : "Too few games to compare.";
    const hitBox = !games.length
      ? '<dd class="rs-readout-num">\u2013</dd><dd>No games</dd>'
      : thinHead
        ? `<dd class="rs-readout-num">${hitCount} of ${games.length}</dd><dd>Too few games</dd>`
        : small
          ? `<dd class="rs-readout-num">${hitCount} of ${games.length}</dd><dd>${pctSpan(exact)}</dd>`
          : `<dd class="rs-readout-num ${pctClass(exact)}">${exact.toFixed(1)}%</dd><dd>${hitCount} of ${games.length}</dd>`;
    const gapBox = !games.length || thinHead
      ? '<dd class="rs-readout-num">\u2013</dd><dd>&nbsp;</dd>'
      : `<dd class="rs-readout-num${small ? " is-soft" : ""}">${signedGap(gap, small)}</dd><dd>${Number(small ? Math.round(Math.abs(gap)) : Math.abs(gap).toFixed(1)) === 0 ? "about even" : `${gap >= 0 ? "above" : "below"}${small ? ", roughly" : ""}`}</dd>`;
    const spread = sampleSpread();
    if (!["L10", "L20", "ALL"].includes(state.range) && games.length >= THIN_SAMPLE) {
      spread.unshift({ name: state.range === "H2H" ? `vs ${g.opp}` : RANGES.find(([key]) => key === state.range)[1], n: games.length, pct: exact });
    }
    const inList = (list) => listWords(list.map((s) => `${s.name} ${Math.round(s.pct)}%`));
    const clears = spread.filter((s) => s.pct >= need);
    const misses = spread.filter((s) => s.pct < need);
    const spreadWords = spread.length < 2
      ? ""
      : clears.length
        ? `Clears it in ${inList(clears)}${misses.length ? `, not ${inList(misses)}` : ""}.`
        : `Short of it in ${inList(misses)}.`;
    // A sample of past games says nothing about a defense it never played, so say so when that cuts against the bet.
    const rank = defenseRank();
    const against = games.length >= THIN_SAMPLE && state.range !== "H2H" && (state.side === "Over" ? rank <= 10 : rank >= 21);
    $("bet-matchup").innerHTML = `${g.backToBack ? "Back-to-back \u00b7 " : ""}${g.opp} defense: ${rankWords(rank)} of 30${against ? '. <b class="rs-matchup-warn">Sample ignores this.</b>' : '<span class="rs-wide-only"> against point guards</span>'}`;
    $("price").innerHTML = `
      <dl class="rs-readout">
        <div><dt>Hit rate</dt>${hitBox}</div>
        <div><dt>Needs</dt><dd class="rs-readout-num">${need.toFixed(1)}%</dd><dd>${fmtOdds(best.price)} at ${best.name}</dd></div>
        <div><dt>Vs break-even</dt>${gapBox}</div>
      </dl>
      <p class="rs-spread">${caution || spreadWords}</p>`;

    // Stay centered on the posted line until the chosen line walks off the ladder.
    const center = Math.abs(state.line - posted) <= LADDER_REACH ? posted : state.line;
    const lines = [];
    for (let i = -LADDER_REACH; i <= LADDER_REACH; i++) {
      const line = center + i;
      if (line >= Math.max(0.5, posted - LINE_REACH) && line <= posted + LINE_REACH) lines.push(line);
    }

    const thinSet = games.length > 0 && games.length < THIN_SAMPLE;
    $("rungs").classList.toggle("is-empty", games.length === 0);
    // Each line against its price in the three standard samples. Too few games shows as a dash.
    const sampleMarks = (line, lineNeed) => ["L10", "L20", "ALL"].map((r) => {
      const set = visible(r);
      const clears = set.length >= THIN_SAMPLE && (set.filter((x) => hitsAt(x, line)).length / set.length) * 100 >= lineNeed;
      return { name: r === "ALL" ? "All" : r, mark: set.length < THIN_SAMPLE ? "none" : clears ? "yes" : "no" };
    });
    const rowLabels = thinSet
      ? [["Samples", "is-dots"], ["Record", "is-pct"], ["Hit rate", ""], ["Odds", ""]]
      : [["Samples", "is-dots"], ["Hit rate", "is-pct"], ["Odds", ""], ["Vs B/E", ""]];
    // The biggest gap on this ladder fills the space. The floor keeps tiny gaps looking tiny.
    const gapOf = (line) => (games.filter((x) => hitsAt(x, line)).length / (games.length || 1)) * 100 - breakeven(bestPrice(line).price);
    const barScale = Math.max(MIN_BAR_SCALE, ...lines.map((line) => Math.abs(gapOf(line))));
    const axis = games.length ? '<span class="rs-rung-axis is-above">Above</span><span class="rs-rung-axis is-below">Below</span>' : "";
    $("rungs").innerHTML = `<div class="rs-rung-labels" aria-hidden="true"><span class="rs-rung-tag"></span><span class="rs-rung-plot">${axis}</span><span class="rs-rung-line">Line</span>${rowLabels.map(([text, cls]) => `<span class="rs-rung-label ${cls}">${text}</span>`).join("")}</div>` + lines.map((line) => {
      const hits = games.filter((x) => hitsAt(x, line)).length;
      const linePct = games.length ? Math.round((hits / games.length) * 100) : null;
      const price = bestPrice(line).price;
      const lineNeed = breakeven(price);
      const exactPct = games.length ? (hits / games.length) * 100 : null;
      const gap = exactPct === null ? null : exactPct - lineNeed;
      const marks = sampleMarks(line, lineNeed);
      const yes = marks.filter((m) => m.mark === "yes").map((m) => m.name);
      const no = marks.filter((m) => m.mark === "no").map((m) => m.name);
      const marksWords = yes.length ? ` Clears it in ${listWords(yes)}${no.length ? `, not ${listWords(no)}` : ""}.` : no.length ? ` Short of it in ${listWords(no)}.` : "";
      const grade = thinSet ? "is-thin" : "";
      const gapShown = gap === null ? "" : games.length < SMALL_SAMPLE ? `About ${Math.round(Math.abs(gap))}` : Math.abs(gap).toFixed(1);
      const gapWords = gap === null || thinSet ? (thinSet ? " Too few games to compare." : "") : ` ${gapShown} percentage points ${gap >= 0 ? "above" : "below"} break-even.`;
      const label = `${state.side} ${line.toFixed(1)}: ${linePct === null ? "no games" : `hit in ${hits} of ${games.length}, ${linePct}%`}. Best odds ${fmtOdds(price)} need ${lineNeed.toFixed(1)}%.${gapWords}${marksWords}${line === posted ? " Posted line." : ""}${line === state.pin ? " Pinned." : ""}`;
      return `<button type="button" role="radio" class="rs-rung ${grade}${line === state.pin ? " is-pinned" : ""}" data-line="${line}" aria-checked="${line === state.line}" tabindex="${line === state.line ? 0 : -1}" aria-label="${label}">
        <span class="rs-rung-tag">${line === state.pin ? "Pinned" : line === posted ? "Posted" : ""}</span>
        <span class="rs-rung-plot">
          ${gap === null ? "" : `<span class="rs-rung-fill ${gap < 0 ? "is-below" : "is-above"}" style="height:max(2px, ${(Math.abs(gap) / barScale) * 46}%)"></span>`}
          <span class="rs-rung-zero"></span>
        </span>
        <b class="rs-rung-line">${line.toFixed(1)}</b>
        <span class="rs-dots" aria-hidden="true">${marks.map((m) => `<i class="${m.mark}"></i>`).join("")}</span>
        ${thinSet ? `<span class="rs-rung-pct">${hits}\u2013${games.length - hits}</span><span class="rs-rung-small ${pctClass(linePct)}">${linePct}%</span>` : `<span class="rs-rung-pct${linePct === null ? "" : ` ${pctClass(linePct)}`}">${linePct === null ? "–" : `${linePct}%`}</span>`}
        <span class="rs-rung-odds">${fmtOdds(price)}${line === state.line && games.length ? `<i class="rs-rung-need"> \u00b7 needs ${lineNeed.toFixed(1)}%</i>` : ""}</span>
        ${thinSet ? "" : `<span class="rs-rung-gap">${gap === null ? "&nbsp;" : signedGap(gap, games.length < SMALL_SAMPLE, '<span class="rs-wide-only">%</span>')}</span>`}
      </button>`;
    }).join("");

    const dotsKey = '<span><span class="rs-dots" aria-hidden="true"><i class="yes"></i><i class="yes"></i><i class="no"></i></span>Clears break-even in L10, L20, All</span>';
    $("rung-key").innerHTML = !games.length
      ? ""
      : `${dotsKey}${thinSet ? '<span><i class="rs-swatch rs-key-thin"></i>Under 5 games: hollow bars</span>' : ""}<span>Number color = how often it hit</span>`;
    $("tick-note").textContent = "White line = break-even. Green \u25b2 above it, red \u25bc below it.";
    const reset = $("reset-line");
    reset.hidden = state.line === posted;
    reset.textContent = `Back to the posted line (${posted.toFixed(1)})`;
  }

  // Two lines side by side, so a regular doesn't have to hold one in their head.
  function renderCompare(games) {
    const box = $("compare");
    const pin = state.pin;
    $("pin-line").textContent = pin === null ? `Pin ${state.line.toFixed(1)} to compare` : `Unpin ${pin.toFixed(1)}`;
    box.hidden = pin === null;
    if (pin === null) { box.innerHTML = ""; return; }
    if (pin === state.line) {
      box.innerHTML = `<p class="rs-compare-note">${state.side} ${pin.toFixed(1)} is pinned. Select another line to compare them.</p>`;
      return;
    }
    const pair = [state.line, pin];
    const small = games.length < SMALL_SAMPLE;
    const thin = games.length < THIN_SAMPLE;
    const row = (name, cells, diff = "") => `<tr><th scope="row">${name}</th><td>${cells[0]}</td><td>${cells[1]}</td><td class="rs-compare-diff rs-wide-only">${diff}</td></tr>`;
    const need = pair.map((line) => breakeven(bestPrice(line).price));
    const sampleRow = (range, label) => {
      const set = visible(range);
      const rates = pair.map((line) => (set.length ? (set.filter((x) => hitsAt(x, line)).length / set.length) * 100 : null));
      const cells = pair.map((line, i) => {
        if (!set.length) return "\u2013";
        const hits = set.filter((x) => hitsAt(x, line)).length;
        return set.length < THIN_SAMPLE ? `${hits}\u2013${set.length - hits} ${pctSpan(rates[i])}` : pctSpan(rates[i]);
      });
      const diff = set.length >= THIN_SAMPLE ? `${Math.abs(Math.round(rates[0]) - Math.round(rates[1]))} apart` : "";
      return row(`Hit rate, ${label}`, cells, diff);
    };
    const current = RANGES.find(([key]) => key === state.range);
    const others = [["L10", "L10"], ["L20", "L20"], ["ALL", "All"]];
    const sampleRows = (others.some(([key]) => key === state.range) ? others : [[current[0], current[0] === "H2H" ? `vs ${GAMES[state.game].opp}` : current[1]], ...others])
      .map(([key, label]) => sampleRow(key, label)).join("");
    const gaps = pair.map((line, i) => {
      if (thin) return "\u2013";
      return signedGap((games.filter((x) => hitsAt(x, line)).length / games.length) * 100 - need[i], small);
    });
    const margin = (line, wantHit) => {
      const set = games.filter((x) => hitsAt(x, line) === wantHit);
      return set.length ? (set.reduce((sum, x) => sum + Math.abs(value(x) - line), 0) / set.length).toFixed(1) : "\u2013";
    };
    const over = state.side === "Over";
    box.innerHTML = `<table>
      <caption class="sr-only">Comparing ${state.side} ${pair[0].toFixed(1)} and ${state.side} ${pair[1].toFixed(1)}</caption>
      <thead><tr><td></td>
        <th scope="col">${state.side} ${pair[0].toFixed(1)}<small>Selected</small></th>
        <th scope="col">${state.side} ${pair[1].toFixed(1)}<small>Pinned</small></th>
        <td class="rs-compare-diff rs-wide-only">Difference</td></tr></thead>
      <tbody>
        ${row("Best odds", pair.map((line) => fmtOdds(bestPrice(line).price)))}
        ${row("Needs", need.map((n) => `${n.toFixed(1)}%`), `${Math.abs(need[0] - need[1]).toFixed(1)} apart`)}
        ${sampleRows}
        ${row("Vs break-even", gaps)}
        ${row(over ? "Hits cleared by" : "Hits stayed under by", pair.map((line) => margin(line, true)))}
        ${row(over ? "Misses fell short by" : "Misses went over by", pair.map((line) => margin(line, false)))}
      </tbody></table>`;
  }

  function renderLegend() {
    const parts = STATS[state.stat].parts;
    $("legend").innerHTML =
      parts.map((part, i) => `<span><i class="rs-swatch rs-seg-${i}"></i>${PART_NAMES[part]}</span>`).join("") +
      `<span><i class="rs-swatch rs-swatch-miss"></i>Miss</span><span><i class="rs-swatch rs-swatch-line"></i>The line</span>`;
  }

  // The screen's one authored motion: stepping or re-sampling moves each bar from where it
  // was to where it now is. Reads current positions, so an interrupted move continues from mid-flight.
  const MOVE = { duration: 280, easing: "cubic-bezier(.16, 1, .3, 1)" };
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  function readLadder() {
    const seen = new Map();
    $("rungs").querySelectorAll(".rs-rung").forEach((rung) => {
      seen.set(rung.dataset.line, signedBar(rung.querySelector(".rs-rung-fill")));
    });
    return seen;
  }
  // Height above the break-even line, negative below it.
  function signedBar(fill) {
    if (!fill) return 0;
    const height = fill.getBoundingClientRect().height;
    return fill.classList.contains("is-below") ? -height : height;
  }
  function moveLadder(before) {
    $("rungs").querySelectorAll(".rs-rung").forEach((rung) => {
      const old = before.get(rung.dataset.line);
      if (old === undefined) { rung.animate({ opacity: [0, 1] }, { duration: 180 }); return; }
      const fill = rung.querySelector(".rs-rung-fill");
      const now = signedBar(fill);
      if (Math.abs(old - now) <= 0.5) return;
      if (calm.matches) { rung.animate({ opacity: [0.55, 1] }, { duration: 140 }); return; } // same news, no travel
      // Scaled from the break-even line, so a bar changing sides passes straight through it.
      if (fill && now) fill.animate({ transform: [`scaleY(${old / now})`, "scaleY(1)"] }, MOVE);
    });
  }

  let chartGames = "";
  let chartStat = "";
  function renderChart(games) {
    const oldMark = $("chart").querySelector(".rs-line");
    const oldLine = oldMark ? oldMark.parentElement.getBoundingClientRect().bottom - oldMark.getBoundingClientRect().bottom : null;
    const keepLeft = $("chart").parentElement.scrollLeft;
    const chart = $("chart");
    const empty = $("chart-empty");
    chart.hidden = games.length === 0;
    $("chart-tip").hidden = games.length === 0;
    document.querySelector(".rs-key").hidden = games.length === 0;
    empty.hidden = games.length > 0;
    if (!games.length) $("scroll-hint").hidden = true;
    if (!games.length) {
      chart.innerHTML = "";
      const wider = ["L10", "L20", "ALL"].find((r) => r !== state.range && visible(r).length > 0);
      const widen = wider ? ` <button type="button" class="rs-empty-clear" data-widen="${wider}">See ${countGames(visible(wider).length)} in ${wider === "ALL" ? "all his games" : wider}</button>` : "";
      empty.innerHTML = `No ${state.range === "H2H" ? `games against ${GAMES[state.game].opp}` : "games"} match these filters.${widen} <button type="button" class="rs-empty-clear" data-clear>Clear filters</button>`;
      return;
    }

    const parts = STATS[state.stat].parts;
    const peak = Math.max(...games.map(value), state.line);
    const axisStep = peak <= 15 ? 2 : 5; // small stats like 3-pointers would waste half the chart on 5s
    const top = Math.ceil((peak * 1.14) / axisStep) * axisStep || axisStep;
    const dense = games.length > 12;
    chart.className = `rs-chart${dense ? " is-dense" : ""}`;
    chart.style.setProperty("--n", games.length);

    const bars = games.map((g, i) => {
      const newSeason = i > 0 && games[i - 1].season !== g.season;
      const total = value(g);
      const hit = isHit(g);
      const segs = parts.map((part, i) => {
        const pct = (g[part] / top) * 100;
        const label = !dense && pct >= 8 ? `<span>${g[part]} ${PART_NAMES[part]}</span>` : "";
        return `<div class="rs-seg-part rs-seg-${i}" style="flex-grow:${g[part]}">${parts.length > 1 ? label : ""}</div>`;
      }).reverse().join("");
      return `
        <div class="rs-col${hit ? "" : " is-miss"}${newSeason ? " is-new-season" : ""}" data-col="${g.date}">
          <div class="rs-stack" style="height:${(total / top) * 100}%" title="${g.date} ${g.home ? "vs" : "@"} ${g.opp}: ${total}">
            <span class="rs-total">${total}</span>
            ${segs}
          </div>
        </div>`;
    }).join("");

    const labels = games.map((g) => `
      <div class="rs-x"><b>${g.date}</b><span>${g.home ? "vs" : "@"} ${g.opp}</span></div>`).join("");

    const metric = (on, name, key) => (on
      ? `<div class="rs-metric-label">${name}</div><div class="rs-metric-row">${games.map((g) => `<span>${g[key]}</span>`).join("")}</div>`
      : "");
    const summary = games.map((g) => `${g.date} ${g.opp} ${value(g)} ${isHit(g) ? "hit" : "miss"}`).join(", ");

    chart.innerHTML = `
      <div class="rs-y" aria-hidden="true"><span>${top}</span><span>${Math.round(top / 2)}</span><span>0</span><b class="rs-line-tag" style="bottom:${(state.line / top) * 100}%">${state.line.toFixed(1)}</b></div>
      <div class="rs-plot" role="img" aria-label="${STATS[state.stat].label} by game against a line of ${state.line.toFixed(1)}: ${summary}">
        <div class="rs-gridline" style="bottom:50%"></div>
        <div class="rs-bars">${bars}</div>
        <div class="rs-line" style="bottom:${(state.line / top) * 100}%"></div>
      </div>
      <div class="rs-xs">${labels}</div>
      ${metric(state.min, "Min", "min")}${metric(state.usg, "Usg%", "usg")}`;

    // On small screens the chart scrolls sideways, so start at the newest games.
    const scroller = chart.parentElement;
    const shown = games.map((g) => g.date).join();
    scroller.scrollLeft = shown === chartGames ? keepLeft : scroller.scrollWidth;
    // Same games: the line travels. New games or a new stat: the chart fades in, because nothing carries over.
    if (rendered) {
      if (shown === chartGames && state.stat === chartStat && oldLine !== null) {
        const mark = chart.querySelector(".rs-line");
        const drift = oldLine - (mark.parentElement.getBoundingClientRect().bottom - mark.getBoundingClientRect().bottom);
        if (!calm.matches && Math.abs(drift) > 0.5) {
          mark.animate({ transform: [`translateY(${-drift}px)`, "none"] }, MOVE);
          chart.querySelector(".rs-line-tag").animate({ transform: [`translateY(calc(50% - ${drift}px))`, "translateY(50%)"] }, MOVE);
        }
      } else if (shown !== chartGames || state.stat !== chartStat) {
        chart.animate({ opacity: [0, 1] }, { duration: 180 });
      }
    }
    chartGames = shown;
    chartStat = state.stat;
    $("scroll-hint").textContent = `Older games are to the left. ${window.matchMedia("(hover: none)").matches ? "Swipe" : "Scroll"} to see them.`;
    $("scroll-hint").hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
  }

  function renderLog(games) {
    const parts = STATS[state.stat].parts;
    const hot = (key) => (parts.includes(key) ? "is-hot" : "");
    const cell = (key, text) => `<td class="rs-wide ${hot(key)}">${text}</td>`;
    const avg = (key) => (games.reduce((sum, g) => sum + g[key], 0) / (games.length || 1)).toFixed(1);
    const avgValue = (games.reduce((sum, g) => sum + value(g), 0) / (games.length || 1)).toFixed(1);
    $("log-hint").textContent = countGames(games.length);
    $("log").hidden = games.length === 0;
    if (!games.length) return;

    const toggle = (id, label) => `<td class="rs-toggle-cell"><button type="button" class="rs-row-toggle" data-row="${id}" aria-expanded="${openRows.has(id)}" aria-label="${label}"><span class="rs-chevron rs-chevron-down" aria-hidden="true"></span></button></td>`;
    const details = (id, text) => `<tr class="rs-row-more"${openRows.has(id) ? "" : " hidden"}><td colspan="13">${text}</td></tr>`;

    const rows = [...games].reverse().map((g) => {
      const id = g.date;
      return `
      <tr class="${isHit(g) ? "" : "is-miss"}" data-row-date="${g.date}">
        <th scope="row">${g.date}</th>
        <td class="rs-left">${g.home ? "vs" : "@"} ${g.opp}</td><td class="rs-left rs-wide">${g.win ? "W" : "L"}</td>
        <td class="rs-wide">${g.min}</td>${cell("pts", g.pts)}${cell("reb", g.reb)}${cell("ast", g.ast)}
        ${cell("tpm", g.tpm)}<td class="rs-wide">${g.fgm}-${g.fga}</td><td class="rs-wide">${g.ftm}-${g.fta}</td><td class="rs-wide">${g.usg}</td>
        <td class="rs-result"><b>${value(g)}</b> ${isHit(g) ? "Hit" : "Miss"}</td>
        ${toggle(id, `More stats for ${g.date}`)}
      </tr>
      ${details(id, `${g.win ? "Win" : "Loss"} \u00b7 ${g.min} min \u00b7 ${g.pts} pts \u00b7 ${g.reb} reb \u00b7 ${g.ast} ast \u00b7 ${g.tpm} 3PM \u00b7 FG ${g.fgm}-${g.fga} \u00b7 FT ${g.ftm}-${g.fta} \u00b7 ${g.usg}% usage`)}`;
    }).join("");

    $("log").innerHTML = `
      <caption class="sr-only">${P.name} game log for the games shown in the chart</caption>
      <thead><tr>
        <th scope="col" class="rs-left">Date</th><th scope="col" class="rs-left">Opp</th><th scope="col" class="rs-left rs-wide">W/L</th>
        <th scope="col" class="rs-wide">Min</th><th scope="col" class="rs-wide ${hot("pts")}">Pts</th><th scope="col" class="rs-wide ${hot("reb")}">Reb</th><th scope="col" class="rs-wide ${hot("ast")}">Ast</th>
        <th scope="col" class="rs-wide ${hot("tpm")}">3PM</th><th scope="col" class="rs-wide">FG</th><th scope="col" class="rs-wide">FT</th><th scope="col" class="rs-wide">Usg%</th>
        <th scope="col">vs ${state.line.toFixed(1)}</th><th scope="col" class="rs-toggle-cell"><span class="sr-only">More</span></th>
      </tr></thead>
      <tbody>
        <tr class="rs-avg"><th scope="row">Average</th><td></td><td class="rs-wide"></td>
          <td class="rs-wide">${avg("min")}</td>${cell("pts", avg("pts"))}${cell("reb", avg("reb"))}${cell("ast", avg("ast"))}
          ${cell("tpm", avg("tpm"))}<td class="rs-wide"></td><td class="rs-wide"></td><td class="rs-wide">${avg("usg")}</td><td class="rs-result"><b>${avgValue}</b></td>
          ${toggle("avg", "More averages")}</tr>
        ${details("avg", `${avg("min")} min \u00b7 ${avg("pts")} pts \u00b7 ${avg("reb")} reb \u00b7 ${avg("ast")} ast \u00b7 ${avg("tpm")} 3PM \u00b7 ${avg("usg")}% usage`)}
        ${rows}
      </tbody>`;
  }

  function renderDefense() {
    const g = GAMES[state.game];
    const d = defenseOf(g.opp);
    const stat = STATS[state.stat];
    const allowed = stat.parts.reduce((sum, part) => sum + d[part][0], 0);
    const rank = defenseRank();
    const tone = rank >= 21 ? "Gives up a lot" : rank <= 10 ? "Gives up little" : "About average";

    $("defense-hint").textContent = g.opp;
    $("defense").innerHTML = `
      <div class="rs-defense-main">
        <div><dt>${stat.label} allowed</dt><dd class="rs-defense-num">${allowed.toFixed(1)}</dd></div>
        <div class="rs-defense-rank"><dt>${tone}</dt><dd>${rankWords(rank)} <small>of 30</small></dd></div>
      </div>
      ${["pts", "reb", "ast", "tpm"].map((part) => `
        <div class="${stat.parts.includes(part) ? "is-hot" : ""}"><dt>${PART_NAMES[part]}</dt><dd>${d[part][0]}</dd></div>`).join("")}`;

    $("injury-hint").textContent = `${P.team} and ${g.opp}`;
    const team = (code, list) => `
      <h3>${code}</h3>
      ${list.length ? `<ul class="rs-list">${list.map(([name, pos, status]) => `<li><span>${name}, ${pos}</span><span class="rs-status rs-status-${status.toLowerCase()}">${status}</span></li>`).join("")}</ul>` : `<p class="rs-none">No one listed</p>`}`;
    $("injuries").innerHTML = team(P.team, injuriesOf(P.team)) + team(g.opp, injuriesOf(g.opp));
  }

  // The view lives in the address, so a reload keeps it and a link shares it.
  function writeUrl() {
    const q = new URLSearchParams({ p: P.id });
    if (state.game) q.set("game", state.game);
    if (state.stat !== P.defaultStat) q.set("stat", state.stat);
    if (state.side !== P.defaultSide) q.set("side", state.side);
    if (state.line !== postedLine()) q.set("line", state.line);
    if (state.range !== "L20") q.set("range", state.range);
    if (state.filters.size) q.set("filters", [...state.filters].join(","));
    if (state.min) q.set("min", 1);
    if (state.usg) q.set("usg", 1);
    if (state.pin !== null) q.set("pin", state.pin);
    if (beforeMatch) q.set("before", `${beforeMatch.range}_${[...beforeMatch.filters].join(",")}`);
    const text = q.toString();
    history.replaceState(null, "", text ? `?${text}` : location.pathname);
  }
  // A hand-edited or old link falls back to the default for anything it gets wrong.
  function readUrl() {
    const q = new URLSearchParams(location.search);
    const readFilters = (text) => {
      const set = new Set();
      (text || "").split(",").forEach((key) => {
        if (FILTERS.some(([k]) => k === key) && !set.has(OPPOSITES[key])) set.add(key);
      });
      return set;
    };
    const knownRange = (key) => RANGES.some(([k]) => k === key);
    const game = Number(q.get("game"));
    if (Number.isInteger(game) && GAMES[game]) state.game = game;
    if (Object.hasOwn(STATS, q.get("stat") || "")) state.stat = q.get("stat");
    if (["Over", "Under"].includes(q.get("side"))) state.side = q.get("side");
    if (knownRange(q.get("range"))) state.range = q.get("range");
    state.filters = readFilters(q.get("filters"));
    const [beforeRange, beforeFilters] = (q.get("before") || "").split("_");
    if (knownRange(beforeRange)) beforeMatch = { range: beforeRange, filters: readFilters(beforeFilters) };
    state.min = q.get("min") === "1";
    state.usg = q.get("usg") === "1";
    const posted = postedLine();
    const line = Number(q.get("line"));
    const onStep = q.has("line") && Number.isFinite(line) && Number.isInteger(line - posted);
    state.line = onStep && line >= Math.max(0.5, posted - LINE_REACH) && line <= posted + LINE_REACH ? line : posted;
    const pin = Number(q.get("pin"));
    if (q.has("pin") && Number.isFinite(pin) && Number.isInteger(pin - posted) && pin >= Math.max(0.5, posted - LINE_REACH) && pin <= posted + LINE_REACH) state.pin = pin;
    $("stat").value = state.stat;
    $("overlay-min").checked = state.min;
    $("overlay-usg").checked = state.usg;
    if (state.filters.size) $("filter-panel").open = true;
  }

  function render() {
    // Rebuilt controls would otherwise drop keyboard focus, so put it back afterward.
    const focused = document.activeElement;
    const wasOnBackRow = focused && focused.closest && focused.closest(".rs-back-row");
    const keys = ["line", "range", "filter"];
    const key = focused && keys.find((k) => focused.dataset && focused.dataset[k] !== undefined);
    // A line can move or leave the ladder, so focus follows the selected rung, not the old one.
    const restore = key === "line" ? '#rungs [aria-checked="true"]' : key && `[data-${key}="${focused.dataset[key]}"]`;

    if (beforeMatch && !filtersArePlan()) beforeMatch = null; // they've moved on from the match
    $("line-note").textContent = "";
    const games = visible();
    const ladderBefore = rendered ? readLadder() : null;
    renderControls();
    renderRangeMenu();
    renderLadder(games);
    renderCompare(games);
    renderSummary(games);
    renderLegend();
    renderChart(games);
    renderLog(games);
    renderDefense();
    renderDock(games);
    if (ladderBefore) moveLadder(ladderBefore);
    rendered = true;

    writeUrl();
    if (wasOnBackRow) $("chart").parentElement.focus({ preventScroll: true });
    if (restore) {
      const again = document.querySelector(restore);
      if (again) again.focus();
    }
  }

  $("stat").innerHTML = Object.entries(STATS).map(([key, s]) => `<option value="${key}">${key === "TPM" ? "3-pointers" : s.label}</option>`).join("");
  // Lines are remembered by their distance from posted, because posted differs by stat and game.
  const offsets = () => ({ line: state.line - postedLine(), pin: state.pin === null ? null : state.pin - postedLine() });
  function placeLines({ line, pin }) {
    const posted = postedLine();
    const fit = (off) => Math.min(posted + LINE_REACH, Math.max(0.5, posted - LINE_REACH, posted + off));
    state.line = fit(line);
    state.pin = pin === null ? null : fit(pin);
  }
  function showNote(text) {
    if (!text) return;
    $("line-note").textContent = text;
    $("status").textContent += ` ${text}`;
  }
  // Each stat keeps its own line and pin for the visit, so switching away loses nothing.
  const savedLines = {};
  const linesWords = (line, pin, off) => [
    off.line ? `${line.toFixed(1)} line` : "",
    pin !== null ? `pin on ${pin.toFixed(1)}` : "",
  ].filter(Boolean);
  $("stat").addEventListener("change", (e) => {
    const from = state.stat;
    const left = offsets();
    const leftWords = linesWords(state.line, state.pin, left);
    savedLines[from] = left;
    state.stat = e.target.value;
    const back = savedLines[state.stat] || { line: 0, pin: null };
    placeLines(back);
    render();
    const backWords = linesWords(state.line, state.pin, back);
    if (backWords.length) showNote(`Your ${backWords.join(" and ")} ${backWords.length > 1 ? "are" : "is"} back.`);
    else if (leftWords.length) showNote(`Now on the posted line. Your ${leftWords.join(" and ")} ${leftWords.length > 1 ? "stay" : "stays"} with ${STATS[from].label}.`);
  });
  function stepLine(delta, button) {
    if (button.getAttribute("aria-disabled") === "true") return;
    state.line += delta;
    render();
  }
  [["line-down", -1], ["line-up", 1], ["dock-down", -1], ["dock-up", 1]].forEach(([id, delta]) => {
    $(id).addEventListener("click", () => stepLine(delta, $(id)));
  });
  let beforeMatch = null; // the range and filters to go back to
  $("match-tonight").addEventListener("click", () => {
    if (isMatched()) {
      state.range = beforeMatch ? beforeMatch.range : "L20";
      state.filters = new Set(beforeMatch ? beforeMatch.filters : []);
      beforeMatch = null;
    } else {
      // Only the range changed since the last match: Undo still goes back to the games from before it.
      if (!beforeMatch) beforeMatch = { range: state.range, filters: new Set(state.filters) };
      state.filters = new Set(matchPlan().kept);
      state.range = "ALL";
    }
    render();
  });
  $("rungs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-line]");
    if (b) { state.line = Number(b.dataset.line); render(); }
  });
  $("reset-line").addEventListener("click", () => {
    state.line = postedLine();
    render();
    $("rungs").querySelector('[aria-checked="true"]').focus();
  });
  ["side", "dock-side"].forEach((id) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("[data-side]");
    if (b) { state.side = b.dataset.side; render(); }
  }));
  $("range-select").addEventListener("change", (e) => {
    state.range = e.target.value;
    render();
  });
  $("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("[data-range]");
    if (b) { state.range = b.dataset.range; render(); }
  });
  $("game-select").innerHTML = GAMES.map((g, i) => `<option value="${i}">${g.date} ${g.where} ${g.opp}</option>`).join("");
  $("game-select").addEventListener("change", (e) => {
    const wasMatched = beforeMatch !== null;
    const kept = offsets();
    state.game = Number(e.target.value);
    placeLines(kept);
    if (wasMatched) state.filters = new Set(matchPlan().kept); // stay matched, now to this game
    render();
    const g = GAMES[state.game];
    $("status").textContent = `${g.date} ${g.where} ${g.opp}. ${$("status").textContent}`;
    const now = offsets();
    const away = (off) => `${Math.abs(off)} ${off > 0 ? "above" : "below"} posted`;
    showNote([
      now.line ? `Line stays ${away(now.line)}, now ${state.line.toFixed(1)}.` : "",
      now.pin ? `Pin stays ${away(now.pin)}, now ${state.pin.toFixed(1)}.` : "",
      now.pin === 0 ? `Pin stays on posted, now ${state.pin.toFixed(1)}.` : "",
    ].filter(Boolean).join(" "));
  });
  const isOpenMenu = (menu) => { try { return menu.matches(":open"); } catch (err) { return false; } };
  $("chart-empty").addEventListener("click", (e) => {
    const widen = e.target.closest("[data-widen]");
    if (widen) {
      state.range = widen.dataset.widen;
      render();
      if (phoneLayout.matches) $("range-select").focus();
      else $("ranges").querySelector('[aria-checked="true"]').focus();
    } else if (e.target.closest("[data-clear]")) clearFilters();
  });
  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    const key = b.dataset.filter;
    if (state.filters.has(key)) state.filters.delete(key);
    else {
      state.filters.add(key);
      if (OPPOSITES[key]) state.filters.delete(OPPOSITES[key]);
    }
    render();
  });
  function clearFilters() {
    state.filters.clear();
    render();
    // The Clear button just disappeared
    if ($("filter-panel").open) $("filters").querySelector("button").focus();
    else $("filter-panel").querySelector("summary").focus();
  }
  $("clear-filters").addEventListener("click", clearFilters);
  // Pointer shortcut: a bar jumps to its row. The same game is reachable in the log by keyboard.
  $("chart").addEventListener("click", (e) => {
    const col = e.target.closest("[data-col]");
    if (!col) return;
    $("log-panel").open = true;
    $("log").querySelectorAll(".is-target").forEach((row) => row.classList.remove("is-target"));
    $("log").querySelectorAll(".rs-back-row").forEach((row) => row.remove());
    const row = $("log").querySelector(`[data-row-date="${col.dataset.col}"]`);
    row.classList.add("is-target");
    const more = row.nextElementSibling;
    const toggle = row.querySelector(".rs-row-toggle");
    openRows.add(col.dataset.col);
    more.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    const back = document.createElement("tr");
    back.className = "rs-back-row";
    back.innerHTML = '<td colspan="13"><button type="button" class="rs-empty-clear">Back to the chart</button></td>';
    more.after(back);
    const button = back.querySelector("button");
    button.addEventListener("click", () => {
      back.remove();
      row.classList.remove("is-target");
      document.querySelector(".rs-chart-panel").scrollIntoView({ block: "start" });
      $("chart").parentElement.focus({ preventScroll: true });
    });
    row.scrollIntoView({ block: "center" });
    button.focus({ preventScroll: true });
  });
  $("log").addEventListener("click", (e) => {
    const b = e.target.closest(".rs-row-toggle");
    if (!b) return;
    const id = b.dataset.row;
    if (openRows.has(id)) openRows.delete(id);
    else openRows.add(id);
    b.setAttribute("aria-expanded", openRows.has(id));
    b.closest("tr").nextElementSibling.hidden = !openRows.has(id);
  });

  function togglePin() {
    const pinning = state.pin === null;
    state.pin = pinning ? state.line : null;
    render();
    $("status").textContent = pinning
      ? `Pinned ${state.side} ${state.pin.toFixed(1)}. Select another line to compare them.`
      : "Comparison closed.";
  }
  $("pin-line").addEventListener("click", togglePin);

  $("copy-link").addEventListener("click", async () => {
    const button = $("copy-link");
    let copied = true;
    try { await navigator.clipboard.writeText(location.href); } catch (err) { copied = false; }
    button.textContent = copied ? "Link copied" : "Copy the address bar to share";
    $("status").textContent = button.textContent;
    setTimeout(() => { button.textContent = "Copy link to this view"; }, 2000);
  });

  // Single-key shortcuts, with a way to turn them off for anyone they get in the way of.
  const KEYS_OFF = "lh-shortcuts-off";
  const shortcutsOff = () => { try { return localStorage.getItem(KEYS_OFF) === "1"; } catch (err) { return false; } };
  $("keys-off").checked = shortcutsOff();
  $("keys-off").addEventListener("change", (e) => {
    try { if (e.target.checked) localStorage.setItem(KEYS_OFF, "1"); else localStorage.removeItem(KEYS_OFF); } catch (err) { /* lasts until reload */ }
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || $("keys-off").checked) return;
    if (e.target.closest && e.target.closest('textarea, input:not([type="checkbox"])')) return;
    // On a closed menu the keys below win, so P or R can't quietly change the stat by type-ahead.
    if (e.target.matches && e.target.matches("select") && isOpenMenu(e.target)) return;
    const key = e.key.toLowerCase();
    const pick = (side) => $("side").querySelector(`[data-side="${side}"]`).click();
    if (key === "o") pick("Over");
    else if (key === "u") pick("Under");
    else if (key === "[") stepLine(-1, $("line-down"));
    else if (key === "]") stepLine(1, $("line-up"));
    else if (key === "r") {
      const at = RANGES.findIndex(([k]) => k === state.range);
      state.range = RANGES[(at + 1) % RANGES.length][0];
      render();
    } else if (key === "m") $("match-tonight").click();
    else if (key === "p") togglePin();
    else if (key === "?") {
      const panel = $("shortcuts");
      panel.open = !panel.open;
      if (panel.open) { panel.scrollIntoView({ block: "nearest" }); panel.querySelector("summary").focus({ preventScroll: true }); }
    } else return;
    e.preventDefault();
  });

  // Each row of options is one Tab stop. Arrow keys, Home and End move within it.
  // Pick-one rows select as they move, like any radio group. Filter chips only move,
  // and Space or Enter toggles the chip.
  function arrowKeys(group, selects) {
    const keys = selects ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"];
    group.addEventListener("keydown", (e) => {
      if (!keys.includes(e.key)) return;
      const buttons = [...group.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
        : (i + (forward ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      if (selects) buttons[next].click();
    });
  }
  ["side", "dock-side", "ranges"].forEach((id) => arrowKeys($(id), true));
  $("rungs").addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    const rungs = [...$("rungs").querySelectorAll("button")];
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const posted = postedLine();
    const next = step ? state.line + step : Number(rungs[e.key === "Home" ? 0 : rungs.length - 1].dataset.line);
    if (next < Math.max(0.5, posted - LINE_REACH) || next > posted + LINE_REACH) return;
    state.line = next;
    render();
    $("rungs").querySelector('[aria-checked="true"]').focus();
  });
  arrowKeys($("filters"), false);
  $("filters").addEventListener("focusin", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    chipStop = chip.dataset.filter;
    $("filters").querySelectorAll("button").forEach((b) => { b.tabIndex = b === chip ? 0 : -1; });
  });

  // The skip link keeps its promise: it lands on the selected line, with the bet in view.
  document.querySelector(".rs-skip").addEventListener("click", (e) => {
    e.preventDefault();
    const rung = $("rungs").querySelector('[aria-checked="true"]');
    $("research").scrollIntoView({ block: "start" });
    rung.focus({ preventScroll: true });
    rung.scrollIntoView({ block: "nearest" });
  });

  // Tab order follows what's on screen. In one column, defense and injuries come before the
  // game log. On phones the color key and books also sit under the ladder.
  const phoneLayout = window.matchMedia("(max-width: 720px)");
  const oneColumn = window.matchMedia("(max-width: 1100px)");
  function placeForLayout() {
    const defense = $("defense").closest("details");
    const injuries = $("injuries").closest("details");
    if (phoneLayout.matches) {
      document.querySelector(".rs-ladder-foot > div").append($("rung-key"), $("books"));
    } else {
      $("ladder-key").append($("rung-key"));
      document.querySelector(".rs-controls").append($("books"));
    }
    if (oneColumn.matches) $("log-panel").before(defense, injuries);
    else document.querySelector(".rs-side").prepend(defense, injuries);
  }
  phoneLayout.addEventListener("change", placeForLayout);
  oneColumn.addEventListener("change", placeForLayout);
  placeForLayout();

  // In one column the long log starts closed. Phones and short screens also get the bet dock
  // once the ladder scrolls off.
  if (oneColumn.matches) $("log-panel").open = false;
  // The bet bar appears once the top controls leave, except on short small screens, where it would cover the ladder.
  const compactDock = window.matchMedia("(min-width: 1001px), (min-height: 720px)");
  function setDock() {
    const watched = compactDock.matches ? document.querySelector(".rs-bar") : $("rungs");
    const show = watched.getBoundingClientRect().bottom < 0;
    if (!show && $("dock").contains(document.activeElement)) {
      $("line-up").focus({ preventScroll: true });
    }
    $("dock").classList.toggle("is-shown", show);
  }
  window.addEventListener("scroll", setDock, { passive: true });
  window.addEventListener("resize", setDock);
  // A window resize can make the chart fit, or stop fitting.
  window.addEventListener("resize", () => {
    const scroller = $("chart").parentElement;
    $("scroll-hint").hidden = $("chart").hidden || scroller.scrollWidth <= scroller.clientWidth + 1;
  });
  $("overlay-min").addEventListener("change", (e) => { state.min = e.target.checked; render(); });
  $("overlay-usg").addEventListener("change", (e) => { state.usg = e.target.checked; render(); });

  // The parts of the page that name the player
  document.title = `Line Hunter | ${P.name}`;
  document.querySelector(".sample-strip").textContent = `Design preview. ${P.name}, his games, the news and all odds on this page are made up.`;
  document.querySelector(".rs-avatar").textContent = P.initials;
  document.querySelector(".rs-who h1").textContent = P.name;
  document.querySelector(".rs-who p").textContent = `${P.team} \u00b7 ${P.pos}`;
  $("defense-title").textContent = `Defense vs. ${P.posPlural}`;
  $("news").innerHTML = P.news.map(([iso, shown, text]) => `<li><time datetime="${iso}">${shown}</time>${text}</li>`).join("");
  $("lineup").innerHTML = P.lineup.map(([name, pos]) => `<li><span>${name}</span><span>${pos}</span></li>`).join("");
  // Coming from a game page, the back arrow returns to that game
  if (/\/game\.html\?g=/.test(document.referrer)) {
    const back = document.querySelector(".rs-back");
    back.href = document.referrer;
    back.setAttribute("aria-label", "Back to the game");
  }

  readUrl();
  render();
})();
