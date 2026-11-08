// The Today page's games as a wheel you can drag (ported from the beta's tonight.html / wheel.js, PR #5):
// the front game big in the middle, two cards stacked on each side, the rest hidden behind.
// Each card: tip time over the away team's color with the home color as a slanted wedge, a thin ice seam between,
// both abbreviations big and the moneylines under them. The line under the wheel describes the front game
// (cities + records, spread / total, View props). js/pages/app.js calls renderGameWheel(games, describeTime) for the
// picked day, then setGameWheelOdds(rowsByGameId) and setGameWheelRecords(records) once those arrive.
(function () {
  const stage = document.getElementById("gameWheel");
  if (!stage) return;
  const detail = document.getElementById("wheelDetail");
  const countEl = document.getElementById("wheelCount");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Spring: about .5s with a little bounce (the beta's numbers).
  const STIFFNESS = 158;
  const DAMPING = 20;
  // How a card looks in each slot, from the front (0) out to hidden behind the stack (3); values blend between slots.
  const SCALES = [1, 0.74, 0.54, 0.44];
  const DIMS = [0, 0.42, 0.7, 0.7];
  const TURNS = [0, 16, 26, 26];
  const SIDE_GAP = 12;
  const SECOND_PEEK = 0.55;
  const FADE_RANGE = 0.6;
  const DRAG_THRESHOLD = 5;
  const MAX_THROW = 1;
  const MAX_THROW_SPEED = 2;

  let games = [];
  let cards = [];
  let dims = [];
  let count = 0;
  let step = 1;
  let rot = 0;
  let vel = 0;
  let pos = 0;
  let offsets = [0, 300, 450, 300];
  let dragSpan = 300;
  let frame = null;
  let front = -1;
  let odds = {};
  let records = {};
  let timeText = (game) => "";

  const mod = (n) => ((n % count) + count) % count;
  const fmtOdds = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "" : Number(n) > 0 ? `+${Number(n)}` : `${Number(n)}`);
  const spread = (n) => (Number(n) > 0 ? `+${Number(n)}` : `${Number(n)}`);

  // Fill colors: each team's main color (secondary when the primary vanishes on the page), the away team on its secondary
  // when the two clash (the site's clash rule). Text on each side is white or dark, whichever reads.
  function teamStyle(away, home) {
    let a = teamBaseColor(away);
    const h = teamBaseColor(home);
    if (colorDistance(a, h) < COLOR_CLASH_DISTANCE && TEAM_INFO[away]) a = TEAM_INFO[away].colors.secondary;
    return `--away:${a};--away-text:${readableTextOn(a)};--home:${h};--home-text:${readableTextOn(h)}`;
  }

  function cardHtml(game, i) {
    const away = game.visitor_team.abbreviation;
    const home = game.home_team.abbreviation;
    return `
      <a class="lh-wcard" href="game.html?id=${game.id}" draggable="false" data-i="${i}" aria-label="${away} at ${home}, ${timeText(game)}.">
        <span class="lh-wcard-time">${timeText(game)}</span>
        <span class="lh-wcard-body" style="${teamStyle(away, home)}">
          <span class="lh-wteam"><b>${away}</b><span class="lh-wml lines-only" data-ml="away"></span></span>
          <span class="lh-wat" aria-hidden="true">@</span>
          <span class="lh-wteam is-home"><b>${home}</b><span class="lh-wml lines-only" data-ml="home"></span></span>
        </span>
        <span class="lh-wcard-dim"></span>
      </a>`;
  }

  function draw() {
    cards.forEach((card, i) => {
      let slot = (i + rot / step) % count;
      if (slot > count / 2) slot -= count;
      if (slot < -count / 2) slot += count;
      const dist = Math.min(Math.abs(slot), 3);
      const from = Math.min(Math.floor(dist), 2);
      const blend = (values) => values[from] + (values[from + 1] - values[from]) * (dist - from);
      const faded = Math.min(Math.max(dist - 2, 0) / FADE_RANGE, 1);
      const x = Math.sign(slot) * blend(offsets);
      const turn = -Math.sign(slot) * blend(TURNS);
      card.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0) perspective(1100px) rotateY(${turn.toFixed(1)}deg) scale(${blend(SCALES).toFixed(3)})`;
      card.style.opacity = (1 - faded).toFixed(3);
      card.style.visibility = faded >= 1 ? "hidden" : "visible";
      card.style.zIndex = Math.round(100 - Math.abs(slot) * 25);
      dims[i].style.opacity = blend(DIMS).toFixed(3);
    });
    const nearest = mod(-Math.round(rot / step));
    if (nearest !== front) setFront(nearest);
  }

  function detailHtml(game) {
    const away = game.visitor_team;
    const home = game.home_team;
    const rec = (team) => (records[team.id] && records[team.id].overall ? ` <span class="lh-wrec">${records[team.id].overall}</span>` : "");
    const row = odds[game.id];
    const line = row
      ? `${home.abbreviation} ${spread(row.spread_home_value)} · O/U ${Number(row.total_value)}`
      : "Lines not posted yet";
    return `
      <span class="lh-wlabel">${away.city}${rec(away)} @ ${home.city}${rec(home)}</span>
      <span class="lh-wline lines-only">${line}</span>
      <a class="lh-wgo" href="game.html?id=${game.id}">View <span class="lines-only">props</span><span class="research-only">stats</span> ›</a>`;
  }

  function setFront(i) {
    front = i;
    cards.forEach((card, n) => {
      card.toggleAttribute("aria-current", n === i);
      if (n === i) card.setAttribute("aria-current", "true");
    });
    countEl.textContent = `${i + 1} of ${count}`;
    detail.innerHTML = detailHtml(games[i]);
  }

  function measure() {
    if (!cards.length) return;
    const width = stage.clientWidth;
    const cardW = cards[0].offsetWidth;
    const firstW = cardW * SCALES[1];
    const secondW = cardW * SCALES[2];
    const mainEdge = cardW / 2;
    const maxEdge = width / 2 - 8;
    let firstEdge = mainEdge + firstW + SIDE_GAP;
    let secondEdge = firstEdge + secondW * SECOND_PEEK;
    if (secondEdge > maxEdge) {
      firstEdge = mainEdge + (maxEdge - mainEdge) * SECOND_PEEK;
      secondEdge = maxEdge;
    }
    const first = firstEdge - firstW / 2;
    offsets = [0, first, secondEdge - secondW / 2, first];
    dragSpan = Math.max(first, cardW * 0.6);
    draw();
  }

  function tick(now, last) {
    const dt = Math.min((now - last) / 1000, 0.032);
    const target = -pos * step;
    vel += (-STIFFNESS * (rot - target) - DAMPING * vel) * dt;
    rot += vel * dt;
    if (Math.abs(rot - target) < 0.0005 && Math.abs(vel) < 0.005) {
      rot = target;
      vel = 0;
      frame = null;
      draw();
      return;
    }
    draw();
    frame = requestAnimationFrame((t) => tick(t, now));
  }

  function settle() {
    if (reduceMotion.matches) {
      stopSpring();
      rot = -pos * step;
      vel = 0;
      draw();
      return;
    }
    if (frame) return;
    const start = performance.now();
    frame = requestAnimationFrame((t) => tick(t, start));
  }
  function stopSpring() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
  }
  function moveBy(delta) {
    if (!count) return;
    pos += delta;
    settle();
  }

  // Dragging: capture waits for real movement, so a plain click still reaches the card.
  let pointer = null;
  let dragged = false;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !count) return;
    pointer = { id: e.pointerId, startX: e.clientX, x: e.clientX, time: e.timeStamp };
    dragged = false;
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (!dragged) {
      if (Math.abs(e.clientX - pointer.startX) < DRAG_THRESHOLD) return;
      dragged = true;
      stopSpring();
      vel = 0;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("is-dragging");
    }
    const dx = e.clientX - pointer.x;
    const dt = Math.max((e.timeStamp - pointer.time) / 1000, 0.008);
    const change = (dx / dragSpan) * step;
    rot += change;
    vel = vel * 0.7 + (change / dt) * 0.3;
    pointer.x = e.clientX;
    pointer.time = e.timeStamp;
    draw();
  });
  function endDrag(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    const wasDragged = dragged;
    const idle = e.timeStamp - pointer.time;
    pointer = null;
    stage.classList.remove("is-dragging");
    if (!wasDragged) return;
    if (idle > 80) vel = 0;
    vel = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, vel));
    const throwDistance = Math.max(-MAX_THROW * step, Math.min(MAX_THROW * step, vel * 0.18));
    pos = -Math.round((rot + throwDistance) / step);
    settle();
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // A side card comes to the front the short way round; the front card is a link to its game.
  stage.addEventListener("click", (e) => {
    const card = e.target.closest(".lh-wcard");
    if (dragged) { dragged = false; if (card) e.preventDefault(); return; }
    if (!card) return;
    const distance = mod(Number(card.dataset.i) - mod(pos));
    if (distance === 0) return;
    e.preventDefault();
    moveBy(distance > count / 2 ? distance - count : distance);
  });
  stage.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); moveBy(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveBy(-1); }
  });
  document.getElementById("wheelNext").addEventListener("click", () => moveBy(1));
  document.getElementById("wheelPrev").addEventListener("click", () => moveBy(-1));
  new ResizeObserver(measure).observe(stage);

  // Draw a day's games (or clear the wheel with a message: loading, no games, an error).
  window.renderGameWheel = function (list, describe) {
    stopSpring();
    games = list || [];
    count = games.length;
    odds = {};
    timeText = describe || timeText;
    rot = 0; vel = 0; pos = 0; front = -1;
    document.getElementById("wheelWrap").hidden = count === 0;
    if (!count) { stage.innerHTML = ""; cards = []; return; }
    step = (Math.PI * 2) / count;
    stage.innerHTML = games.map(cardHtml).join("");
    cards = [...stage.querySelectorAll(".lh-wcard")];
    dims = cards.map((c) => c.querySelector(".lh-wcard-dim"));
    measure();
  };

  // rowsByGameId: { gameId: the picked odds row } (DraftKings preferred, pickOddsRow in js/pages/app.js).
  window.setGameWheelOdds = function (rowsByGameId) {
    odds = rowsByGameId || {};
    cards.forEach((card, i) => {
      const row = odds[games[i].id];
      card.querySelector('[data-ml="away"]').textContent = row ? fmtOdds(row.moneyline_away_odds) : "";
      card.querySelector('[data-ml="home"]').textContent = row ? fmtOdds(row.moneyline_home_odds) : "";
    });
    if (front >= 0) detail.innerHTML = detailHtml(games[front]);
  };

  // records: fetchStandings' answer, { teamId: { overall: "8-2", ... } }.
  window.setGameWheelRecords = function (map) {
    records = map || {};
    if (front >= 0) detail.innerHTML = detailHtml(games[front]);
  };

  // Theme change: team colors and text colors are picked against the page, so redraw the cards in place.
  document.addEventListener("lh-theme-change", () => {
    cards.forEach((card, i) => {
      const body = card.querySelector(".lh-wcard-body");
      body.setAttribute("style", teamStyle(games[i].visitor_team.abbreviation, games[i].home_team.abbreviation));
    });
  });
})();
