// LineHunter - netlify/edge-functions/password-gate.js
// Private soft launch: the WHOLE site (pages, assets and /api/bdl) sits behind one branded password page.
//
//   - No valid cookie: pages get the password page (status 401); /api/* and other files get a plain 401. Nothing is served.
//   - The form posts to /__gate. A correct password (checked here, on the server, against SITE_PASSWORD) sets a signed,
//     HttpOnly cookie that lasts 30 days and redirects to the page the visitor wanted. A wrong one shows the page again with a message.
//   - The cookie is "<expiry>.<signature>"; the signature is an HMAC-SHA256 made with SITE_COOKIE_SECRET, so it cannot be forged.
//   - Environment variables (never in the code): SITE_PASSWORD, SITE_COOKIE_SECRET. If either is missing the site stays locked.
// Registered in netlify.toml (the "PRIVATE SOFT LAUNCH" block). For the public launch, delete that block.

const COOKIE_NAME = "lh_gate";
const COOKIE_DAYS = 30;
const GATE_PATH = "/__gate";
// Files the password page itself needs (favicon) and robots.txt (so crawlers can read "Disallow: /") are not gated.
const PUBLIC_FILES = ["/robots.txt", "/assets/img/lh-mark.svg", "/assets/img/lh-mark-32.png", "/assets/img/lh-mark-180.png"];

const encoder = new TextEncoder();

// ---------- small crypto helpers ----------

const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sign(text, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

// Compare two strings in constant time (hash both, then compare every byte), so the answer time reveals nothing.
async function sameText(a, b) {
  const [hashA, hashB] = await Promise.all([a, b].map(async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))));
  let difference = 0;
  for (let i = 0; i < hashA.length; i += 1) difference |= hashA[i] ^ hashB[i];
  return difference === 0;
}

async function makeCookieValue(secret) {
  const expires = Math.floor(Date.now() / 1000) + COOKIE_DAYS * 86400;
  return `${expires}.${await sign(String(expires), secret)}`;
}

async function cookieIsValid(request, secret) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.split(/;\s*/).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return false;
  const [expires, signature] = match.slice(COOKIE_NAME.length + 1).split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000) return false;
  return sameText(signature, await sign(expires, secret));
}

// ---------- the password page ----------

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

// Only paths on this site: must start with one slash (not "//host"), and never the gate itself.
function safeNext(value) {
  return typeof value === "string" && /^\/(?![\/\\])/.test(value) && !value.startsWith(GATE_PATH) ? value : "/";
}

