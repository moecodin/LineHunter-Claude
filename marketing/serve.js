// LineHunter marketing: a small local server for the screenshot kit (and the reel maker).
// Serves the site's files from the repo root and answers /api/bdl/* and /api/hunt by calling the site's own Netlify functions
// (netlify/functions/bdl.js and hunt.js) with the key from the repo's .env, the same way `netlify dev` does, but with no
// password gate in front. Local only (binds to 127.0.0.1). Run: node marketing/serve.js [port]   (default 8910)
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), PORT = +(process.argv[2] || process.env.PORT || 8910);
// .env -> process.env (KEY=value lines; nothing printed)
try { fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).forEach((l) => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch (e) { /* no .env */ }
const bdl = require(path.join(ROOT, "netlify/functions/bdl.js")).handler;
const hunt = require(path.join(ROOT, "netlify/functions/hunt.js")).handler;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain" };
async function callFn(fn, url) {
  const q = url.search.slice(1), qs = Object.fromEntries(new URLSearchParams(q));
  const r = await fn({ httpMethod: "GET", path: url.pathname, rawQuery: q, queryStringParameters: qs, headers: {} });
  return { status: r.statusCode || 200, headers: r.headers || {}, body: r.body || "" };
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/bdl") || url.pathname === "/api/hunt") {
      const r = await callFn(url.pathname === "/api/hunt" ? hunt : bdl, url);
      res.writeHead(r.status, { "Content-Type": "application/json", ...r.headers }); return res.end(r.body);
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || /[\\/]\.(env|git)/.test(file)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
}).listen(PORT, "127.0.0.1", () => console.log(`LineHunter marketing server: http://127.0.0.1:${PORT}/`));
