// LineHunter - game.js
// The page for ONE game: the matchup at the top, then every player prop line for that game.
// The game comes from the address bar: game.html?id=12345

const API_BASE = "https://api.balldontlie.io/v1";
const PROPS_URL = "https://api.balldontlie.io/nba/v2/odds/player_props";

// Several sportsbooks post a line for the same player and prop.
// We show one per player: this book if it has one, otherwise the first one we find.
const PREFERRED_BOOK = "draftkings";

let allLines = [];       // every line for this game, cleaned up and with player names added
let selectedProp = null; // which prop type the pills are showing, like "points"

// Read the "id" part of "?id=12345" from the address bar.
const gameId = new URLSearchParams(window.location.search).get("id");

// ---------- Helpers ----------

// One function for every API call, so the key and error handling live in one place.
async function apiGet(url) {
  const response = await fetch(url, { headers: { Authorization: BDL_API_KEY } });
  if (response.status === 401) {
    throw new Error("The API said no (401). Your plan may not include this data, or the key is wrong.");
  }
  if (response.status === 429) {
    throw new Error("Too many requests. Wait a minute and try again.");
  }
  if (!response.ok) {
    throw new Error(`The API answered with status ${response.status}`);
  }
  return response.json();
}

// Same idea as in app.js: tip-off time, live score, or final score.
function describeTime(game) {
  if (game.status === "Final") {
    return `Final: ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  if (game.period > 0) {
    return `LIVE · ${game.status} · ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  const tipOff = new Date(game.datetime || game.date);
  return tipOff.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// American odds: show a + in front of positive numbers (+120), leave negatives as they are (-110).
function formatOdds(odds) {
  if (odds === null || odds === undefined) return "–";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function propStatKey(propType) {
  const normalized = propType.toLowerCase();

  if (normalized.includes("points")) return "pts";
  if (normalized.includes("rebounds")) return "reb";
  if (normalized.includes("assists")) return "ast";
  if (normalized.includes("steals")) return "stl";
  if (normalized.includes("blocks")) return "blk";
  if (normalized.includes("threes") || normalized.includes("three")) return "fg3m";
  if (normalized.includes("turnovers")) return "turnover";

  return "pts";
}

function formatStatValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return Number(value).toFixed(1);
}

function buildStatSummary(statRecords, propType) {
  const statKey = propStatKey(propType);
  const values = (statRecords || []).map((record) => Number(record[statKey] ?? 0));

  return {
    avgThisSeason: average(values),
    last5: average(values.slice(-5)),
    last10: average(values.slice(-10)),
  };
}

// "points" -> "Points", "points_rebounds_assists" -> "Points + Rebounds + Assists"
function propLabel(propType) {
  return propType
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" + ");
}

// "draftkings" -> "Draftkings" (good enough for now)
function bookLabel(vendor) {
  return vendor[0].toUpperCase() + vendor.slice(1);
}

function showLinesMessage(text, colorClass) {
  const message = document.getElementById("lines-message");
  message.className = colorClass;
  message.textContent = text;
  message.classList.remove("d-none");
  document.getElementById("lines-table").classList.add("d-none");
}

// ---------- Drawing on the page ----------

function renderGameHeader(game) {
  document.title = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation} · LineHunter`;

  // lh-label / lh-display / display-3 = our label font and big condensed font (styles.css)
  const visitorColor = getNeutralTeamColor(game.visitor_team.abbreviation);
  const homeColor = getNeutralTeamColor(game.home_team.abbreviation);

  document.getElementById("game-header").innerHTML = `
    <div class="card-body p-3 p-md-4">
      <div class="lh-label text-center mb-3">${describeTime(game)}</div>
      <div class="d-flex justify-content-between align-items-center text-center gap-2">
        <div class="flex-fill">
          <div class="lh-display display-5 mb-1" style="color: ${visitorColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.visitor_team.abbreviation}</div>
          <div class="text-muted small">${game.visitor_team.full_name}</div>
        </div>
        <div class="lh-label px-2">@</div>
        <div class="flex-fill">
          <div class="lh-display display-5 mb-1" style="color: ${homeColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.home_team.abbreviation}</div>
          <div class="text-muted small">${game.home_team.full_name}</div>
        </div>
      </div>
    </div>
  `;
}

// One pill button per prop type. Clicking one shows that prop's lines.
function renderPills(propTypes) {
  const pills = document.getElementById("prop-pills");
  pills.innerHTML = "";

  propTypes.forEach((propType) => {
    const item = document.createElement("li");
    item.className = "nav-item";

    const button = document.createElement("button");
    // text-nowrap = keep long names like "Points + Rebounds" on one line
    button.className = propType === selectedProp ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = propLabel(propType);
    button.addEventListener("click", () => {
      selectedProp = propType;
      renderPills(propTypes); // redraw so the new pill is highlighted
      renderTable();
    });

    item.appendChild(button);
    pills.appendChild(item);
  });
}

// Fill the table with the lines for the selected prop, biggest line first.
function renderTable() {
  const lines = allLines
    .filter((line) => line.propType === selectedProp)
    .sort((a, b) => b.line - a.line);

  const body = document.getElementById("lines-body");
  body.innerHTML = "";

  lines.forEach((line) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="fw-semibold">${line.playerName}</td>
      <td class="text-muted">${line.team}</td>
      <td class="text-end line-value">${line.line}</td>
      <td class="text-end">${formatStatValue(line.avgThisSeason)}</td>
      <td class="text-end">${formatStatValue(line.last5)}</td>
      <td class="text-end">${formatStatValue(line.last10)}</td>
    `;
    body.appendChild(row);
  });

  document.getElementById("lines-message").classList.add("d-none");
  document.getElementById("lines-table").classList.remove("d-none");
}