const LOGO = `<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 924 160" role="img" aria-label="LineHunter">
  <defs><clipPath id="tile"><rect width="1000" height="1000" rx="200"/></clipPath></defs>
  <g transform="scale(0.16)" clip-path="url(#tile)"><rect width="1000" height="1000" fill="#052350"/><path fill="#2107a9" d="M125.1,528.0 197.5,255.0 327.5,255.0 1727.5,1655.0 1655.1,1928.0 1525.1,1928ZM125.1,528.0 131.7,503.0 433.1,503.0 1833.1,1903.0 1825.5,1928.0 1525.1,1928ZM341.5,411.0 507.5,411.0 572.4,474.0 1972.4,1874.0 1960.6,1907.0 1833.5,1903ZM368,745.0 432.1,503.0 561.7,503.0 1961.7,1903.0 1897.5,2145.0 1768,2145ZM520.9,653.0 527.5,628.0 705.4,628.0 2105.4,2028.0 2098.8,2053.0 1920.9,2053ZM673.4,745.0 745.5,473.0 874.5,473.0 2274.5,1873.0 2202.4,2145.0 2073.4,2145Z"/><path fill="#d2e0f8" d="M197.5,255.0 327.5,255.0 255.1,528.0 125.1,528ZM131.7,503.0 433.1,503.0 425.5,528.0 125.1,528ZM341.5,411.0 507.5,411.0 572.4,474.0 560.6,507.0 433.5,503ZM433.5,503.0 561.7,503.0 497.5,745.0 368,745.0 432.1,503ZM527.5,628.0 705.4,628.0 698.8,653.0 520.9,653ZM745.5,473.0 874.5,473.0 802.4,745.0 673.4,745Z"/></g>
  <path fill="#d8dff5" d="M223.9,35.0 243.7,35.0 219.8,125.0 200.0,125.0ZM203.3,112.4 259.1,112.4 255.8,125.0 200.0,125.0ZM293.2,35.0 313.0,35.0 289.1,125.0 269.3,125.0ZM326.5,35.0 346.3,35.0 322.4,125.0 302.6,125.0ZM369.7,35.0 389.5,35.0 365.6,125.0 345.8,125.0ZM326.5,35.0 346.3,35.0 365.6,125.0 345.8,125.0ZM403.0,35.0 422.8,35.0 398.9,125.0 379.1,125.0ZM403.0,35.0 457.0,35.0 453.6,47.6 399.6,47.6ZM392.7,73.7 439.5,73.7 436.2,86.3 389.4,86.3ZM382.4,112.4 436.4,112.4 433.1,125.0 379.1,125.0ZM483.1,35.0 502.9,35.0 479.0,125.0 459.2,125.0ZM526.3,35.0 546.1,35.0 522.2,125.0 502.4,125.0ZM491.7,77.3 515.1,77.3 513.6,82.7 490.2,82.7ZM559.6,35.0 579.4,35.0 555.5,125.0 535.7,125.0ZM602.8,35.0 622.6,35.0 598.7,125.0 578.9,125.0ZM539.0,112.4 602.0,112.4 598.7,125.0 535.7,125.0ZM636.1,35.0 655.9,35.0 632.0,125.0 612.2,125.0ZM679.3,35.0 699.1,35.0 675.2,125.0 655.4,125.0ZM636.1,35.0 655.9,35.0 675.2,125.0 655.4,125.0ZM712.6,35.0 772.0,35.0 768.6,47.6 709.2,47.6ZM732.4,35.0 752.2,35.0 728.3,125.0 708.5,125.0ZM785.5,35.0 805.3,35.0 781.4,125.0 761.6,125.0ZM785.5,35.0 839.5,35.0 836.1,47.6 782.1,47.6ZM775.2,73.7 822.0,73.7 818.7,86.3 771.9,86.3ZM764.9,112.4 818.9,112.4 815.6,125.0 761.6,125.0ZM853.0,35.0 872.8,35.0 848.9,125.0 829.1,125.0ZM853.0,35.0 908.8,35.0 905.4,47.6 849.6,47.6ZM892.6,35.0 912.4,35.0 899.0,85.4 879.2,85.4ZM842.9,72.8 902.3,72.8 899.0,85.4 839.6,85.4ZM864.8,85.4 884.6,85.4 890.3,125.0 870.5,125.0Z"/>
</svg>`;

// ---------- decorative background rows (hardcoded samples: the page loads no real data) ----------

// City nicknames (the same words as the city watermarks in js/data/teams.js), split between the two city rows.
const CITIES_A = ["PHILLY", "MOTOR CITY", "VICE CITY", "THE BAY", "BIG APPLE", "H-TOWN", "THE LAND", "MILE HIGH", "NOLA", "THE 6IX", "SACTOWN", "BUZZ CITY", "THE VALLEY", "PDX", "INDY"];
const CITIES_B = ["CHI-TOWN", "GRIND CITY", "CREAM CITY", "TWIN CITIES", "HOLLYWOOD", "THE DISTRICT", "THE A", "BOSTON", "SATX", "OKC", "ORLANDO", "MAVS", "CLIPPERS", "BKN", "UTA"];
const OVER_SAMPLES = ["OVER 24.5 POINTS · 9/10", "OVER 8.5 REBOUNDS · 8/10", "OVER 6.5 ASSISTS · 7/10", "OVER 2.5 THREES MADE · 9/10", "OVER 35.5 PRA · 8/10", "OVER 18.5 POINTS · 10/10", "OVER 11.5 REBOUNDS · 7/10", "OVER 9.5 ASSISTS · 8/10"];
const UNDER_SAMPLES = ["UNDER 10.5 POINTS · 5/5", "UNDER 4.5 REBOUNDS · 4/5", "UNDER 3.5 ASSISTS · 5/5", "UNDER 1.5 THREES MADE · 4/5", "UNDER 22.5 PRA · 5/5", "UNDER 12.5 POINTS · 4/5", "UNDER 5.5 REBOUNDS · 5/5", "UNDER 2.5 ASSISTS · 4/5"];

