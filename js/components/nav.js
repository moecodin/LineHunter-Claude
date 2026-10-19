// True while the site is in Research mode (class on <body>, set before the page renders: see the script after <body>).
// Global on purpose: charts and tables check it when they draw.
function isResearchMode() {
  return document.body.classList.contains("research-mode");
}

// ---------- Logo: the LineHunter lockup (mark + letters), inlined so the letters follow the theme (fill = currentColor) ----------
// Art from assets/img/lh-lockup.svg. Every copy gets its own ids (an SVG id must be unique on the page). { shine: true } adds the
// page-load light sweep: a soft band inside the SVG, clipped to the mark and the letters, 3 sweeps of 1s with 1.5s between them.
// { color } sets the letter color on the SVG itself (the share pictures need it, because html2canvas does not inherit currentColor).
let lockupCount = 0;
function lhLockupHtml({ shine = false, color = "" } = {}) {
  const id = `lhl${++lockupCount}`;
  const style = color ? ` style="color: ${color}"` : "";
  const band = shine ? `
    <g clip-path="url(#${id}-shine)"><rect class="lh-logo-band" x="-200" y="-20" width="130" height="200" fill="url(#${id}-band)"/></g>` : "";
  return `<svg class="lh-lockup-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 924 160" aria-hidden="true" focusable="false"${style}>
    <defs>
      <clipPath id="${id}-tile"><rect width="1000" height="1000" rx="200"/></clipPath>
      <path id="${id}-letters" d="M223.9,35.0 243.7,35.0 219.8,125.0 200.0,125.0ZM203.3,112.4 259.1,112.4 255.8,125.0 200.0,125.0ZM293.2,35.0 313.0,35.0 289.1,125.0 269.3,125.0ZM326.5,35.0 346.3,35.0 322.4,125.0 302.6,125.0ZM369.7,35.0 389.5,35.0 365.6,125.0 345.8,125.0ZM326.5,35.0 346.3,35.0 365.6,125.0 345.8,125.0ZM403.0,35.0 422.8,35.0 398.9,125.0 379.1,125.0ZM403.0,35.0 457.0,35.0 453.6,47.6 399.6,47.6ZM392.7,73.7 439.5,73.7 436.2,86.3 389.4,86.3ZM382.4,112.4 436.4,112.4 433.1,125.0 379.1,125.0ZM483.1,35.0 502.9,35.0 479.0,125.0 459.2,125.0ZM526.3,35.0 546.1,35.0 522.2,125.0 502.4,125.0ZM491.7,77.3 515.1,77.3 513.6,82.7 490.2,82.7ZM559.6,35.0 579.4,35.0 555.5,125.0 535.7,125.0ZM602.8,35.0 622.6,35.0 598.7,125.0 578.9,125.0ZM539.0,112.4 602.0,112.4 598.7,125.0 535.7,125.0ZM636.1,35.0 655.9,35.0 632.0,125.0 612.2,125.0ZM679.3,35.0 699.1,35.0 675.2,125.0 655.4,125.0ZM636.1,35.0 655.9,35.0 675.2,125.0 655.4,125.0ZM712.6,35.0 772.0,35.0 768.6,47.6 709.2,47.6ZM732.4,35.0 752.2,35.0 728.3,125.0 708.5,125.0ZM785.5,35.0 805.3,35.0 781.4,125.0 761.6,125.0ZM785.5,35.0 839.5,35.0 836.1,47.6 782.1,47.6ZM775.2,73.7 822.0,73.7 818.7,86.3 771.9,86.3ZM764.9,112.4 818.9,112.4 815.6,125.0 761.6,125.0ZM853.0,35.0 872.8,35.0 848.9,125.0 829.1,125.0ZM853.0,35.0 908.8,35.0 905.4,47.6 849.6,47.6ZM892.6,35.0 912.4,35.0 899.0,85.4 879.2,85.4ZM842.9,72.8 902.3,72.8 899.0,85.4 839.6,85.4ZM864.8,85.4 884.6,85.4 890.3,125.0 870.5,125.0Z"/>
      <clipPath id="${id}-shine"><use href="#${id}-letters"/><rect width="160" height="160" rx="32"/></clipPath>
      <linearGradient id="${id}-band" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g transform="scale(0.16)" clip-path="url(#${id}-tile)"><rect width="1000" height="1000" fill="#052350"/><path fill="#2107a9" d="M125.1,528.0 197.5,255.0 327.5,255.0 1727.5,1655.0 1655.1,1928.0 1525.1,1928ZM125.1,528.0 131.7,503.0 433.1,503.0 1833.1,1903.0 1825.5,1928.0 1525.1,1928ZM341.5,411.0 507.5,411.0 572.4,474.0 1972.4,1874.0 1960.6,1907.0 1833.5,1903ZM368,745.0 432.1,503.0 561.7,503.0 1961.7,1903.0 1897.5,2145.0 1768,2145ZM520.9,653.0 527.5,628.0 705.4,628.0 2105.4,2028.0 2098.8,2053.0 1920.9,2053ZM673.4,745.0 745.5,473.0 874.5,473.0 2274.5,1873.0 2202.4,2145.0 2073.4,2145Z"/><path fill="#d2e0f8" d="M197.5,255.0 327.5,255.0 255.1,528.0 125.1,528ZM131.7,503.0 433.1,503.0 425.5,528.0 125.1,528ZM341.5,411.0 507.5,411.0 572.4,474.0 560.6,507.0 433.5,503ZM433.5,503.0 561.7,503.0 497.5,745.0 368,745.0 432.1,503ZM527.5,628.0 705.4,628.0 698.8,653.0 520.9,653ZM745.5,473.0 874.5,473.0 802.4,745.0 673.4,745Z"/></g>
    <use href="#${id}-letters" fill="currentColor"/>${band}
  </svg>`;
}
window.lhLockupHtml = lhLockupHtml;

