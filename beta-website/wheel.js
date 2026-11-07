// Tonight's games as a wheel you can drag: the main game, two stacked on each side, the rest hidden behind. Uses ALL, propText, fmtOdds and $ from script.js.
(function () {
  const stage = $("wheel");
  const count = GAMES_TODAY.length;
  const step = (Math.PI * 2) / count;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Spring settings: duration .5s, bounce .2 (stiffness and damping worked out from those).
  const STIFFNESS = 158;
  const DAMPING = 20;

  // How a card looks in each slot, from the main game (0) out to hidden behind the stack (3).
  // Between slots the values blend, so cards grow and brighten as they travel forward.
  const SCALES = [1, 0.74, 0.54, 0.44];
  const DIMS = [0, 0.42, 0.7, 0.7];
  const TURNS = [0, 16, 26, 26];  // degrees each card angles in
  const SIDE_GAP = 12;
  const SECOND_PEEK = 0.55;       // share of the second card showing past the first
  const FADE_RANGE = 0.6;         // slots past slot 2 until a card has faded out
  const DRAG_THRESHOLD = 5;
  const MAX_THROW = 1;
  const MAX_THROW_SPEED = 2; // radians per second

  let rot = 0;        // the ring's current angle
  let vel = 0;        // radians per second
  let pos = 0;        // which game the ring is heading to; never wraps, so spins stay continuous
  let offsets = [0, 300, 450, 300]; // pixels from center at each slot; slot 3 tucks back inward
  let dragSpan = 300;               // pixels of drag that move one game
  let frame = null;
  let front = -1;

  const mod = (n) => ((n % count) + count) % count;
  const games = GAMES_TODAY.map((g) => ({
    ...g,
    star: ALL.find((p) => p.team === g.home || p.team === g.away),
  }));

  // White or dark text, whichever reads better on the team's color.
  function textOn(hex) {
    const channel = (start) => {
      const v = parseInt(hex.substr(start, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0534 ? "#fff" : "#060a16";
  }
  const teamStyle = (g) => {
    const away = TEAM_COLORS[g.away];
    const home = TEAM_COLORS[g.home];
    return `--away:${away};--away-text:${textOn(away)};--home:${home};--home-text:${textOn(home)}`;
  };

  stage.innerHTML = games.map((g, i) => `
    <a class="gcard" href="game.html?g=${g.away}-${g.home}" draggable="false" data-i="${i}" aria-label="${g.away} at ${g.home}, ${g.time}. Moneyline: ${g.away} ${fmtOdds(g.mlAway)}, ${g.home} ${fmtOdds(g.mlHome)}.">
      <span class="gcard-time">${g.time}</span>
      <span class="gcard-body" style="${teamStyle(g)}">
        <span class="gteam"><b>${g.away}</b><span class="ml">${fmtOdds(g.mlAway)}</span></span>
        <span class="gat" aria-hidden="true">@</span>
        <span class="gteam gteam-home"><b>${g.home}</b><span class="ml">${fmtOdds(g.mlHome)}</span></span>
      </span>
      <span class="gcard-dim"></span>
    </a>`).join("");

  const cards = [...stage.querySelectorAll(".gcard")];
  const dims = cards.map((c) => c.querySelector(".gcard-dim"));
  const baseLabels = cards.map((c) => c.getAttribute("aria-label"));

  function draw() {
    cards.forEach((card, i) => {
      // Slots away from the main position, the short way round: 0 is main, ±1 is a side slot.
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
      card.style.visibility = faded >= 1 ? "hidden" : "visible"; // also keeps hidden games out of the tab order
      card.style.zIndex = Math.round(100 - Math.abs(slot) * 25);
      dims[i].style.opacity = blend(DIMS).toFixed(3);
    });
    const nearest = mod(-Math.round(rot / step));
    if (nearest !== front) setFront(nearest);
  }

  function setFront(i) {
    front = i;
    cards.forEach((card, n) => {
      if (n === i) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
      card.setAttribute("aria-label", `${baseLabels[n]} ${n === i ? "Open this game." : "Bring this game to the front."}`);
    });
    const g = games[i];
    $("wheel-count").textContent = `${i + 1} of ${count}`;
    $("wheel-detail").innerHTML = g.star
      ? `<span class="wheel-label">${g.away} @ ${g.home}, streak to watch</span> <b>${g.star.player}</b>, ${propText(g.star)} <strong>${g.star.streak} straight</strong>`
      : `<span class="wheel-label">${g.away} @ ${g.home}</span> No active streaks tracked`;
  }

  function measure() {
    const width = stage.clientWidth;
    const cardW = cards[0].offsetWidth;
    const firstW = cardW * SCALES[1];
    const secondW = cardW * SCALES[2];
    const mainEdge = cardW / 2;
    const maxEdge = width / 2 - 8;
    // Outer edge of each side card. On narrow screens they share whatever room is left.
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
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      rot = -pos * step;
      vel = 0;
      draw();
      return;
    }
    if (frame) return;
    const start = performance.now();
    frame = requestAnimationFrame((t) => tick(t, start));
  }

  function moveBy(delta) {
    pos += delta;
    settle();
  }

  function stopSpring() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
  }

  // Dragging. Capture waits for real movement so a plain click still reaches the card.
  let pointer = null;
  let dragged = false;

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
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
    if (idle > 80) vel = 0; // held still before letting go, so no throw
    // Land on the game the throw is heading toward, at most MAX_THROW games away.
    vel = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, vel));
    const throwDistance = Math.max(-MAX_THROW * step, Math.min(MAX_THROW * step, vel * 0.18));
    pos = -Math.round((rot + throwDistance) / step);
    settle();
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // Clicking any card brings it forward by the short way around.
  // The front card is a link to its game. Browsers without page-to-page transitions use the logo wipe.
  const canGrow = "onpagereveal" in window;
  stage.addEventListener("click", (e) => {
    const card = e.target.closest(".gcard");
    if (dragged) { dragged = false; if (card) e.preventDefault(); return; }
    if (!card) return;
    const distance = mod(Number(card.dataset.i) - mod(pos));
    if (distance === 0) {
      if (!canGrow) card.dataset.wipe = "";
      return;
    }
    e.preventDefault();
    moveBy(distance > count / 2 ? distance - count : distance);
  });

  stage.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); moveBy(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveBy(-1); }
  });
  $("wheel-next").addEventListener("click", () => moveBy(1));
  $("wheel-prev").addEventListener("click", () => moveBy(-1));

  $("games-date").textContent = `${GAMES_DATE} · ${count} games`;
  // Coming back from a game page, that game is in front.
  const returned = games.findIndex((g) => `${g.away}-${g.home}` === new URLSearchParams(location.search).get("game"));
  if (returned > 0) {
    pos = returned;
    rot = -pos * step;
  }
  if (returned !== -1) history.replaceState(null, "", location.pathname);
  new ResizeObserver(measure).observe(stage);
  measure();
})();
