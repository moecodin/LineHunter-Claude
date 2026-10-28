// LineHunter - js/pages/app.js
// Loads NBA games for a chosen day from the BALLDONTLIE API and shows each one as a card.

// The address every request starts with.
const API_BASE = "/api/bdl/v1";

// The day the user is looking at. Starts as today; the date pager changes it.
// "let" (not "const") because this value changes.
let selectedDate = new Date();

// Games we already downloaded, saved by date, so going back to a day doesn't use another request.
// It's an object used like a dictionary: gamesCache["2026-10-21"] = [ ...that day's games ]
const gamesCache = {};

// ---------- Date helpers ----------

// The API wants dates written like "2026-10-16".
// "en-CA" (Canadian English) happens to format dates exactly that way.
function toApiDate(date) {
  return date.toLocaleDateString("en-CA");
}

// Returns a NEW date that is "days" away from the given one (use a negative number to go back).
// We copy first so the original date isn't changed by accident.
function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// "Today", "Tomorrow", or something like "Sat, Oct 18".
function dayLabel(date) {
  const day = toApiDate(date);
  if (day === toApiDate(new Date())) return "Today";
  if (day === toApiDate(addDays(new Date(), 1))) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ---------- Drawing on the page ----------

// Text for the top of each card: tip-off time, live score, or final score.
function describeTime(game) {
  if (game.status === "Final") {
    return `Final: ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  // period is 0 before tip-off, then 1, 2, 3, 4 during the game.
  if (game.period > 0) {
    return `LIVE · ${game.status} · ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  const tipOff = new Date(game.datetime || game.date);
  return tipOff.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Show a message where the cards go (used for loading, errors and "no games").
function showMessage(text, colorClass) {
  const gamesList = document.getElementById("games-list");
  gamesList.innerHTML = `<div class="lh-games-message ${colorClass}">${text}</div>`;
  updateGamesCarousel(); // no cards = no arrows
}

// ---------- Games carousel ----------
// #games-list is a row of cards you can scroll sideways (CSS scroll-snap). The ‹ › buttons scroll by one page
// (as many cards as fit), and the counter says which games are showing, like "1–3 of 8".

// Shows or hides the arrows and counter, and enables / disables each arrow at the ends.
function updateGamesCarousel() {
  const track = document.getElementById("games-list");
  const prev = document.getElementById("gamesPrev");
  const next = document.getElementById("gamesNext");
  const count = document.getElementById("gamesCount");
  const cards = track.querySelectorAll(".lh-game-slot");

  const overflows = cards.length > 0 && track.scrollWidth > track.clientWidth + 1;
  prev.hidden = !overflows;
  next.hidden = !overflows;
  count.hidden = !overflows;
  if (!overflows) return;

  const step = cards[0].offsetWidth + (cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft - cards[0].offsetWidth : 0);
  const perPage = Math.max(1, Math.round(track.clientWidth / step));
  const first = Math.min(cards.length - 1, Math.round(track.scrollLeft / step));
  const last = Math.min(cards.length, first + perPage);
  // Phones (one card at a time, swiping): "1 / 11". Wider screens: "1–3 of 11".
  const onPhone = window.matchMedia("(max-width: 575.98px)").matches;
  count.textContent = onPhone ? `${first + 1} / ${cards.length}` : `${first + 1}–${last} of ${cards.length}`;
  prev.disabled = track.scrollLeft <= 1;
  next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}

// Phones: the card that is only peeking in from the side is faded, so the cards read as separate.
function markPeekingCards() {
  const track = document.getElementById("games-list");
  const left = track.getBoundingClientRect().left;
  const right = left + track.clientWidth;
  track.querySelectorAll(".lh-game-slot").forEach((slot) => {
    const box = slot.getBoundingClientRect();
    const visible = Math.max(0, Math.min(box.right, right) - Math.max(box.left, left));
    slot.classList.toggle("is-peek", visible < box.width * 0.75);
  });
}

// Phones, first visit only: the row slides a little to the left and back, so it's clear there are more games to swipe to.
const SWIPE_HINT_KEY = "lh-swipe-hint";
function swipeHintOnce() {
  const track = document.getElementById("games-list");
  const phone = window.matchMedia("(max-width: 575.98px)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!phone || reduced || track.querySelectorAll(".lh-game-slot").length < 2) return;
  try {
    if (localStorage.getItem(SWIPE_HINT_KEY)) return;
    localStorage.setItem(SWIPE_HINT_KEY, "1");
  } catch (error) {
    return; // storage blocked: no hint rather than one on every visit
  }
  track.classList.add("is-hinting");
  setTimeout(() => track.classList.remove("is-hinting"), 1700);
}

// Each card's season record (the standings, one request) and the spread / total line (one odds request for every game).
async function fillGameCardExtras(games, day) {
  const track = document.getElementById("games-list");
  const season = games[0] ? games[0].season : null;
  if (season && typeof fetchStandings === "function") {
    fetchStandings(season).then((records) => {
      if (day !== toApiDate(selectedDate) || !records) return;
      track.querySelectorAll("[data-record]").forEach((el) => {
        const record = records[el.dataset.record];
        el.textContent = record && record.overall ? record.overall : "";
      });
    }).catch(() => {});
  }
  try {
    const json = await bdlGet(`${ODDS_URL}?${games.map((game) => `game_ids[]=${game.id}`).join("&")}`);
    if (day !== toApiDate(selectedDate)) return;
    games.forEach((game) => {
      const row = pickOddsRow((json.data || []).filter((item) => item.game_id === game.id));
      const el = track.querySelector(`[data-game-id="${game.id}"] [data-odds-line]`);
      if (!el) return;
      el.textContent = row
        ? `${game.home_team.abbreviation} ${spreadText(Number(row.spread_home_value))} · O/U ${Number(row.total_value)}`
        : "Lines not posted yet";
    });
  } catch (error) {
    track.querySelectorAll("[data-odds-line]").forEach((el) => { el.textContent = ""; });
  }
}

// Scrolls one page left (-1) or right (1). Instant for people who prefer reduced motion.
function scrollGames(direction) {
  const track = document.getElementById("games-list");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  track.scrollBy({ left: direction * track.clientWidth, behavior: reduced ? "auto" : "smooth" });
}

document.getElementById("gamesPrev").addEventListener("click", () => scrollGames(-1));
document.getElementById("gamesNext").addEventListener("click", () => scrollGames(1));
document.getElementById("games-list").addEventListener("scroll", () => { updateGamesCarousel(); markPeekingCards(); }, { passive: true });
window.addEventListener("resize", () => { updateGamesCarousel(); markPeekingCards(); });

// Add one tab to the date pager (same underline tabs as the rest of the site: lh-tabs in css/styles.css).
// When clicked, it makes "date" the selected day and loads that day's games.
// extraClass is optional: extra Bootstrap classes for this one tab.
// ariaLabel is optional: what screen readers say instead of the text (for the ‹ › arrows).
function addPagerItem(pager, text, date, isActive, extraClass = "", ariaLabel = "") {
  const item = document.createElement("li");
  item.className = `nav-item ${extraClass}`;

  const button = document.createElement("button");
  button.type = "button";
  // active = white text with the blue underline
  button.className = isActive ? "nav-link active" : "nav-link";
  if (isActive) button.setAttribute("aria-current", "date"); // tells screen readers this is the picked day
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  button.textContent = text;
  button.addEventListener("click", () => {
    selectedDate = date;
    loadGames();
  });

  item.appendChild(button);
  pager.appendChild(item);
}

// Build the whole pager: ‹ arrow, 5 days (2 before, the selected day, 2 after), › arrow.
function renderPager() {
  const pager = document.getElementById("date-pager");
  pager.innerHTML = "";

  addPagerItem(pager, "‹", addDays(selectedDate, -1), false, "", "Previous day");

  for (let offset = -2; offset <= 2; offset++) {
    const day = addDays(selectedDate, offset);
    // Build the label ourselves, like "Sat 18": short weekday name + day of the month.
    const weekday = day.toLocaleDateString("en-US", { weekday: "short" });
    const text = `${weekday} ${day.getDate()}`;
    // The outer two days are hidden on phones to save space:
    // d-none = hidden, d-sm-block = shown again from "small" screens (576px) and up.
    const extraClass = Math.abs(offset) === 2 ? "d-none d-sm-block" : "";
    addPagerItem(pager, text, day, offset === 0, extraClass);
  }

  addPagerItem(pager, "›", addDays(selectedDate, 1), false, "", "Next day");
}

// ---------- Loading games ----------

// "async" lets this function wait for the internet with "await".
async function loadGames() {
  // Update the heading and the pager for the chosen day.
  document.getElementById("games-date-label").textContent = dayLabel(selectedDate);
  renderPager();

  const day = toApiDate(selectedDate);

  // try/catch: if anything inside "try" fails, we jump to "catch" instead of crashing.
  try {
    // Already downloaded this day? Use the saved copy.
    let games = gamesCache[day];

    if (!games) {
      showMessage("Loading games...", "text-muted");

      // Start and end on the same day = only that day's games.
      const url = `${API_BASE}/games?start_date=${day}&end_date=${day}&per_page=25`;

      // bdlGet (js/core/stats.js) asks our own /api/bdl proxy, which adds the API key on the server. It retries a busy API
      // (429 / 5xx) twice, shares identical requests, and throws a readable error for the catch below.
      const json = await bdlGet(url);
      games = json.data;
      gamesCache[day] = games; // save for next time
    }

    // Clicked to another day while this one was downloading? Then this answer is old news:
    // the newer click's loadGames() will draw its own day, so stop here.
    if (day !== toApiDate(selectedDate)) return;

    // The tool tiles and the Top 5 Hunts card follow the same day (js/pages/today.js), then the slate they read is built
    // (js/components/top-hit-rates.js, shared with the tool pages through its 10-minute cache).
    if (typeof showTodayForDay === "function") showTodayForDay(day);
    showTopHitRatesForDay(day, games);

    if (games.length === 0) {
      showMessage("No games scheduled for this day.", "text-muted");
      return;
    }

    // Sort soonest first.
    games.sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date));

    // Clear the message and add one card per game. New day = back to the first card.
    const gamesList = document.getElementById("games-list");
    gamesList.innerHTML = "";
    gamesList.scrollLeft = 0;

    // One card per game in the Swiss look of the game page header: tip time, both abbreviations underlined in the team colors,
    // city + record, the spread / total line, then Quick look and View props. css/styles.css sizes the slides (3 / 2 / 1 per page).
    games.forEach((game) => {
      const col = document.createElement("div");
      col.className = "lh-game-slot";
      const away = game.visitor_team;
      const home = game.home_team;
      const colors = matchupColors(away.abbreviation, home.abbreviation);
      col.innerHTML = `
        <article class="lh-gc" data-game-id="${game.id}">
          <div class="lh-gc-when"><span>${describeTime(game)}</span></div>
          <div class="lh-gc-teams">
            <div class="lh-gc-team">
              <span class="lh-gc-abbr" style="border-bottom-color: ${colors.away}">${away.abbreviation}</span>
              <span class="lh-gc-city">${away.city} <span class="lh-gc-rec" data-record="${away.id}"></span></span>
            </div>
            <span class="lh-gc-at" aria-hidden="true">@</span>
            <div class="lh-gc-team is-home">
              <span class="lh-gc-abbr" style="border-bottom-color: ${colors.home}">${home.abbreviation}</span>
              <span class="lh-gc-city">${home.city} <span class="lh-gc-rec" data-record="${home.id}"></span></span>
            </div>
          </div>
          <div class="lh-gc-line lines-only" data-odds-line>&nbsp;</div>
          <div class="collapse" id="ql-${game.id}"><div class="lh-ql-body">Loading...</div></div>
          <div class="lh-gc-foot">
            <button type="button" class="lh-gc-ql collapsed" data-bs-toggle="collapse" data-bs-target="#ql-${game.id}" aria-expanded="false" aria-controls="ql-${game.id}">
              Quick look <i class="bi bi-chevron-down lh-mi-chevron" aria-hidden="true"></i>
            </button>
            <a href="game.html?id=${game.id}" class="lh-gc-go stretched-link">View <span class="lines-only">props</span><span class="research-only">stats</span> ›</a>
          </div>
        </article>
      `;
      setUpQuickLook(col, game);
      gamesList.appendChild(col);
    });
    fillGameCardExtras(games, day);
    updateGamesCarousel();
    markPeekingCards();
    swipeHintOnce();
  } catch (error) {
    if (day !== toApiDate(selectedDate)) return; // an old day's error, the user has moved on
    console.error(error); // full details go to the browser console (F12)
    showMessage(`Couldn't load games: ${error.message}`, "text-danger");
  }
}

// Run it when the page loads.
loadGames();
