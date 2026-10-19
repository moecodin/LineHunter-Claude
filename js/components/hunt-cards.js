// LineHunter - js/components/hunt-cards.js
// The two Hunt Score cards at the top of schedule.html, above the games:
//   left  "Today's top hunts"  - up to 5 rows from /api/hunt (netlify/functions/hunt.js): topHunts
//   right "Hit list"           - a vertical carousel of the Hit List categories (hitListSummaries() in js/components/hit-list.js)
// app.js calls showHuntForDay(day, games) for the picked day; hit-list.js calls showHuntHitList(summaries) when the slate is ready.
//
// Dev only: on localhost, add ?mock=1 to the page URL and both cards use dev/hunt-mock.json instead of the API (there are no
// games to score before the season starts). The mock never runs on the live site.

const HUNT_MOCK = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("mock") === "1";
const HUNT_STAT_NAMES = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes", pra: "Points + Rebounds + Assists" };
const HUNT_SLIDE_MS = 3500;
const HUNT_PEEK = 1.5; // slides visible in the carousel: one and a half, so the next one peeks in

let huntRequest = 0;       // goes up with every load, so a slow old answer can't draw over a newer one
let huntLeftShown = false;
let huntRightShown = false;
let huntCarouselTimer = null;
let huntMockData = null;
let huntObserver = null;

const huntEscape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const huntTodayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function loadHuntMock() {
  if (!huntMockData) huntMockData = fetch("dev/hunt-mock.json").then((response) => response.json());
  return huntMockData;
}

// ---------- layout: the row shows when either card has something; one card alone takes the full width ----------

function updateHuntRow() {
  const row = document.getElementById("huntRow");
  if (!row) return;
  document.getElementById("huntLeft").hidden = !huntLeftShown;
  document.getElementById("huntRight").hidden = !huntRightShown;
  row.hidden = !huntLeftShown && !huntRightShown;
  row.classList.toggle("is-single", huntLeftShown !== huntRightShown);
}

// ---------- left card: Today's top hunts ----------

function huntRowHtml(hunt, index) {
  const statName = HUNT_STAT_NAMES[hunt.stat] || hunt.stat.toUpperCase();
  const side = hunt.side === "under" ? "Under" : "Over";
  const score = Math.max(0, Math.min(100, Math.round(hunt.score)));
  return `
    <li class="lh-hrow">
      <span class="lh-hrank">${index + 1}</span>
      <div class="lh-hmain">
        <div class="lh-hname">
          <a class="lh-hplayer" href="game.html?id=${hunt.gameId}&player=${hunt.playerId}&prop=${hunt.stat}">${huntEscape(hunt.player)}</a>
          <span class="lh-hmatch">${hunt.team} ${hunt.home ? "vs" : "@"} ${hunt.opp}</span>
        </div>
        <div class="lh-hprop"><span class="lh-hside lh-hside--${hunt.side}">${side}</span> <span class="lines-only">${hunt.line} </span>${statName}</div>
        <ol class="lh-hwhy">${(hunt.why || []).map((sentence) => `<li>${huntEscape(sentence)}</li>`).join("")}</ol>
      </div>
      <div class="lh-hscore" aria-label="Hunt score ${score} out of 100">
        <span class="lh-hscore-label">Hunt score</span>
        <span class="lh-hscore-num">${score}</span>
        <span class="lh-hbar"><span style="width: ${score}%"></span></span>
      </div>
    </li>`;
}

function renderHuntLeft(data) {
  const hunts = (data.topHunts || []).slice(0, 5);
  const updated = data.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : "";
  document.getElementById("huntLeftBody").innerHTML = `
    <h2 class="lh-hcard-title">Today's top hunts</h2>
    ${updated ? `<div class="lh-hcard-sub">Updated ${updated}</div>` : ""}
    ${hunts.length
      ? `<ol class="lh-hlist">${hunts.map(huntRowHtml).join("")}</ol>`
      : `<p class="lh-hempty">No strong spots today. Check back closer to tip.</p>`}`;
  huntLeftShown = true;
  updateHuntRow();
}

