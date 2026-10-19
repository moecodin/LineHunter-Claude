// LineHunter - netlify/edge-functions/password-gate.js
// Private soft launch: the WHOLE site (pages, assets and /api/bdl) asks for a username and password (HTTP Basic Auth).
// The credentials come from the environment variables SITE_USER and SITE_PASSWORD (set in Netlify, or in a local .env for
// `netlify dev`); they are never in the code. If either variable is missing, the site stays locked.
// Registered in netlify.toml (the "PRIVATE SOFT LAUNCH" block). For the public launch, delete that block.

const encoder = new TextEncoder();

// Compare two strings in constant time (hash both, then compare every byte), so the answer time reveals nothing.
async function sameText(a, b) {
  const [hashA, hashB] = await Promise.all([a, b].map(async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))));
  let difference = 0;
  for (let i = 0; i < hashA.length; i += 1) difference |= hashA[i] ^ hashB[i];
  return difference === 0;
}

function askForPassword(status = 401) {
  return new Response("Private preview. Sign in to continue.", {
    status,
    headers: {
      "WWW-Authenticate": 'Basic realm="LineHunter private preview", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default async (request, context) => {
  const user = Netlify.env.get("SITE_USER");
  const password = Netlify.env.get("SITE_PASSWORD");
  if (!user || !password) return askForPassword(401); // not configured: stay locked, never open

  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6).trim());          // "user:password"
      const split = decoded.indexOf(":");
      if (split > -1) {
        const [userOk, passwordOk] = await Promise.all([
          sameText(decoded.slice(0, split), user),
          sameText(decoded.slice(split + 1), password),
        ]);
        if (userOk && passwordOk) return context.next();
      }
    } catch (error) {
      // a malformed header is just "not signed in"
    }
  }
  return askForPassword(401);
};