(function () {
  const target = document.getElementById("site-nav");
  if (!target) return;

  // The Discord invite: the one place to change it. Every Discord link on the site gets this URL.
  const DISCORD_URL = "https://discord.gg/BYZfZhjfm";

  const currentPage = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const activePage = currentPage === "game.html" ? "schedule.html" : currentPage;

  // A page can hold the search bar itself: an empty <div id="lh-search-slot"></div> puts it there
  // (schedule.html: above Top Hit Rates). Without a slot it lives in the navbar.
  const slot = document.getElementById("lh-search-slot");
  const inPage = Boolean(slot);
  const searchMarkup = `
<div class="lh-search" id="lhSearch" role="search">
          <i class="bi bi-search lh-search-icon" aria-hidden="true"></i>
          <input type="search" id="lhSearchInput" class="lh-search-input" placeholder="Search players"
                 autocomplete="off" aria-label="Search players" aria-controls="lhSearchResults">
          <div class="lh-search-results" id="lhSearchResults" hidden></div>
        </div>
  `;

  // League switcher (NBA | NFL): pill tabs in the navbar on desktop, and at the top of the "More" sheet on phones.
  // NBA is active on every page except nfl.html. NFL is a "coming soon" page for now.
  const onNfl = currentPage === "nfl.html";
  const leagueLinks = `
    <a class="btn btn-ghost${onNfl ? "" : " active"}" href="schedule.html"${onNfl ? "" : ' aria-current="page"'}>NBA</a>
    <a class="btn btn-ghost${onNfl ? " active" : ""}" href="nfl.html"${onNfl ? ' aria-current="page"' : ""}>NFL <span class="lh-soon-tag">Soon</span></a>`;

  const navMarkup = `
    <nav class="navbar lh-navbar sticky-top mb-4">
      <div class="container-fluid lh-container px-3 px-lg-4">
        <a class="navbar-brand lh-brand" href="index.html" aria-label="LineHunter">${lhLockupHtml({ shine: true })}</a>
        <div class="btn-group btn-group-sm lh-window-toggle lh-league d-none d-md-inline-flex" role="group" aria-label="League">${leagueLinks}</div>
        ${inPage ? "" : searchMarkup}
        <div class="lh-mode-nav d-none d-md-flex" id="lhModeNav"></div>
        <a class="lh-theme-toggle lh-discord-btn d-none d-md-inline-flex" href="${DISCORD_URL}" target="_blank" rel="noopener" title="Join our Discord" aria-label="Join our Discord" data-discord-link><i class="bi bi-discord" aria-hidden="true"></i></a>
        <button type="button" class="lh-theme-toggle d-none d-md-inline-flex" id="lhThemeToggle" data-lh-theme-toggle></button>
        <button class="navbar-toggler lh-nav-toggle" type="button"
                data-lh-open-menu="mainMenu" aria-controls="mainMenu" aria-label="Open menu">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>
    </nav>

    <div class="offcanvas offcanvas-top lh-offcanvas" tabindex="-1" id="mainMenu" aria-labelledby="mainMenuLabel" aria-hidden="true">
      <div class="offcanvas-header">
        <a class="lh-brand" href="index.html" id="mainMenuLabel" aria-label="LineHunter">${lhLockupHtml()}</a>
        <button class="navbar-toggler lh-nav-toggle ms-auto" type="button"
                data-lh-close-menu="mainMenu" aria-label="Close menu">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>

      <div class="offcanvas-body">
        <div class="container-fluid lh-container px-3 px-lg-4">
          <div class="lh-mode-drawer" id="lhModeDrawer"></div>
          <div class="lh-drawer-group">
            <div class="lh-drawer-group-header lh-label">
              <i class="bi bi-basketball lh-drawer-tile-icon"></i>
              NBA
            </div>

            <div class="row g-3 lh-drawer-link-grid">
              <div class="col-12 col-md-6 col-lg-3">
                <a class="lh-drawer-tile ${activePage === "schedule.html" ? "active" : ""}" href="schedule.html" data-page="schedule.html">
                  <i class="lh-drawer-tile-icon bi bi-calendar3"></i>
                  <span>Schedule</span>
                </a>
              </div>
              <div class="col-12 col-md-6 col-lg-3">
                <a class="lh-drawer-tile ${activePage === "standings.html" ? "active" : ""}" href="standings.html" data-page="standings.html">
                  <i class="lh-drawer-tile-icon bi bi-trophy"></i>
                  <span>Standings</span>
                </a>
              </div>
              <div class="col-12 col-md-6 col-lg-3">
                <a class="lh-drawer-tile ${activePage === "props.html" ? "active" : ""}" href="props.html" data-page="props.html">
                  <i class="lh-drawer-tile-icon bi bi-graph-up-arrow"></i>
                  <span>Player <span class="lines-only">Props</span><span class="research-only">Stats</span></span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  target.innerHTML = navMarkup;
  if (inPage) slot.innerHTML = searchMarkup;

  const menu = document.getElementById("mainMenu");
  const openButton = document.querySelector('[data-lh-open-menu="mainMenu"]');
  const closeButton = document.querySelector('[data-lh-close-menu="mainMenu"]');

  const setMenuState = (isOpen) => {
    if (!menu) return;

    menu.classList.toggle("show", isOpen);
    menu.setAttribute("aria-hidden", String(!isOpen));
    menu.style.visibility = isOpen ? "visible" : "hidden";
  };

  const forceMenuClosed = () => setMenuState(false);

  if (menu) {
    forceMenuClosed();
  }

  if (openButton) {
    openButton.addEventListener("click", (event) => {
      event.preventDefault();
      setMenuState(true);
    });
  }

  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      setMenuState(false);
    });
  }

  // ---------- Research mode ----------
  // Lines mode (default) shows everything. Research mode hides the betting features (prop lines, odds, hit rates against
  // a line): every such element carries the class "lines-only", and one CSS rule hides them while <body> has "research-mode".
  const MODE_KEY = "lh-mode";
  const modeNav = document.getElementById("lhModeNav");
  const modeDrawer = document.getElementById("lhModeDrawer");

  const renderModeControls = () => {
    const research = isResearchMode();
    if (modeNav) {
      modeNav.innerHTML = research
        ? `<span class="lh-mode-badge">Research mode</span><button type="button" class="lh-mode-link" data-lh-mode="lines">Back to lines</button>`
        : `<button type="button" class="lh-mode-link" data-lh-mode="research" title="Here for pure hoops? Switch to research mode.">Pure hoops? Research mode</button><span class="lh-new-badge">New</span>`;
    }
    // The menu has room for the full sentence (it is the only place on phones, where the navbar link is hidden).
    if (modeDrawer) {
      modeDrawer.innerHTML = research
        ? `<span class="lh-mode-badge">Research mode</span> <button type="button" class="lh-mode-link" data-lh-mode="lines">Back to lines</button>`
        : `Here for pure hoops? <button type="button" class="lh-mode-link" data-lh-mode="research">Switch to research mode.</button> <span class="lh-new-badge">New</span>`;
    }
  };

  // The tab title says "Player Props" on props.html: research mode calls it "Player Stats".
  const lineTitle = document.title;
  const renderTitle = () => {
    document.title = isResearchMode() ? lineTitle.replace("Player Props", "Player Stats") : lineTitle;
  };
  renderTitle();

  const setMode = (mode) => {
    document.body.classList.toggle("research-mode", mode === "research");
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch (error) {
      // private window or blocked storage: it just won't be remembered
    }
    renderModeControls();
    renderTitle();
    // Charts and tables that draw differently in research mode redraw themselves.
    document.dispatchEvent(new CustomEvent("lh-mode-change"));
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lh-mode]");
    if (button) setMode(button.dataset.lhMode);
  });
  renderModeControls();

  // ---------- Light / dark theme ----------
  // The saved choice (localStorage "lh-theme": "light" or "dark", default dark) is applied by the script in every page's <head>.
  // The sun / moon button in the navbar (desktop) and the switch in the phone "More" sheet change it. The "lh-theme-change"
  // event tells charts and canvases to redraw.
  const THEME_KEY = "lh-theme";
  const isLightTheme = () => document.documentElement.getAttribute("data-bs-theme") === "light";

  const renderThemeControls = () => {
    const light = isLightTheme();
    const button = document.getElementById("lhThemeToggle");
    if (button) {
      // The icon shows where a click takes you: a sun in dark mode (go light), a moon in light mode (go dark).
      button.innerHTML = `<i class="bi ${light ? "bi-moon-stars-fill" : "bi-sun-fill"}" aria-hidden="true"></i>`;
      button.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
      button.title = light ? "Switch to dark mode" : "Switch to light mode";
    }
    const themeSwitch = document.getElementById("lhThemeSwitch");
    if (themeSwitch) themeSwitch.checked = light;
  };

  const setTheme = (theme) => {
    document.documentElement.setAttribute("data-bs-theme", theme === "light" ? "light" : "dark");
    try {
      localStorage.setItem(THEME_KEY, theme === "light" ? "light" : "dark");
    } catch (error) {
      // private window or blocked storage: it just won't be remembered
    }
    renderThemeControls();
    document.dispatchEvent(new CustomEvent("lh-theme-change"));
  };

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-lh-theme-toggle]")) setTheme(isLightTheme() ? "dark" : "light");
  });
  renderThemeControls();

  // ---------- Player search ----------
  // Type a name, pick a player, land on player.html. Goes through the /api/bdl proxy (no API key in the browser).
  // initPlayerSearch wires one search box (the navbar / page one, and the phone Search sheet's).
  function initPlayerSearch(searchBox, searchInput, searchResults) {
  let searchTimer = null;
  let searchToken = 0; // lets a slow, old answer be ignored when a newer search has started

  const showMessage = (text) => {
    searchResults.innerHTML = "";
    const note = document.createElement("div");
    note.className = "lh-search-note";
    note.textContent = text;
    searchResults.appendChild(note);
    searchResults.hidden = false;
  };

  const showResults = (players) => {
    if (!players.length) return showMessage("No players found.");
    searchResults.innerHTML = "";
    players.forEach((p) => {
      const link = document.createElement("a");
      link.className = "lh-search-row";
      link.href = `player.html?id=${p.id}`;
      const name = document.createElement("span");
      name.textContent = `${p.first_name} ${p.last_name}`;
      const meta = document.createElement("span");
      meta.className = "lh-search-meta";
      meta.textContent = [p.team && p.team.abbreviation, p.position].filter(Boolean).join(" · ");
      link.append(name, meta);
      searchResults.appendChild(link);
    });
    searchResults.hidden = false;
  };

  const runSearch = async (text) => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { searchResults.hidden = true; return; }
    const token = ++searchToken;
    try {
      // The API searches one word at a time, so ask with the longest and filter on the rest here.
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
      const response = await fetch(`/api/bdl/v1/players/active?search=${encodeURIComponent(longest)}&per_page=50`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const json = await response.json();
      if (token !== searchToken) return;
      const matches = json.data.filter((p) => {
        const full = `${p.first_name} ${p.last_name}`.toLowerCase();
        return words.every((word) => full.includes(word));
      });
      showResults(matches.slice(0, 8));
    } catch (error) {
      if (token === searchToken) showMessage("Search is unavailable right now.");
    }
  };

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(searchInput.value.trim()), 300);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { searchResults.hidden = true; searchInput.blur(); }
      if (event.key === "Enter") {
        const first = searchResults.querySelector("a");
        if (first) location.href = first.href;
      }
    });
    searchInput.addEventListener("focus", () => {
      if (searchResults.childElementCount) searchResults.hidden = false;
    });
    document.addEventListener("click", (event) => {
      if (!searchBox.contains(event.target)) searchResults.hidden = true;
    });
  }
  }
  initPlayerSearch(document.getElementById("lhSearch"), document.getElementById("lhSearchInput"), document.getElementById("lhSearchResults"));

  // ---------- Phone bottom tab bar (under 768px) ----------
  // Today, Hit List, Search, Players, More. The bar and its two bottom sheets exist on every page, but the CSS only shows
  // them under 768px (css/styles.css, "Phone bottom tab bar"), where the top bar keeps just the logo.
  const LAST_PLAYER_KEY = "lh-last-player"; // the player page you last opened: the Players tab goes back to it
  if (currentPage === "player.html") {
    try {
      const viewedId = new URLSearchParams(location.search).get("id");
      if (viewedId) localStorage.setItem(LAST_PLAYER_KEY, viewedId);
    } catch (error) {
      // storage blocked: the Players tab will open the search sheet instead
    }
  }
  let lastPlayerId = null;
  try {
    lastPlayerId = localStorage.getItem(LAST_PLAYER_KEY);
  } catch (error) {
    lastPlayerId = null;
  }

  // The Hit List shelf is #hitlist in lines mode and #streaks in research mode (the other one is hidden).
  const shelfId = () => (isResearchMode() ? "streaks" : "hitlist");
  const playersTab = lastPlayerId
    ? `<a class="lh-tab" href="player.html?id=${lastPlayerId}" data-tab="players"><i class="bi bi-person-lines-fill" aria-hidden="true"></i><span>Players</span></a>`
    : `<button type="button" class="lh-tab" data-tab="players" data-bs-toggle="offcanvas" data-bs-target="#lhSearchSheet"><i class="bi bi-person-lines-fill" aria-hidden="true"></i><span>Players</span></button>`;

  const tabbar = document.createElement("nav");
  tabbar.className = "lh-tabbar";
  tabbar.setAttribute("aria-label", "Main");
  tabbar.innerHTML = `
    <a class="lh-tab" href="schedule.html" data-tab="today"><i class="bi bi-calendar3" aria-hidden="true"></i><span>Today</span></a>
    <a class="lh-tab" href="schedule.html#hitlist" data-tab="hitlist" id="lhTabHitlist"><i class="bi bi-bullseye" aria-hidden="true"></i><span>Hit List</span></a>
    <button type="button" class="lh-tab" data-tab="search" data-bs-toggle="offcanvas" data-bs-target="#lhSearchSheet"><i class="bi bi-search" aria-hidden="true"></i><span>Search</span></button>
    ${playersTab}
    <button type="button" class="lh-tab" data-tab="more" data-bs-toggle="offcanvas" data-bs-target="#lhMoreSheet"><i class="bi bi-three-dots" aria-hidden="true"></i><span>More</span></button>`;
  document.body.appendChild(tabbar);

  // Bottom sheets (Bootstrap offcanvas from the bottom)
  const sheets = document.createElement("div");
  sheets.innerHTML = `
    <div class="offcanvas offcanvas-bottom lh-sheet" tabindex="-1" id="lhSearchSheet" aria-labelledby="lhSearchSheetLabel">
      <div class="offcanvas-header">
        <h2 class="offcanvas-title lh-label" id="lhSearchSheetLabel">Search players</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body">
        <div class="lh-search" id="lhSheetSearch" role="search">
          <i class="bi bi-search lh-search-icon" aria-hidden="true"></i>
          <input type="search" id="lhSheetSearchInput" class="lh-search-input" placeholder="Search players" autocomplete="off" aria-label="Search players">
          <div class="lh-search-results" id="lhSheetSearchResults" hidden></div>
        </div>
      </div>
    </div>

    <div class="offcanvas offcanvas-bottom lh-sheet" tabindex="-1" id="lhMoreSheet" aria-labelledby="lhMoreSheetLabel">
      <div class="offcanvas-header">
        <h2 class="offcanvas-title lh-label" id="lhMoreSheetLabel">More</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body">
        <div class="btn-group lh-window-toggle lh-league-sheet w-100 mb-3" role="group" aria-label="League">${leagueLinks}</div>
        <label class="lh-sheet-row lh-mode-row" for="lhModeSwitch">
          <span><strong>Research mode</strong><small>Pure hoops: hides lines, odds and hit rates</small></span>
          <span class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" id="lhModeSwitch"></span>
        </label>
        <label class="lh-sheet-row" for="lhThemeSwitch">
          <span><strong>Light mode</strong><small>Switch the look of the whole site</small></span>
          <span class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" id="lhThemeSwitch"></span>
        </label>
        <div class="lh-sheet-row is-soon"><span><strong>Sign in</strong><small>Save your settings and picks</small></span><span class="lh-soon-badge">Coming soon</span></div>
        <div class="lh-sheet-row is-soon"><span><strong>My Picks</strong><small>Track the props you like</small></span><span class="lh-soon-badge">Coming soon</span></div>
        <a class="lh-sheet-row" href="${DISCORD_URL}" target="_blank" rel="noopener" data-discord-link><span><strong><i class="bi bi-discord me-2" aria-hidden="true"></i>Join our Discord</strong></span><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>
        <a class="lh-sheet-row" href="standings.html"><span><strong>Standings</strong></span><i class="bi bi-chevron-right" aria-hidden="true"></i></a>
        <a class="lh-sheet-row" href="props.html"><span><strong>Player <span class="lines-only">Props</span><span class="research-only">Stats</span></strong></span><i class="bi bi-chevron-right" aria-hidden="true"></i></a>
      </div>
    </div>`;
  document.body.append(...sheets.children);

  initPlayerSearch(document.getElementById("lhSheetSearch"), document.getElementById("lhSheetSearchInput"), document.getElementById("lhSheetSearchResults"));

  // Search sheet: the keyboard opens straight away.
  const searchSheet = document.getElementById("lhSearchSheet");
  searchSheet.addEventListener("shown.bs.offcanvas", () => document.getElementById("lhSheetSearchInput").focus());

  // The switch in the More sheet is the research mode switch (kept in step with the navbar one on a wider screen).
  const modeSwitch = document.getElementById("lhModeSwitch");
  modeSwitch.checked = isResearchMode();
  modeSwitch.addEventListener("change", () => setMode(modeSwitch.checked ? "research" : "lines"));
  const themeSwitch = document.getElementById("lhThemeSwitch");
  themeSwitch.checked = isLightTheme();
  themeSwitch.addEventListener("change", () => setTheme(themeSwitch.checked ? "light" : "dark"));
  document.addEventListener("lh-mode-change", () => {
    modeSwitch.checked = isResearchMode();
    updateHitlistTab();
    watchShelf();
  });

  // The Hit List tab: on the schedule page it scrolls to the shelf; elsewhere it is a link to schedule.html#hitlist.
  const hitlistTab = document.getElementById("lhTabHitlist");
  const updateHitlistTab = () => { hitlistTab.href = `schedule.html#${shelfId()}`; };
  updateHitlistTab();
  hitlistTab.addEventListener("click", (event) => {
    if (currentPage !== "schedule.html") return;
    event.preventDefault();
    const target = document.getElementById(shelfId());
    if (target) target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  // Which tab is highlighted: an open sheet wins; otherwise the page (Today = schedule and game pages, Players = a player page);
  // on the schedule page, Hit List while its shelf is on screen.
  let openSheet = null;
  let shelfVisible = false;
  const renderTabs = () => {
    let active = null;
    if (openSheet) active = openSheet;
    else if (currentPage === "player.html") active = "players";
    else if (currentPage === "schedule.html") active = shelfVisible ? "hitlist" : "today";
    else if (currentPage === "game.html") active = "today";
    tabbar.querySelectorAll(".lh-tab").forEach((tab) => {
      const isActive = tab.dataset.tab === active;
      tab.classList.toggle("is-active", isActive);
      if (isActive) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
  };
  [["lhSearchSheet", "search"], ["lhMoreSheet", "more"]].forEach(([id, name]) => {
    const sheet = document.getElementById(id);
    sheet.addEventListener("show.bs.offcanvas", () => { openSheet = name; renderTabs(); });
    sheet.addEventListener("hidden.bs.offcanvas", () => { openSheet = null; renderTabs(); });
  });

  let shelfObserver = null;
  const watchShelf = () => {
    if (currentPage !== "schedule.html") return;
    if (shelfObserver) shelfObserver.disconnect();
    const shelf = document.getElementById(shelfId());
    if (!shelf) return;
    shelfObserver = new IntersectionObserver((entries) => {
      shelfVisible = entries.some((entry) => entry.isIntersecting);
      renderTabs();
    }, { threshold: 0.3 });
    shelfObserver.observe(shelf);
  };
  watchShelf();
  renderTabs();

  // ---------- Responsible gaming footer ----------
  // Added to the end of every page that has the navbar, so it only has to be written (and kept current) here.
  if (!document.querySelector(".lh-footer")) {
    const footer = document.createElement("footer");
    footer.className = "lh-footer";
    footer.innerHTML = `
      <div class="container-fluid lh-container px-3 px-lg-4">
        <div class="lh-footer-title lh-label">Play responsibly</div>
        <p>LineHunter shows stats for information and entertainment only. It is not betting advice, and past results are not guarantees.</p>
        <p>You must be 21+ (or the legal age where you live) to bet. If you or someone you know has a gambling problem,
           call <a href="tel:18004262537">1-800-GAMBLER</a> or visit
           <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">ncpgambling.org</a>.</p>
        <div class="lh-footer-title lh-label mt-3">Community</div>
        <p><a href="${DISCORD_URL}" target="_blank" rel="noopener" data-discord-link><i class="bi bi-discord" aria-hidden="true"></i> Discord</a></p>
        <p class="lh-footer-copy">© ${new Date().getFullYear()} LineHunter · Data from <strong>BALLDONTLIE</strong></p>
      </div>`;
    document.body.appendChild(footer);
  }

  // Links written in a page's own HTML (like the Hit List note) get the same invite URL.
  document.querySelectorAll("[data-discord-link]").forEach((link) => { link.href = DISCORD_URL; });

  window.addEventListener("pageshow", forceMenuClosed, { passive: true });
})();
