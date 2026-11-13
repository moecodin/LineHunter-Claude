// Decides who sees what, before the page paints. Loaded first in <head> on every page.
// DESIGN PREVIEW ONLY: there are no real accounts and no password is ever stored or checked. The browser keeps
// the email you typed, your name and your hunts on this device. A real launch replaces this file with a server.
(function () {
  const SESSION = "lh-session";
  const GUEST = "lh-guest";
  const page = document.currentScript.dataset.page || "preview"; // signin, home, account or preview

  const safely = (fn, fallback) => { try { return fn(); } catch (err) { return fallback; } };

  function session() {
    for (const store of ["localStorage", "sessionStorage"]) {
      const saved = safely(() => JSON.parse(window[store].getItem(SESSION)), null);
      if (saved && saved.email) return saved;
    }
    return null;
  }
  const guestFlag = () => safely(() => sessionStorage.getItem(GUEST) === "1", false);

  // Only ever returns to a page on this site.
  function nextPage() {
    const next = new URLSearchParams(location.search).get("next") || "";
    return /^[\w-]+\.html([?#].*)?$/.test(next) ? next : "index.html";
  }

  function leave(url) {
    document.documentElement.style.display = "none";
    location.replace(url);
  }

  function route() {
    const signedIn = Boolean(session());
    const here = location.pathname.split("/").pop() || "index.html";
    const toSignIn = () => leave(`signin.html?next=${encodeURIComponent(here + location.search + location.hash)}`);
    if (page === "signin" && signedIn) return leave(nextPage());
    if (page === "home" && !signedIn && !guestFlag()) return toSignIn();
    if (page === "account" && !signedIn) return toSignIn();
    document.documentElement.classList.toggle("is-guest", !signedIn && page !== "signin");
  }
  route();
  // The Back button can bring back a saved copy of a page after signing out.
  window.addEventListener("pageshow", (e) => { if (e.persisted) route(); });

  const nameKey = (email) => `lh-name:${email.toLowerCase()}`;
  const huntsKey = (email) => `lh-hunts:${email.toLowerCase()}`;
  const prefsKey = (email) => `lh-prefs:${email.toLowerCase()}`;

  window.LH_AUTH = {
    page,
    nextPage,
    user() {
      const s = session();
      return s ? { email: s.email, name: safely(() => localStorage.getItem(nameKey(s.email)), "") || "" } : null;
    },
    // Stay signed in: survives closing the browser. Otherwise it ends with this tab. Returns false if storage is blocked.
    signIn(email, stay) {
      return safely(() => {
        (stay ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify({ email }));
        sessionStorage.removeItem(GUEST);
        return true;
      }, false);
    },
    signOut() {
      for (const store of ["localStorage", "sessionStorage"]) {
        safely(() => window[store].removeItem(SESSION));
      }
      safely(() => sessionStorage.removeItem(GUEST));
      location.replace("signin.html");
    },
    enterAsGuest() { safely(() => sessionStorage.setItem(GUEST, "1")); },
    setName(name) {
      const s = session();
      return Boolean(s) && safely(() => { localStorage.setItem(nameKey(s.email), name); return true; }, false);
    },
    hunts() {
      const s = session();
      return s ? safely(() => JSON.parse(localStorage.getItem(huntsKey(s.email))), null) || [] : [];
    },
    // Default book and connected books. Connecting is only a saved yes/no: no book login is ever asked for.
    prefs() {
      const s = session();
      const saved = s ? safely(() => JSON.parse(localStorage.getItem(prefsKey(s.email))), null) : null;
      return { book: "book-a", connected: [], ...saved };
    },
    savePrefs(next) {
      const s = session();
      return Boolean(s) && safely(() => { localStorage.setItem(prefsKey(s.email), JSON.stringify(next)); return true; }, false);
    },
    saveHunts(list) {
      const s = session();
      return Boolean(s) && safely(() => { localStorage.setItem(huntsKey(s.email), JSON.stringify(list)); return true; }, false);
    },
  };
})();
