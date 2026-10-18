// LineHunter - app.js
// Loads NBA games for a chosen day from the BALLDONTLIE API and shows each one as a card.

// The address every request starts with.
const API_BASE = "https://api.balldontlie.io/v1";

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
  gamesList.innerHTML = `<div class="col-12 ${colorClass}">${text}</div>`;
}

// Add one tab to the date pager (same underline tabs as the rest of the site: lh-tabs in styles.css).
// When clicked, it makes "date" the selected day and loads that day's games.
// extraClass is optional: extra Bootstrap classes for this one tab.
// ariaLabel is optional: what screen readers say instead of the text (for the ‹ › arrows).
function addPagerItem(pager, text, date, isActive, extraClass = "", ariaLabel = "") {
  const item = document.createElement("li");
  item.className = `nav-item ${extraClass}`;

  const button = document.createElement("button");
  button.type = "button";
  // active = white text with the violet underline
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
  // Stop early if the key file is missing or still has the placeholder.
  if (typeof BDL_API_KEY === "undefined" || BDL_API_KEY === "paste-your-key-here") {
    showMessage("No API key yet. Copy config.example.js to config.js and paste your key in.", "text-danger");
    return;
  }

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

      // fetch = ask the API for data. The key goes in the Authorization header.
      const response = await fetch(url, {
        headers: { Authorization: BDL_API_KEY },
      });

      // 429 = too many requests for your plan's per-minute limit.
      if (response.status === 429) {
        throw new Error("Too many requests (429). Your plan's per-minute limit was reached, so wait a minute and try again.");
      }
      // Any other problem (401 = bad key, 500 = their server had a problem, etc.)
      if (!response.ok) {
        throw new Error(`The API answered with status ${response.status}`);
      }

      // Turn the response text into a JavaScript object. The games are in .data
      const json = await response.json();
      games = json.data;
      gamesCache[day] = games; // save for next time
    }

    // Clicked to another day while this one was downloading? Then this answer is old news:
    // the newer click's loadGames() will draw its own day, so stop here.
    if (day !== toApiDate(selectedDate)) return;

    // The Top Hit Rates card under the games follows the same day (js/top-hit-rates.js).
    showTopHitRatesForDay(day, games);

    if (games.length === 0) {
      showMessage("No games scheduled for this day.", "text-muted");
      return;
    }

    // Sort soonest first.
    games.sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date));

    // Clear the message and add one card per game.
    const gamesList = document.getElementById("games-list");
    gamesList.innerHTML = "";

    // forEach can also give us the position (index) of each game: 0, 1, 2, 3...
    games.forEach((game, index) => {
      // One grid column per game:
      // col-12 = full width on phones, col-md-6 = 2 per row on tablets, col-lg-4 = 3 per row on desktop
      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-lg-4";

      // Pick shade 1, 2 or 3 in turn. % gives the remainder after dividing:
      // index 0 -> 0 -> shade-1, index 1 -> shade-2, index 2 -> shade-3, index 3 -> shade-1 again...
      const shade = `shade-${(index % 3) + 1}`;

      // The card's HTML, written as a template string so ${...} fills in the game's data.
      // The whole card is a link (<a>) to that game's page: game.html?id=12345
      // game-card + shade-N = our violet gradient (styles.css). h-100 = same height in a row.
      // text-reset + text-decoration-none = keep normal text colors, no underline.
      const visitorColor = getNeutralTeamColor(game.visitor_team.abbreviation);
      const homeColor = getNeutralTeamColor(game.home_team.abbreviation);

      col.innerHTML = `
        <a href="game.html?id=${game.id}" class="card game-card ${shade} h-100 text-reset text-decoration-none">
          <div class="card-body p-4">
            <div class="lh-label text-center mb-3">${describeTime(game)}</div>
            <div class="d-flex justify-content-between align-items-center text-center">
              <div class="flex-fill">
                <div class="lh-display display-5" style="color: ${visitorColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.visitor_team.abbreviation}</div>
                <div class="small text-muted mt-1">${game.visitor_team.full_name}</div>
              </div>
              <div class="lh-label px-2">@</div>
              <div class="flex-fill">
                <div class="lh-display display-5" style="color: ${homeColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.home_team.abbreviation}</div>
                <div class="small text-muted mt-1">${game.home_team.full_name}</div>
              </div>
            </div>
          </div>
          <div class="card-footer lh-label text-accent text-center py-3">View props ›</div>
        </a>
      `;

      gamesList.appendChild(col);
    });
  } catch (error) {
    if (day !== toApiDate(selectedDate)) return; // an old day's error, the user has moved on
    console.error(error); // full details go to the browser console (F12)
    showMessage(`Couldn't load games: ${error.message}`, "text-danger");
  }
}

// Run it when the page loads.
loadGames();
