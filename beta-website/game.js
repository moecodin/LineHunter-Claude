// One of tonight's games: game.html?g=PHX-DEN. The data is SAMPLE data from league.js.
(function () {
  const params = new URLSearchParams(location.search);
  const root = document.getElementById("game");
  const g = LEAGUE.game(params.get("g"));

  if (!g) {
    document.title = "Line Hunter | Game not found";
    root.innerHTML = `<section class="rs-panel rs-missing"><h1>Game not found</h1><p>That game isn't on tonight's slate.</p><a class="rs-empty-clear" href="index.html">Back to tonight's games</a></section>`;
    return;
  }

  const id = LEAGUE.gameId(g);
  const homeUrl = `index.html?game=${id}`;
  document.getElementById("logo-home").href = homeUrl;
  document.getElementById("nav-home").href = homeUrl;
  document.title = `Line Hunter | ${g.away} @ ${g.home}`;

  const fmtOdds = (o) => (o > 0 ? `+${o}` : `−${Math.abs(o)}`);
  // Hit rates only: 49 and below red, 50 to 74 yellow, 75 and up green. Same rule as the player page.
  const pctClass = (p) => `rs-pct ${Math.round(p) >= 75 ? "rs-pct-high" : Math.round(p) >= 50 ? "rs-pct-mid" : "rs-pct-low"}`;
  const gapText = (gap) => (Number(Math.abs(gap).toFixed(1)) === 0 ? "0.0%" : `${gap >= 0 ? "▲" : "▼"}${Math.abs(gap).toFixed(1)}%`);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (date) => { const [m, d] = date.split("/").map(Number); return `${MONTHS[m - 1]} ${d}`; };

  // White or dark text, whichever reads better on the team's color.
  function textOn(hex) {
    const channel = (start) => {
      const v = parseInt(hex.substr(start, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0534 ? "#fff" : "#060a16";
  }

  const awayStats = LEAGUE.teamStats(g.away);
  const homeStats = LEAGUE.teamStats(g.home);
  const at = GAMES_TODAY.indexOf(g);
  const neighbor = (delta) => GAMES_TODAY[(at + delta + GAMES_TODAY.length) % GAMES_TODAY.length];

  // A player's own prop comes first, then their other main stats on the Over.
  function propsFor(p) {
    const others = ["PTS", "REB", "AST", "PRA"].filter((stat) => stat !== p.marketStat);
    return [LEAGUE.propTonight(p, p.marketStat, p.marketDir), ...others.map((stat) => LEAGUE.propTonight(p, stat, "Over"))];
  }
  const groups = [g.away, g.home].flatMap((team) => LEAGUE.playersOn(team)).map((p) => ({ p, props: propsFor(p) }));
  const countFor = (team) => groups.filter(({ p }) => team === "All" || p.team === team).reduce((sum, x) => sum + x.props.length, 0);

  // How far a line sits from break-even, drawn from a center line like the ladder's bars.
  const MAX_BAR_GAP = 40;
  function gapBar(gap) {
    const size = Math.min(Math.abs(gap) / MAX_BAR_GAP, 1) * 50;
    return `<span class="gm-bar" aria-hidden="true"><i class="${gap < 0 ? "is-below" : "is-above"}" style="width:max(2px, ${size}%)"></i></span>`;
  }

  function propRow(p, x) {
    const url = `player.html?p=${p.id}&stat=${x.stat}&side=${x.side}`;
    const words = `${x.side} ${x.line.toFixed(1)} ${x.label}`;
    const streak = x.streak >= 3 ? `<small>${x.streak} straight</small>` : "";
    return `<tr>
      <th scope="row"><a href="${url}" data-wipe aria-label="${p.name}, ${words}: hit in ${x.hits} of ${x.total} games, needs ${x.need.toFixed(1)}% at ${fmtOdds(x.price.price)}">${words}</a>${streak}</th>
      <td class="${pctClass(x.pct)}">${Math.round(x.pct)}%<small>${x.hits} of ${x.total}</small></td>
      <td class="gm-wide">${x.need.toFixed(1)}%</td>
      <td class="gm-gap">${gapBar(x.gap)}<span>${gapText(x.gap)}</span></td>
      <td class="gm-wide">${fmtOdds(x.price.price)}<small>${x.price.name}</small></td>
      <td class="gm-go" aria-hidden="true"><span class="rs-chevron"></span></td>
    </tr>`;
  }

  function playerBlock({ p, props }) {
    return `<section class="gm-player" data-team="${p.team}" aria-label="${p.name}">
      <header class="gm-player-head">
        <span class="rs-avatar" aria-hidden="true">${p.initials}</span>
        <div>
          <h3><a href="player.html?p=${p.id}" data-wipe>${p.name}</a></h3>
          <p>${p.team} &middot; ${p.pos}${p.mate ? ` &middot; ${p.mate} is out` : ""}</p>
        </div>
      </header>
      <div class="gm-table">
        <table>
          <caption class="sr-only">${p.name}'s props tonight</caption>
          <thead><tr><th scope="col">Line tonight</th><th scope="col">L20 hit rate</th><th scope="col" class="gm-wide">Needs</th><th scope="col">Vs break-even</th><th scope="col" class="gm-wide">Best odds</th><td class="gm-go"></td></tr></thead>
          <tbody>${props.map((x) => propRow(p, x)).join("")}</tbody>
        </table>
      </div>
    </section>`;
  }

  const injuryList = (team) => {
    const list = LEAGUE.injuries(team);
    return `<h3>${team}</h3>${list.length
      ? `<ul class="rs-list">${list.map(([name, pos, status]) => `<li><span>${name}, ${pos}</span><span class="rs-status rs-status-${status.toLowerCase()}">${status}</span></li>`).join("")}</ul>`
      : '<p class="rs-none">No one listed</p>'}`;
  };
  const matchupRow = (label, a, b) => `<tr><td class="num">${a}</td><th scope="row">${label}</th><td class="num">${b}</td></tr>`;
  const meetings = LEAGUE.meetings(g).slice(0, 3);

  const untracked = [g.away, g.home].find((team) => !countFor(team));
  const teamTabs = ["All", g.away, g.home].map((team) => {
    const count = countFor(team);
    return `<button type="button" data-team="${team}" aria-pressed="${team === "All"}"${count ? "" : ' aria-disabled="true"'}>${team}<small>${count}</small></button>`;
  }).join("");

  root.innerHTML = `
    <nav class="gm-top" aria-label="Tonight's games">
      <a class="gm-back" href="${homeUrl}"><span class="rs-chevron" aria-hidden="true"></span>Tonight's games</a>
      <div class="gm-switch">
        <a href="game.html?g=${LEAGUE.gameId(neighbor(-1))}" aria-label="Previous game, ${neighbor(-1).away} at ${neighbor(-1).home}"><span class="rs-chevron" aria-hidden="true"></span><span class="gm-switch-name">${neighbor(-1).away} @ ${neighbor(-1).home}</span></a>
        <a href="game.html?g=${LEAGUE.gameId(neighbor(1))}" aria-label="Next game, ${neighbor(1).away} at ${neighbor(1).home}"><span class="gm-switch-name">${neighbor(1).away} @ ${neighbor(1).home}</span><span class="rs-chevron gm-next" aria-hidden="true"></span></a>
      </div>
    </nav>

    <section class="gm-hero" aria-labelledby="gm-title" style="--away:${TEAM_COLORS[g.away]};--away-text:${textOn(TEAM_COLORS[g.away])};--home:${TEAM_COLORS[g.home]};--home-text:${textOn(TEAM_COLORS[g.home])}">
      <p class="gm-time">${GAMES_DATE} &middot; ${g.time}</p>
      <div class="gm-teams">
        <div class="gm-team">
          <h1 id="gm-title"><span>${g.away}</span> <span class="sr-only">at</span><span class="gm-at" aria-hidden="true">@</span> <span class="gm-home-name">${g.home}</span></h1>
          <p class="gm-line gm-line-away"><b>${fmtOdds(g.mlAway)}</b><span>${awayStats.wins}&ndash;${awayStats.losses}</span></p>
        </div>
        <p class="gm-line gm-line-home"><b>${fmtOdds(g.mlHome)}</b><span>${homeStats.wins}&ndash;${homeStats.losses}</span></p>
      </div>
    </section>

    <div class="rs-layout">
      <div class="rs-main">
        <section class="rs-panel gm-props" aria-labelledby="gm-props-title">
          <div class="gm-props-head">
            <div>
              <h2 id="gm-props-title">Props tonight</h2>
              <p>Hit rates from each player's last 20 games. Past results, not a prediction.</p>
            </div>
            <div class="gm-tabs rs-seg" role="group" aria-label="Show props by team">${teamTabs}</div>
          </div>
          <div id="gm-players">${groups.map(playerBlock).join("")}</div>
          ${untracked ? `<p class="gm-untracked">No ${untracked} players are tracked yet.</p>` : ""}
        </section>
      </div>

      <aside class="rs-side" aria-label="Game context">
        <details class="rs-panel" open>
          <summary><h2 class="rs-summary-title">Injury report</h2><span class="rs-summary-hint">${g.away} and ${g.home}</span><span class="rs-chevron rs-chevron-down" aria-hidden="true"></span></summary>
          <div class="rs-injuries">${injuryList(g.away)}${injuryList(g.home)}</div>
        </details>
        <details class="rs-panel" open>
          <summary><h2 class="rs-summary-title">Team matchup</h2><span class="rs-summary-hint">Last 8 games</span><span class="rs-chevron rs-chevron-down" aria-hidden="true"></span></summary>
          <div class="gm-matchup">
            <table>
              <thead><tr><th scope="col" class="num">${g.away}</th><td></td><th scope="col" class="num">${g.home}</th></tr></thead>
              <tbody>
                ${matchupRow("Record", `${awayStats.wins}&ndash;${awayStats.losses}`, `${homeStats.wins}&ndash;${homeStats.losses}`)}
                ${matchupRow("Points", awayStats.points.toFixed(1), homeStats.points.toFixed(1))}
                ${matchupRow("Allowed", awayStats.allowed.toFixed(1), homeStats.allowed.toFixed(1))}
                ${matchupRow("Pace", awayStats.pace.toFixed(1), homeStats.pace.toFixed(1))}
                ${matchupRow("Defense rank", awayStats.defenseRank, homeStats.defenseRank)}
              </tbody>
            </table>
          </div>
        </details>
        <details class="rs-panel" open>
          <summary><h2 class="rs-summary-title">Last meetings</h2><span class="rs-chevron rs-chevron-down" aria-hidden="true"></span></summary>
          ${meetings.length
            ? `<ul class="rs-list gm-meetings">${meetings.map((m) => `<li><span>${shortDate(m.date)}, at ${m.home}</span><span><b>${m.winner} ${m.high}</b>, ${m.loser} ${m.low}</span></li>`).join("")}</ul>`
            : '<p class="rs-none">No recent meetings</p>'}
        </details>
      </aside>
    </div>`;

  // The team tabs, kept in the address so a reload or a shared link keeps the view.
  function showTeam(team) {
    document.querySelectorAll(".gm-tabs button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.team === team));
    document.querySelectorAll(".gm-player").forEach((block) => { block.hidden = team !== "All" && block.dataset.team !== team; });
    const q = new URLSearchParams({ g: id });
    if (team !== "All") q.set("team", team);
    history.replaceState(null, "", `?${q}`);
  }
  document.querySelector(".gm-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && b.getAttribute("aria-disabled") !== "true") showTeam(b.dataset.team);
  });
  const asked = params.get("team");
  if ((asked === g.away || asked === g.home) && countFor(asked)) showTeam(asked);
})();
