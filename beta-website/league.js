// SAMPLE data for the player and game pages. Everything here is made up.
// Each player's research data is built from their entry in PROPS (data.js), so their last
// eight games and their posted line agree with the Streak Board. The same seed always gives
// the same numbers. Replace this file with a real feed later.
window.LEAGUE = (function () {
  const seeded = (key) => {
    let h = 2166136261;
    for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const next = () => {
      h = (h + 0x6d2b79f5) | 0;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 4; i++) h = (h + Math.floor(next() * 1e9)) | 0; // mixes similar keys apart
    return next;
  };
  const pick = (rand, list) => list[Math.floor(rand() * list.length)];
  const between = (rand, low, high) => low + Math.floor(rand() * (high - low + 1));
  const TEAMS = Object.keys(TEAM_COLORS);

  // Every player shares the same calendar. The last eight dates match GAME_DATES in data.js.
  const DATES = ["3/12", "3/14", "3/15", "3/19", "3/22", "3/24", "3/27", "3/28", "4/1", "4/3", "4/5", "4/6", "4/9", "4/10", "4/13", "4/15",
    "10/20", "10/22", "10/24", "10/26", "10/28", "10/30", "11/1", "11/3"];
  const SEASON_SPLIT = 16; // the first 16 games are 2025-26, the rest 2026-27
  const LATER_DATES = ["11/6", "11/8", "11/10", "11/12", "11/14"];
  const dayOf = (date) => { // every sample date falls in 2026
    const [month, day] = date.split("/").map(Number);
    return new Date(2026, month - 1, day).getTime();
  };

  const STAT_NAMES = {
    PRA: { label: "Pts + Reb + Ast", parts: ["pts", "reb", "ast"], moves: true },
    PTS: { label: "Points", parts: ["pts"], moves: true },
    REB: { label: "Rebounds", parts: ["reb"] },
    AST: { label: "Assists", parts: ["ast"] },
    TPM: { label: "3-pointers made", parts: ["tpm"] },
    PA: { label: "Pts + Ast", parts: ["pts", "ast"], moves: true },
    PR: { label: "Pts + Reb", parts: ["pts", "reb"], moves: true },
  };
  const MARKET_STAT = { PTS: "PTS", REB: "REB", AST: "AST", "3PM": "TPM", PRA: "PRA" };
  const POSITIONS = {
    PG: { plural: "point guards", min: 34, pts: 20, reb: 4, ast: 8, tpm: 2.4, usg: 27 },
    SG: { plural: "shooting guards", min: 33, pts: 20, reb: 4, ast: 4, tpm: 3, usg: 26 },
    SF: { plural: "small forwards", min: 33, pts: 18, reb: 6, ast: 3.5, tpm: 2, usg: 24 },
    PF: { plural: "power forwards", min: 31, pts: 17, reb: 9, ast: 3, tpm: 1.2, usg: 23 },
    C: { plural: "centers", min: 30, pts: 15, reb: 11, ast: 2.5, tpm: 0.5, usg: 22 },
  };

  // Marcus Vale's numbers are written out by hand. Other players are generated to fit their props.
  // date, opponent, home?, win?, minutes, rebounds, assists, 3s made, FG made, FG tried, FT made, FT tried, usage %
  const MARCUS_RAW = [
    ["3/12", "PHX", 0, 0, 35, 4, 7, 2, 8, 19, 4, 4, 27], ["3/14", "LAL", 1, 1, 33, 5, 9, 3, 10, 18, 5, 6, 29],
    ["3/15", "MIN", 0, 1, 36, 7, 6, 1, 7, 17, 4, 5, 25], ["3/19", "SAS", 1, 1, 31, 3, 11, 2, 9, 16, 4, 4, 26],
    ["3/22", "DAL", 0, 0, 37, 6, 5, 4, 11, 23, 5, 6, 32], ["3/24", "UTA", 1, 1, 29, 2, 8, 1, 6, 13, 4, 5, 22],
    ["3/27", "PHX", 1, 1, 34, 5, 8, 3, 10, 20, 4, 4, 28], ["3/28", "LAC", 0, 0, 38, 8, 6, 2, 8, 21, 5, 6, 30],
    ["4/1", "MEM", 0, 1, 33, 4, 7, 3, 9, 17, 5, 5, 27], ["4/3", "LAL", 0, 0, 36, 5, 10, 1, 8, 20, 4, 4, 28],
    ["4/5", "SAC", 1, 1, 32, 3, 6, 4, 10, 18, 5, 5, 29], ["4/6", "MIN", 1, 1, 34, 6, 9, 2, 9, 19, 5, 6, 27],
    ["4/9", "HOU", 1, 0, 35, 7, 7, 0, 8, 18, 4, 5, 26], ["4/10", "PHX", 0, 1, 36, 4, 6, 5, 12, 22, 5, 5, 33],
    ["4/13", "OKC", 0, 0, 37, 5, 8, 2, 9, 22, 4, 5, 29], ["4/15", "SAS", 0, 1, 30, 4, 12, 1, 7, 14, 3, 3, 23],
    ["10/20", "UTA", 1, 1, 34, 5, 8, 3, 10, 19, 4, 5, 28], ["10/22", "LAC", 0, 0, 36, 4, 6, 2, 12, 24, 5, 6, 31],
    ["10/24", "SAC", 0, 1, 33, 6, 9, 2, 9, 17, 6, 7, 27], ["10/26", "POR", 1, 1, 35, 5, 7, 4, 12, 21, 5, 5, 32],
    ["10/28", "HOU", 0, 0, 37, 7, 5, 1, 11, 23, 6, 8, 30], ["10/30", "MEM", 1, 1, 32, 3, 10, 3, 9, 18, 4, 4, 26],
    ["11/1", "NOP", 0, 1, 38, 6, 7, 5, 13, 24, 7, 8, 35], ["11/3", "OKC", 1, 0, 36, 4, 8, 2, 11, 22, 6, 7, 29],
  ];
  const MARCUS = {
    lines: { PRA: 38.5, PTS: 24.5, REB: 4.5, AST: 7.5, TPM: 2.5, PA: 33.5, PR: 30.5 },
    mateOut: new Set(["3/22", "3/28", "4/6", "4/13", "10/28", "11/1"]),
    games: [
      // shift moves the posted line for this game; price nudges its odds
      { date: "11/4", opp: "PHX", where: "vs", shift: 0, price: 0, backToBack: true }, { date: "11/6", opp: "LAL", where: "@", shift: 1, price: 0.015 },
      { date: "11/8", opp: "MIN", where: "vs", shift: -2, price: -0.02 }, { date: "11/10", opp: "UTA", where: "@", shift: 2, price: 0.01 },
      { date: "11/12", opp: "SAS", where: "vs", shift: -1, price: -0.01 }, { date: "11/14", opp: "DAL", where: "@", shift: 1, price: 0.02 },
    ],
    // Allowed to point guards per game, and how each opponent ranks (1st is the toughest).
    defense: {
      PHX: { pts: [25.8, 27], reb: [5.1, 24], ast: [8.4, 26], tpm: [3.3, 25] },
      LAL: { pts: [24.6, 22], reb: [4.9, 19], ast: [7.9, 21], tpm: [2.9, 16] },
      MIN: { pts: [19.7, 4], reb: [4.2, 6], ast: [6.3, 3], tpm: [2.1, 2] },
      UTA: { pts: [26.9, 29], reb: [5.4, 28], ast: [8.8, 30], tpm: [3.5, 29] },
      SAS: { pts: [21.8, 11], reb: [4.5, 12], ast: [7.0, 9], tpm: [2.5, 8] },
      DAL: { pts: [23.5, 18], reb: [4.8, 15], ast: [7.5, 17], tpm: [2.8, 14] },
    },
    news: [["2026-11-04", "Today", "Off the injury report after sitting out Monday's practice for rest."], ["2026-11-01", "Nov 1", "Scored a season-high 38 at New Orleans and took 24 shots."]],
    lineup: [["Marcus Vale", "PG"], ["Dion Faulk", "SG"], ["Terrence Yates", "SF"], ["Owen Rask", "PF"], ["Bram Coyle", "C"]],
  };

  const FIRST_NAMES = ["Amari", "Bastien", "Calder", "Darius", "Emeka", "Felix", "Gideon", "Hollis", "Idris", "Jarrett", "Kellan", "Lamar", "Mateo", "Nolan", "Orin", "Pryce", "Quincy", "Rowan", "Silas", "Tariq", "Uriel", "Vaughn", "Wes", "Xavi", "Yusuf", "Zane"];
  const LAST_NAMES = ["Aldane", "Barlowe", "Corvin", "Dresden", "Ellery", "Fontaine", "Garrick", "Hallam", "Ibarra", "Jessup", "Kessler", "Lindqvist", "Merrow", "Nakata", "Osgood", "Pruitt", "Quarles", "Rennick", "Sallow", "Thorne", "Ulrich", "Vasko", "Wexler", "Yarrow", "Zeller"];
  const madeUpName = (rand) => `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;

  const FIXED_INJURIES = {
    DEN: [["Reggie Holt", "C", "Out"], ["Jalen Oster", "SG", "Questionable"]],
    PHX: [["Tyrell Banks", "SG", "Out"]],
    LAL: [["Cal Whitmore", "PF", "Questionable"]],
    MIN: [],
    UTA: [["Andre Solis", "C", "Out"], ["Nico Vance", "PG", "Questionable"]],
    SAS: [],
    DAL: [["Marlon Teague", "SF", "Questionable"]],
  };
  const injuries = (team) => {
    if (FIXED_INJURIES[team]) return FIXED_INJURIES[team];
    const rand = seeded(`injury-${team}`);
    const list = [];
    if (rand() < 0.7) list.push([madeUpName(rand), pick(rand, ["SG", "SF", "PF", "C"]), "Out"]);
    if (rand() < 0.5) list.push([madeUpName(rand), pick(rand, ["PG", "SF", "C"]), "Questionable"]);
    return list;
  };

  // One result per matchup and date, so two players see the same game the same way.
  const pairKey = (a, b) => [a, b].sort().join("-");
  function result(team, opp, date) {
    const rand = seeded(`${pairKey(team, opp)}-${date}`);
    const [first, second] = [team, opp].sort();
    const winner = rand() < 0.5 ? first : second;
    const home = rand() < 0.5 ? first : second;
    return { winner, home, win: winner === team, atHome: home === team, score: [between(rand, 108, 128), between(rand, 96, 107)] };
  }

  function round(n) { return Math.max(0, Math.round(n)); }

  function generateLog(raw, tonightOpp, mateName) {
    const rand = seeded(`log-${raw.player}`);
    const base = { ...POSITIONS[raw.pos] };
    const recent = raw.games.reduce((a, b) => a + b, 0) / raw.games.length;
    const market = MARKET_STAT[raw.market];
    if (market === "PTS") base.pts = recent;
    if (market === "REB") base.reb = recent;
    if (market === "AST") base.ast = recent;
    if (market === "TPM") base.tpm = recent;
    if (market === "PRA") {
      const scale = recent / (base.pts + base.reb + base.ast);
      base.pts *= scale; base.reb *= scale; base.ast *= scale;
    }
    // Last season's games sit nearer the line, so a hot streak doesn't read as a whole career.
    const earlierTarget = (raw.line + recent) / 2;
    const mateSeed = seeded(`mate-${raw.team}`);
    const mateOut = new Set(mateName ? DATES.filter(() => mateSeed() < 0.25) : []);
    const meetingRand = seeded(`meetings-${pairKey(raw.team, tonightOpp)}`);
    const meetings = new Set();
    while (meetings.size < 3) meetings.add(between(meetingRand, 0, SEASON_SPLIT - 1));

    return DATES.map((date, i) => {
      const recentGame = i >= SEASON_SPLIT;
      const opp = recentGame ? raw.opps[i - SEASON_SPLIT]
        : meetings.has(i) ? tonightOpp : pick(rand, TEAMS.filter((t) => t !== raw.team));
      const noise = (spread) => (rand() + rand() - 1) * spread;
      const shiftTo = (key) => (market === key ? earlierTarget : base[key]);
      let reb = round(shiftTo("REB" === market ? "reb" : "reb") + noise(base.reb * 0.5 + 1));
      let ast = round(shiftTo("ast") + noise(base.ast * 0.5 + 1));
      let tpm = round(base.tpm + noise(base.tpm * 0.7 + 0.8));
      let pts = round(base.pts + noise(base.pts * 0.35));
      if (market === "REB") reb = recentGame ? raw.games[i - SEASON_SPLIT] : round(earlierTarget + noise(4));
      if (market === "AST") ast = recentGame ? raw.games[i - SEASON_SPLIT] : round(earlierTarget + noise(4));
      if (market === "TPM") tpm = recentGame ? raw.games[i - SEASON_SPLIT] : round(earlierTarget + noise(2.5));
      if (market === "PTS") pts = recentGame ? raw.games[i - SEASON_SPLIT] : round(earlierTarget + noise(8));
      if (market === "PRA") {
        const total = recentGame ? raw.games[i - SEASON_SPLIT] : round(earlierTarget + noise(10));
        pts = Math.max(0, total - reb - ast);
        if (total < reb + ast) { reb = Math.floor(total / 3); ast = Math.floor(total / 6); pts = total - reb - ast; }
      }
      // Points come from makes: two for every field goal, one more for each three, plus free throws.
      if (market !== "TPM") tpm = Math.min(tpm, Math.floor(pts / 3));
      if (market === "TPM") pts = Math.max(pts, tpm * 3);
      let ftm = Math.min(round(pts * 0.17 + noise(2)), pts - tpm * 3);
      let fgm = (pts - tpm - ftm) / 2;
      if (!Number.isInteger(fgm)) { ftm += ftm > 0 ? -1 : 1; fgm = (pts - tpm - ftm) / 2; }
      const fga = fgm + round(fgm * 0.9 + rand() * 3);
      const fta = ftm + between(rand, 0, 2);
      const { win, atHome } = result(raw.team, opp, date);
      return { date, opp, home: atHome, win, min: round(base.min + noise(6)), reb, ast, tpm, fgm, fga, ftm, fta, usg: round(base.usg + noise(6)), mateOut: mateOut.has(date) };
    });
  }

  const statValue = (g, stat) => STAT_NAMES[stat].parts.reduce((sum, part) => sum + g[part], 0);

  function buildPlayer(raw) {
    const id = raw.player.replace(/\W/g, "");
    const isMarcus = id === "MarcusVale";
    const tonight = GAMES_TODAY.find((g) => g.home === raw.team || g.away === raw.team);
    const atHome = tonight.home === raw.team;
    const opp = atHome ? tonight.away : tonight.home;
    const mateEntry = injuries(raw.team).find(([, , status]) => status === "Out");
    const mate = mateEntry ? mateEntry[0] : null;
    const rand = seeded(`player-${raw.player}`);

    const rows = isMarcus
      ? MARCUS_RAW.map(([date, o, home, win, min, reb, ast, tpm, fgm, fga, ftm, fta, usg]) => ({ date, opp: o, home: !!home, win: !!win, min, reb, ast, tpm, fgm, fga, ftm, fta, usg, mateOut: MARCUS.mateOut.has(date) }))
      : generateLog(raw, opp, mate);
    const log = rows.map((g, i) => ({
      ...g,
      restDays: i === 0 ? 3 : Math.round((dayOf(g.date) - dayOf(rows[i - 1].date)) / 86400000),
      pts: g.fgm * 2 + g.tpm + g.ftm,
      season: i < SEASON_SPLIT ? "25-26" : "26-27",
    }));

    const marketStat = MARKET_STAT[raw.market];
    const stats = {};
    Object.entries(STAT_NAMES).forEach(([key, s]) => {
      const last20 = log.slice(-20).reduce((sum, g) => sum + statValue(g, key), 0) / 20;
      const line = isMarcus ? MARCUS.lines[key] : key === marketStat ? raw.line : Math.floor(last20) + 0.5;
      stats[key] = { ...s, line };
    });

    const later = LATER_DATES.map((date, i) => ({
      date, opp: pick(rand, TEAMS.filter((t) => t !== raw.team)), where: i % 2 ? "vs" : "@",
      shift: pick(rand, [-2, -1, 1, 2]), price: pick(rand, [-0.02, -0.01, 0.01, 0.015, 0.02]),
    }));
    const games = isMarcus ? MARCUS.games
      : [{ date: "11/4", opp, where: atHome ? "vs" : "@", shift: 0, price: 0, backToBack: rand() < 0.25 }, ...later];

    // Best price at the posted line matches the Streak Board's odds for this player's main prop.
    const oddsChance = raw.odds > 0 ? 100 / (raw.odds + 100) : -raw.odds / (-raw.odds + 100);
    const overAtPost = raw.dir === "Over" ? oddsChance + 0.012 : 1.06 - oddsChance - 0.012;

    const best = log.slice(-8).reduce((top, g) => (statValue(g, marketStat) > statValue(top, marketStat) ? g : top));
    const noun = { PTS: "points", REB: "rebounds", AST: "assists", TPM: "threes", PRA: "points, rebounds and assists" }[marketStat];
    const [month, day] = best.date.split("/");
    const bestDate = `${["Oct", "Nov"][month - 10]} ${day}`;
    const news = isMarcus ? MARCUS.news : [
      ["2026-11-04", "Today", pick(rand, ["Went through a full practice and is expected to start.", "Off the injury report and listed as a starter.", "Took part in shootaround with no restrictions."])],
      [`2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, bestDate, `Finished with ${statValue(best, marketStat)} ${noun} against ${best.opp}.`],
    ];
    const lineup = isMarcus ? MARCUS.lineup
      : ["PG", "SG", "SF", "PF", "C"].map((pos) => [pos === raw.pos ? raw.player : madeUpName(rand), pos]);

    return {
      id, name: raw.player, team: raw.team, pos: raw.pos, posPlural: POSITIONS[raw.pos].plural,
      initials: raw.player.split(" ").map((w) => w[0]).join(""),
      log, stats, games, news, lineup,
      mate, mateShort: mate ? mate.split(" ").slice(-1)[0] : "",
      defaultStat: isMarcus ? "PRA" : marketStat, defaultSide: isMarcus ? "Over" : raw.dir,
      marketStat, marketDir: raw.dir, marketBias: overAtPost - 0.53,
      defenseFixed: isMarcus ? MARCUS.defense : null,
    };
  }

  const PLAYERS = PROPS.map(buildPlayer);
  const player = (id) => PLAYERS.find((p) => p.id === id) || null;

  function defense(p, opp) {
    if (p.defenseFixed && p.defenseFixed[opp]) return p.defenseFixed[opp];
    const base = POSITIONS[p.pos];
    const out = {};
    ["pts", "reb", "ast", "tpm"].forEach((part) => {
      const rank = between(seeded(`defense-${opp}-${part}`), 1, 30);
      out[part] = [Number((base[part] * (0.82 + (rank / 30) * 0.36)).toFixed(1)), rank];
    });
    return out;
  }

  const BOOKS = ["Book A", "Book B", "Book C", "Book D"]; // placeholder names: real sportsbook names stay out of the public repo
  const BOOK_OFFSETS = [-0.012, 0, 0.014, 0.006]; // best price to worst; which book gets which depends on the game, line and side
  const payout = (o) => (o > 0 ? o : 10000 / -o);
  const breakeven = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100)) * 100;
  const postedLine = (p, stat, gameIndex) => p.stats[stat].line + (p.stats[stat].moves ? p.games[gameIndex].shift : 0);

  // Sample odds that move as the line moves, so the stepper feels real.
  function odds(p, gameIndex, stat, side, line, book) {
    const turn = gameIndex + Math.floor(line) + (side === "Over" ? 0 : 1);
    const offset = BOOK_OFFSETS[(book + turn) % BOOK_OFFSETS.length];
    const step = p.stats[stat].parts.length > 1 ? 0.03 : 0.05;
    const bias = stat === p.marketStat ? p.marketBias : 0;
    const overChance = 0.53 + bias + p.games[gameIndex].price + (postedLine(p, stat, gameIndex) - line) * step;
    const raw = side === "Over" ? overChance : 1.06 - overChance;
    const chance = Math.min(0.93, Math.max(0.07, raw + offset));
    const price = chance >= 0.5 ? -Math.round((chance / (1 - chance)) * 100) : Math.round(((1 - chance) / chance) * 100);
    return price === -100 ? 100 : price; // even money always reads +100
  }
  // Whether a book offers this player's stat in this game. At least one book always does.
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function offers(p, gameIndex, stat, book) {
    const seed = hash(`${p.id}|${stat}|${gameIndex}`);
    return book === seed % BOOKS.length || hash(`${seed}|${book}`) % 100 >= 18;
  }
  const bestPrice = (p, gameIndex, stat, side, line) => BOOKS.map((name, book) => ({ name, book, price: odds(p, gameIndex, stat, side, line, book) }))
    .filter((o) => offers(p, gameIndex, stat, o.book))
    .reduce((top, o) => (payout(o.price) > payout(top.price) ? o : top));

  // Tonight's posted line for one stat, summed up the way the player page's default view shows it.
  function propTonight(p, stat, side) {
    const line = postedLine(p, stat, 0);
    const hit = (g) => (side === "Over" ? statValue(g, stat) > line : statValue(g, stat) < line);
    const games = p.log.slice(-20);
    const hits = games.filter(hit).length;
    const price = bestPrice(p, 0, stat, side, line);
    const need = breakeven(price.price);
    const pct = (hits / games.length) * 100;
    let streak = 0;
    for (let i = p.log.length - 1; i >= 0 && hit(p.log[i]); i--) streak++;
    return { stat, side, line, label: p.stats[stat].label, hits, total: games.length, pct, price, need, gap: pct - need, streak };
  }

  const gameId = (g) => `${g.away}-${g.home}`;
  const game = (id) => GAMES_TODAY.find((g) => gameId(g) === id) || null;
  const playersOn = (team) => PLAYERS.filter((p) => p.team === team);

  // Record and team numbers. A team with a tracked player takes its record from that player's games.
  function teamStats(team) {
    const rand = seeded(`team-${team}`);
    const [tracked] = playersOn(team);
    const wins = tracked ? tracked.log.slice(-8).filter((g) => g.win).length : between(rand, 2, 6);
    return {
      wins, losses: 8 - wins,
      points: 104 + rand() * 18, allowed: 104 + rand() * 16, pace: 96 + rand() * 7,
      defenseRank: between(seeded(`defense-${team}-pts`), 1, 30),
    };
  }

  // Newest first, from the games of whichever players are tracked in this matchup.
  function meetings(g) {
    const seen = new Map();
    [g.away, g.home].forEach((team) => {
      const other = team === g.away ? g.home : g.away;
      playersOn(team).forEach((p) => p.log.forEach((row) => {
        if (row.opp !== other || seen.has(row.date)) return;
        const rand = seeded(`${pairKey(team, other)}-${row.date}-score`);
        const high = between(rand, 108, 128);
        const low = high - between(rand, 2, 19);
        seen.set(row.date, {
          date: row.date, time: dayOf(row.date),
          winner: row.win ? team : other, loser: row.win ? other : team, high, low,
          home: row.home ? team : other,
        });
      }));
    });
    return [...seen.values()].sort((a, b) => b.time - a.time);
  }

  return { PLAYERS, BOOKS, player, injuries, defense, odds, offers, bestPrice, breakeven, payout, propTonight, game, gameId, playersOn, teamStats, meetings, MARKET_STAT };
})();