// Called by app.js for the picked day. The top hunts only exist for today, on a day that has games.
async function showHuntForDay(day, games) {
  if (!document.getElementById("huntRow")) return;
  const request = ++huntRequest;

  if (HUNT_MOCK) {
    try {
      const data = await loadHuntMock();
      if (request !== huntRequest) return;
      renderHuntLeft(data);
      renderHuntCarousel(data.hitList.map((category) => ({ ...category, picks: category.picks.map((pick) => ({ ...pick, name: huntEscape(pick.name) })) })));
    } catch (error) {
      console.warn("Mock data unavailable:", error);
    }
    return;
  }

  if (day !== huntTodayET() || games.length === 0) {
    huntLeftShown = false;
    updateHuntRow();
    return;
  }
  try {
    const response = await fetch(`/api/hunt?date=${day}`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json();
    if (request !== huntRequest) return;
    renderHuntLeft(data);
  } catch (error) {
    if (request !== huntRequest) return;
    console.warn("Top hunts unavailable:", error);
    huntLeftShown = false;
    updateHuntRow();
  }
}

// ---------- right card: the Hit List carousel ----------

function huntSlideHtml(category) {
  return `
    <div class="lh-hslide">
      <div class="lh-hslide-name">${category.label}</div>
      <div class="lh-hslide-blurb">${category.blurb}</div>
      <ul class="lh-hslide-picks">${category.picks.map((pick) => `
        <li><span class="lh-hslide-player">${pick.name}</span><span class="lh-hslide-prop">${pick.text}</span><span class="lh-hslide-proof">${pick.proof}</span></li>`).join("")}
      </ul>
    </div>`;
}

function stopHuntCarousel() {
  clearInterval(huntCarouselTimer);
  huntCarouselTimer = null;
}

// Slides move up one at a time. The first two slides are copied after the last one, so after the last real slide the track
// slides onto the copies and then jumps back to the start without a visible change (a seamless loop).
function renderHuntCarousel(categories) {
  stopHuntCarousel();
  huntRightShown = categories.length > 0;
  updateHuntRow();
  if (!huntRightShown) return;

  const count = categories.length;
  const clones = Math.min(count, 2);
  const viewport = document.getElementById("huntViewport");
  const track = document.getElementById("huntTrack");
  const bars = document.getElementById("huntBars");
  document.getElementById("huntCount").textContent = `${count} ${count === 1 ? "category" : "categories"} tonight`;
  track.innerHTML = [...categories, ...categories.slice(0, clones)].map(huntSlideHtml).join("");
  bars.innerHTML = categories.map(() => "<span></span>").join("");

  let index = 0;
  let slideHeight = 0;
  const paint = (animate) => {
    track.style.transition = animate ? "" : "none";
    track.style.transform = `translateY(${-index * slideHeight}px)`;
    [...bars.children].forEach((bar, i) => bar.classList.toggle("is-active", i === index % count));
  };
  const measure = () => {
    slideHeight = viewport.clientHeight / HUNT_PEEK;
    track.style.setProperty("--slide-h", `${slideHeight}px`);
    paint(false);
  };
  measure();
  if ("ResizeObserver" in window) {
    if (huntObserver) huntObserver.disconnect();
    huntObserver = new ResizeObserver(measure);
    huntObserver.observe(viewport);
  }

  track.ontransitionend = () => {
    if (index >= count) { index = 0; paint(false); }   // landed on the copies: jump back to the real first slide
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || count < 2) return;                    // reduced motion: the first slide with the peek, nothing moves

  let hovering = false;
  const card = document.getElementById("huntRight");
  card.onmouseenter = () => { hovering = true; };
  card.onmouseleave = () => { hovering = false; };
  huntCarouselTimer = setInterval(() => {
    if (hovering || document.hidden) return;
    index += 1;
    paint(true);
  }, HUNT_SLIDE_MS);
}

// Called by hit-list.js with hitListSummaries(slate) (an empty list hides the card).
function showHuntHitList(categories) {
  if (!document.getElementById("huntRow") || HUNT_MOCK) return;
  renderHuntCarousel(categories);
}
