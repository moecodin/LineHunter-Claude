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

// Scrolls one page left (-1) or right (1). Instant for people who prefer reduced motion.
function scrollGames(direction) {
  const track = document.getElementById("games-list");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  track.scrollBy({ left: direction * track.clientWidth, behavior: reduced ? "auto" : "smooth" });
}

document.getElementById("gamesPrev").addEventListener("click", () => scrollGames(-1));
document.getElementById("gamesNext").addEventListener("click", () => scrollGames(1));
document.getElementById("games-list").addEventListener("scroll", updateGamesCarousel, { passive: true });
window.addEventListener("resize", updateGamesCarousel);

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

    // The Top Hit Rates card under the games follows the same day (js/components/top-hit-rates.js).
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

    // forEach can also give us the position (index) of each game: 0, 1, 2, 3...
    games.forEach((game, index) => {
      // One slide per game. css/styles.css sizes them: 3 per page on desktop, 2 on tablets, 1 on phones.
      const col = document.createElement("div");
      col.className = "lh-game-slot";

      // Pick shade 1, 2 or 3 in turn. % gives the remainder after dividing:
      // index 0 -> 0 -> shade-1, index 1 -> shade-2, index 2 -> shade-3, index 3 -> shade-1 again...
      const shade = `shade-${(index % 3) + 1}`;

      // The card's HTML, written as a template string so ${...} fills in the game's data.
      // The whole card is a link (<a>) to that game's page: game.html?id=12345
      // game-card + shade-N = our blue gradient (css/styles.css). h-100 = same height in a row.
      // text-reset + text-decoration-none = keep normal text colors, no underline.
  const visitorShade = getNeutralTeamIndex(game.visitor_team.abbreviation); // which gray (.lh-abbr-N, one set per theme)
  const homeShade = getNeutralTeamIndex(game.home_team.abbreviation);

      // The card is a normal box (not one big link) so the "Quick look" button can live inside it.
      // The "View props ›" footer is the link; stretched-link stretches it over the whole card.
      col.innerHTML = `
        <div class="card game-card ${shade} h-100 text-reset">
          <div class="card-body p-3">
            <div class="lh-label text-center mb-2">${describeTime(game)}</div>
            <div class="d-flex justify-content-between align-items-center text-center">
              <div class="flex-fill">
                <div class="lh-display display-6 lh-abbr lh-abbr-${visitorShade}">${game.visitor_team.abbreviation}</div>
                <div class="small text-muted mt-1">${game.visitor_team.full_name}</div>
              </div>
              <div class="lh-label px-2">@</div>
              <div class="flex-fill">
                <div class="lh-display display-6 lh-abbr lh-abbr-${homeShade}">${game.home_team.abbreviation}</div>
                <div class="small text-muted mt-1">${game.home_team.full_name}</div>
              </div>
            </div>
          </div>
          <div class="lh-ql">
            <button type="button" class="btn btn-sm btn-outline-secondary lh-mi-toggle collapsed" data-bs-toggle="collapse"
                    data-bs-target="#ql-${game.id}" aria-expanded="false" aria-controls="ql-${game.id}">
              Quick look <i class="bi bi-chevron-down lh-mi-chevron" aria-hidden="true"></i>
            </button>
            <div class="collapse" id="ql-${game.id}"><div class="lh-ql-body">Loading...</div></div>
          </div>
          <a href="game.html?id=${game.id}" class="card-footer lh-label text-accent text-center py-2 text-decoration-none stretched-link">View <span class="lines-only">props</span><span class="research-only">stats</span> ›</a>
        </div>
      `;
      // Team colors: the slash tint and edge glows (js/data/teams.js, css/styles.css .lh-team-card)
      applyMatchupColors(col.querySelector(".game-card"), game.visitor_team.abbreviation, game.home_team.abbreviation);
      setUpQuickLook(col, game);

      gamesList.appendChild(col);
    });
    updateGamesCarousel();
  } catch (error) {
    if (day !== toApiDate(selectedDate)) return; // an old day's error, the user has moved on
    console.error(error); // full details go to the browser console (F12)
    showMessage(`Couldn't load games: ${error.message}`, "text-danger");
  }
}

// Run it when the page loads.
loadGames();
