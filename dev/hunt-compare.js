// LineHunter - dev/hunt-compare.js
// Old vs new Hunt Score on the same slate (a console tool, not part of the site). Runs both engines' handlers directly with the
// key from .env, then prints one row per player + prop (the side the new engine prefers) and writes the same table to
// dev/hunt-compare.txt (gitignored).
//
//   git show <old commit>:netlify/functions/hunt.js > /tmp/hunt-old.js
//   node dev/hunt-compare.js [YYYY-MM-DD] [/tmp/hunt-old.js]

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
if (!process.env.BALLDONTLIE_API_KEY) {
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^BALLDONTLIE_API_KEY\s*=\s*"?([^"\n\r]+)"?/m);
  if (match) process.env.BALLDONTLIE_API_KEY = match[1].trim();
}
const date = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const oldPath = path.resolve(process.argv[3] || "/tmp/hunt-old.js");

async function run(file) {
  const started = Date.now();
  const answer = await require(file).handler({ httpMethod: "GET", queryStringParameters: { date } });
  const body = JSON.parse(answer.body);
  if (answer.statusCode !== 200) throw new Error(`${file}: ${body.error}`);
  return { body, ms: Date.now() - started };
}

(async () => {
  const fresh = await run(path.join(root, "netlify/functions/hunt.js"));
  const old = await run(oldPath);
  const oldScore = Object.fromEntries(old.body.props.map((p) => [`${p.playerId}-${p.stat}-${p.side}`, p.score]));

  // The side the new engine likes better, per player + prop.
  const best = {};
  fresh.body.props.forEach((p) => {
    const key = `${p.playerId}-${p.stat}`;
    if (!best[key] || p.score > best[key].score) best[key] = p;
  });
  const rows = Object.values(best).map((p) => ({ ...p, old: oldScore[`${p.playerId}-${p.stat}-${p.side}`] }));
  rows.sort((a, b) => b.score - a.score);

  const pad = (text, n) => String(text).padEnd(n).slice(0, n);
  const line = (p) => `${pad(p.player, 24)} ${pad(`${p.side === "over" ? "O" : "U"} ${p.line} ${p.stat.toUpperCase()}`, 14)} old ${pad(p.old ?? "-", 4)} new ${pad(p.score, 4)} ${pad(`${p.chance}%`, 5)} proj ${pad(`${p.projection.mean} (${p.projection.p10}-${p.projection.p90})`, 16)} ${p.factors.filter((f) => Math.abs(f.points) >= 1).map((f) => `${f.key} ${f.points > 0 ? "+" : ""}${f.points}`).join(", ")}`;

  const out = [];
  out.push(`Hunt Score old vs new · ${date} · ${rows.length} player props · new ${fresh.ms} ms, old ${old.ms} ms`);
  const diffs = rows.filter((p) => p.old !== undefined).map((p) => p.score - p.old);
  out.push(`Average change ${(diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1)).toFixed(1)} · average size of change ${(diffs.reduce((a, b) => a + Math.abs(b), 0) / (diffs.length || 1)).toFixed(1)}`);
  out.push(`65+ props: old ${old.body.props.filter((p) => p.score >= 65).length} · new ${fresh.body.props.filter((p) => p.score >= 65).length}`);
  out.push(`Old top 5: ${old.body.topHunts.map((p) => `${p.player} ${p.side} ${p.line} ${p.stat} ${p.score}`).join(" | ")}`);
  out.push(`New top 5: ${fresh.body.topHunts.map((p) => `${p.player} ${p.side} ${p.line} ${p.stat} ${p.score}`).join(" | ")}`);
  out.push("", "Top 20 by the new score:");
  rows.slice(0, 20).forEach((p) => out.push(line(p)));
  out.push("", "Old engine's top 10, scored by the new one:");
  [...old.body.props].sort((a, b) => b.score - a.score).slice(0, 10).forEach((o) => {
    const p = fresh.body.props.find((n) => n.playerId === o.playerId && n.stat === o.stat && n.side === o.side);
    if (p) out.push(line({ ...p, old: o.score }));
  });
  const george = fresh.body.props.filter((p) => /George/.test(p.player));
  if (george.length) {
    out.push("", "George:");
    george.forEach((p) => { out.push(line({ ...p, old: oldScore[`${p.playerId}-${p.stat}-${p.side}`] })); p.why.forEach((s) => out.push(`    ${s}`)); });
  }
  const text = out.join("\n");
  console.log(text);
  fs.writeFileSync(path.join(__dirname, "hunt-compare.txt"), `${text}\n`);
})().catch((error) => { console.error(error); process.exit(1); });