// One row = a track holding the same group twice; sliding the track by exactly one group (-50%) loops with no gap or jump.
function marqueeRow(items, className) {
  const group = `<span class="group">${items.map((text) => `<span class="item">${text}</span>`).join("")}</span>`;
  return `<div class="row ${className}"><div class="track">${group}${group}</div></div>`;
}

function gatePage({ next, error }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>LineHunter · Enter password to start the hunt</title>
  <link rel="icon" type="image/svg+xml" href="/assets/img/lh-mark.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/lh-mark-32.png">
  <link rel="apple-touch-icon" href="/assets/img/lh-mark-180.png">
  <link rel="preconnect" href="https://api.fontshare.com">
  <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
  <link href="https://api.fontshare.com/v2/css?f[]=clash-display@600&display=swap" rel="stylesheet">
  <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; min-height: 100dvh;
      padding: 1.5rem; padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
      background: radial-gradient(50rem 26rem at 70% 20%, rgba(109, 102, 240, 0.22), transparent 60%), #060a16; color: #d8dff5;
      font-family: "Satoshi", system-ui, sans-serif;
    }
    main { width: 100%; max-width: 20rem; text-align: center; }
    /* Decorative rows: two at the top, two at the bottom, the middle stays clear. Hidden on short screens (phones on their side). */
    .rows { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; user-select: none; }
    .row { position: absolute; left: 0; right: 0; overflow: hidden; white-space: nowrap; }
    .row .track { display: flex; width: max-content; will-change: transform; animation-timing-function: linear; animation-iteration-count: infinite; }
    .row .group { display: flex; flex: none; }
    .row .item { flex: none; padding-right: 3rem; }
    .row .item::after { content: "·"; padding-left: 3rem; }
    .row--city { font-family: "Clash Display", sans-serif; font-weight: 600; letter-spacing: 0; font-size: clamp(2.6rem, 8vw, 4.5rem); line-height: 1.1; text-transform: uppercase; color: rgba(154, 147, 255, 0.08); }
    .row--over, .row--under { font-family: "Satoshi", sans-serif; font-weight: 500; font-size: clamp(0.8rem, 2.2vw, 1.05rem); letter-spacing: 0.04em; line-height: 1.6; }
    .row--over { color: rgba(70, 169, 143, 0.16); }
    .row--under { color: rgba(189, 101, 112, 0.16); }
    .row--1 { top: 0.75rem; }
    .row--2 { top: calc(0.75rem + clamp(2.6rem, 8vw, 4.5rem) * 1.1 + 0.5rem); }
    .row--4 { bottom: calc(0.75rem + env(safe-area-inset-bottom)); }
    .row--3 { bottom: calc(0.75rem + env(safe-area-inset-bottom) + 1.7rem + 0.5rem); }
    .row--left .track  { animation-name: slide-left; }
    .row--right .track { animation-name: slide-right; }
    .row--1 .track { animation-duration: 52s; }
    .row--2 .track { animation-duration: 42s; }
    .row--3 .track { animation-duration: 48s; }
    .row--4 .track { animation-duration: 44s; }
    @keyframes slide-left  { from { transform: translateX(0); }    to { transform: translateX(-50%); } }
    @keyframes slide-right { from { transform: translateX(-50%); } to { transform: translateX(0); } }
    @media (prefers-reduced-motion: reduce) { .row .track { animation: none; } }
    @media (max-height: 560px) { .rows { display: none; } }
    main { position: relative; z-index: 1; }
    .logo { display: block; width: 100%; max-width: 15rem; height: auto; margin: 0 auto 2rem; }
    .label { margin: 0 0 1rem; font-family: "Satoshi", sans-serif; font-size: 0.875rem; color: #93a1cb; }
    input, button { width: 100%; padding: 0.8rem 1rem; border-radius: 8px; font: inherit; font-size: 1rem; /* 16px: no zoom on iPhone */ }
    input { border: 1px solid #1f2e5a; background: #0b1229; color: #d8dff5; outline: none; }
    input:focus-visible { border-color: #9a93ff; box-shadow: 0 0 0 3px rgba(154, 147, 255, 0.25); }
    input::placeholder { color: #93a1cb; }
    button { margin-top: 0.75rem; border: 0; background: #280ea1; color: #fff; font-weight: 700; cursor: pointer; }
    button:hover, button:focus-visible { background: #33139f; }
    .error { margin: 0.9rem 0 0; font-size: 0.9rem; color: #f2969f; }
  </style>
</head>
<body>
  <!-- Decorative only: hardcoded samples, no data is loaded before login -->
  <div class="rows" aria-hidden="true">
    ${marqueeRow(CITIES_A, "row--city row--1 row--left")}
    ${marqueeRow(OVER_SAMPLES, "row--over row--2 row--right")}
    ${marqueeRow(CITIES_B, "row--city row--3 row--right")}
    ${marqueeRow(UNDER_SAMPLES, "row--under row--4 row--left")}
  </div>
  <main>
    ${LOGO}
    <p class="label">Enter password to start the hunt</p>
    <form method="post" action="${GATE_PATH}">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required aria-label="Password">
      <button type="submit">Enter</button>
      ${error ? `<p class="error" role="alert">Wrong password, try again</p>` : ""}
    </form>
  </main>
</body>
</html>`;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function htmlResponse(options, status = 401) {
  return new Response(gatePage(options), { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

function plainResponse(status, text) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}

// ---------- the gate ----------

export default async (request, context) => {
  const url = new URL(request.url);
  const password = Netlify.env.get("SITE_PASSWORD");
  const secret = Netlify.env.get("SITE_COOKIE_SECRET");

  if (PUBLIC_FILES.includes(url.pathname)) return context.next();
  if (!password || !secret) return plainResponse(503, "Private preview is not configured yet."); // never open by mistake

  // The password form.
  if (url.pathname === GATE_PATH) {
    if (request.method !== "POST") return Response.redirect(new URL("/", url), 303);
    let form;
    try { form = await request.formData(); } catch (error) { form = new FormData(); }
    const next = safeNext(form.get("next"));
    const given = String(form.get("password") || "");

    if (await sameText(given, password)) {
      const secure = url.protocol === "https:" ? "; Secure" : ""; // plain http only happens on localhost
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          "Set-Cookie": `${COOKIE_NAME}=${await makeCookieValue(secret)}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`,
          ...NO_STORE,
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 700)); // slows down guessing
    return htmlResponse({ next, error: true });
  }

  // Everything else: a valid cookie lets the request through.
  if (await cookieIsValid(request, secret)) return context.next();

  // No cookie. Pages get the password page; the API and files get a plain 401.
  const wantsPage = request.method === "GET" && (request.headers.get("accept") || "").includes("text/html");
  if (wantsPage && !url.pathname.startsWith("/api/")) return htmlResponse({ next: url.pathname + url.search, error: false });
  return plainResponse(401, "Sign in required.");
};