// ---------- Loading everything ----------

async function loadPage() {
  if (typeof BDL_API_KEY === "undefined" || BDL_API_KEY === "paste-your-key-here") {
    showLinesMessage("No API key yet. Copy config.example.js to config.js and paste your key in.", "text-danger");
    return;
  }
  if (!gameId) {
    showLinesMessage("No game picked. Go back and click a game card.", "text-danger");
    return;
  }

  try {
    // 1. The game itself, for the header card.
    const gameJson = await apiGet(`${API_BASE}/games/${gameId}`);
    renderGameHeader(gameJson.data);

    // 2. Every prop line for this game, from every sportsbook.
    const propsJson = await apiGet(`${PROPS_URL}?game_id=${gameId}`);

    // Keep only simple over/under lines (skip "milestone" markets for now).
    const overUnders = propsJson.data.filter((prop) => prop.market.type === "over_under");

    if (overUnders.length === 0) {
      showLinesMessage("No prop lines posted for this game yet. Books usually post them the day before or the day of the game.", "text-muted");
      return;
    }

    // 3. Keep ONE line per player per prop type, preferring PREFERRED_BOOK.
    // "picked" works like a dictionary: picked["237-points"] = that line
    const picked = {};
    overUnders.forEach((prop) => {
      const key = `${prop.player_id}-${prop.prop_type}`;
      if (!picked[key] || prop.vendor === PREFERRED_BOOK) {
        picked[key] = prop;
      }
    });
    const chosen = Object.values(picked); // turn the dictionary back into a list

    // 4. The props only have player ids, so ask for the names in one request.
    // new Set(...) removes duplicate ids; [... ] turns it back into a list.
    const playerIds = [...new Set(chosen.map((prop) => prop.player_id))];
    const idParams = playerIds.map((id) => `player_ids[]=${id}`).join("&");
    const playersJson = await apiGet(`${API_BASE}/players?per_page=100&${idParams}`);

    const players = {}; // players[237] = { first_name: ..., team: ... }
    playersJson.data.forEach((player) => {
      players[player.id] = player;
    });

    const currentSeason = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const statsJson = await apiGet(`${API_BASE}/stats?seasons[]=${currentSeason}&per_page=100&${idParams}`)
      .catch((error) => {
        console.warn("Player stats unavailable for the table:", error);
        return { data: [] };
      });

    const statsByPlayer = {};
    statsJson.data.forEach((stat) => {
      const playerId = stat.player && stat.player.id;
      if (!playerId) return;
      if (!statsByPlayer[playerId]) statsByPlayer[playerId] = [];
      statsByPlayer[playerId].push(stat);
    });

    // 5. Build clean rows for the table.
    allLines = chosen.map((prop) => {
      const player = players[prop.player_id];
      const statSummary = buildStatSummary(statsByPlayer[prop.player_id], prop.prop_type);

      return {
        playerName: player ? `${player.first_name.charAt(0)}. ${player.last_name}` : `Player #${prop.player_id}`,
        team: player && player.team ? player.team.abbreviation : "",
        propType: prop.prop_type,
        line: Number(prop.line_value), // the API sends "24.5" as text; Number() makes it 24.5
        avgThisSeason: statSummary.avgThisSeason,
        last5: statSummary.last5,
        last10: statSummary.last10,
      };
    });

    // 6. Pills for every prop type found. Start on Points if there is one.
    const propTypes = [...new Set(allLines.map((line) => line.propType))];
    selectedProp = propTypes.includes("points") ? "points" : propTypes[0];

    renderPills(propTypes);
    renderTable();
  } catch (error) {
    console.error(error);
    showLinesMessage(`Couldn't load this game: ${error.message}`, "text-danger");
  }
}

loadPage();
