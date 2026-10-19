// LineHunter - js/components/gameInjuries.js
// The "Injury report" card on game.html, next to Matchup Info: who is hurt on each team of this game, with the same look as the
// player page's Injury report card (name, status badge, and a "Details" dropdown with the description and expected return).
// Needs js/core/stats.js (BDL_BASE, bdlGetAllPages). js/pages/game.js calls loadGameInjuries(game) once the game is loaded.
//
//   GET /v1/player_injuries?team_ids[]=2&team_ids[]=9&per_page=100 -> data[] { player: { id, first_name, last_name, team_id },
//       status, description, return_date }

// Out first, then Doubtful, Questionable, Day-To-Day.
function gameInjuryOrder(status) {
  const text = (status || "").toLowerCase();
  if (text.startsWith("out")) return 0;
  if (text.includes("doubt")) return 1;
  if (text.includes("question")) return 2;
  return 3;
}

// The badge next to the name: OUT red, DTD yellow, Q light grey (Doubtful uses yellow, anything else grey).
function gameInjuryBadge(status) {
  const text = (status || "").toLowerCase();
  if (text.startsWith("out")) return { label: "OUT", className: "is-out" };
  if (text.includes("day")) return { label: "DTD", className: "is-dtd" };
  if (text.includes("question")) return { label: "Q", className: "is-q" };
  if (text.includes("doubt")) return { label: "Doubtful", className: "is-dtd" };
  return { label: status || "?", className: "is-q" };
}

function gameInjuryDate(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// One injured player. Built with createElement / textContent, so text from the API can never turn into HTML.
function gameInjuryItem(item) {
  const badge = gameInjuryBadge(item.status);
  const detailsId = `ginj-${item.player.id}`;

  const wrap = document.createElement("div");
  wrap.className = "lh-injury-item";

  const head = document.createElement("div");
  head.className = "lh-injury-head";

  const name = document.createElement("a");
  name.className = "lh-injury-name lh-player-link";
  name.href = `player.html?id=${item.player.id}`;
  name.textContent = `${item.player.first_name.charAt(0)}. ${item.player.last_name}`;

  const status = document.createElement("span");
  status.className = `lh-inj-badge ${badge.className}`;
  status.textContent = badge.label;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lh-explain-toggle collapsed ms-auto";
  toggle.setAttribute("data-bs-toggle", "collapse");
  toggle.setAttribute("data-bs-target", `#${detailsId}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", detailsId);
  toggle.setAttribute("aria-label", `Show injury details for ${item.player.first_name} ${item.player.last_name}`);
  toggle.innerHTML = `Details <i class="bi bi-chevron-down lh-mi-chevron" aria-hidden="true"></i>`;
  head.append(name, status, toggle);

  const details = document.createElement("div");
  details.className = "collapse";
  details.id = detailsId;
  const text = document.createElement("p");
  text.className = "lh-explain-text lh-injury-desc";
  text.textContent = item.description || "No details yet.";
  details.appendChild(text);
  if (item.return_date) {
    const back = document.createElement("p");
    back.className = "lh-injury-back";
    back.textContent = `Expected back: ${gameInjuryDate(item.return_date)}`;
    details.appendChild(back);
  }

  wrap.append(head, details);
  return wrap;
}

async function loadGameInjuries(game) {
  const box = document.getElementById("gameInjuryList");
  if (!box) return;

  // Away team first, then home (the same order as the header).
  const teams = [
    { id: game.visitor_team.id, abbr: game.visitor_team.abbreviation },
    { id: game.home_team.id, abbr: game.home_team.abbreviation },
  ];

  try {
    const injuries = await bdlGetAllPages(`${BDL_BASE}/player_injuries?${teams.map((team) => `team_ids[]=${team.id}`).join("&")}&per_page=100`);
    box.innerHTML = "";
    teams.forEach((team) => {
      const heading = document.createElement("div");
      heading.className = "lh-injury-team lh-label";
      heading.textContent = team.abbr;
      box.appendChild(heading);

      const hurt = injuries
        .filter((item) => item.player && item.player.team_id === team.id)
        .sort((a, b) => gameInjuryOrder(a.status) - gameInjuryOrder(b.status));
      if (hurt.length === 0) {
        const none = document.createElement("div");
        none.className = "lh-injury-none text-muted small";
        none.textContent = "No injuries reported.";
        box.appendChild(none);
        return;
      }
      hurt.forEach((item) => box.appendChild(gameInjuryItem(item)));
    });
  } catch (error) {
    console.warn("Injury report unavailable:", error);
    box.innerHTML = `<div class="text-muted small p-3">Injury report is unavailable right now.</div>`;
  }
}
