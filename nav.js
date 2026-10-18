(function () {
  const target = document.getElementById("site-nav");
  if (!target) return;

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

  const navMarkup = `
    <nav class="navbar lh-navbar sticky-top mb-4">
      <div class="container-fluid lh-container px-3 px-lg-4">
        <a class="navbar-brand lh-logo" href="index.html">Line<span>Hunter</span></a>
        ${inPage ? "" : searchMarkup}
        <button class="navbar-toggler lh-nav-toggle" type="button"
                data-lh-open-menu="mainMenu" aria-controls="mainMenu" aria-label="Open menu">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>
    </nav>

    <div class="offcanvas offcanvas-top lh-offcanvas" tabindex="-1" id="mainMenu" aria-labelledby="mainMenuLabel" aria-hidden="true">
      <div class="offcanvas-header">
        <a class="lh-logo" href="index.html" id="mainMenuLabel">Line<span>Hunter</span></a>
        <button class="navbar-toggler lh-nav-toggle ms-auto" type="button"
                data-lh-close-menu="mainMenu" aria-label="Close menu">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>

      <div class="offcanvas-body">
        <div class="container-fluid lh-container px-3 px-lg-4">
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
                  <span>Player Props</span>
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

  // ---------- Player search ----------
  // Type a name, pick a player, land on player.html. Needs config.js (BDL_API_KEY) on the page.
  const searchBox = document.getElementById("lhSearch");
  const searchInput = document.getElementById("lhSearchInput");
  const searchResults = document.getElementById("lhSearchResults");
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
    if (typeof BDL_API_KEY === "undefined" || BDL_API_KEY === "paste-your-key-here") {
      return showMessage("Add your API key in config.js to search.");
    }
    const token = ++searchToken;
    try {
      // The API searches one word at a time, so ask with the longest and filter on the rest here.
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
      const response = await fetch(
        `https://api.balldontlie.io/v1/players/active?search=${encodeURIComponent(longest)}&per_page=50`,
        { headers: { Authorization: BDL_API_KEY } }
      );
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
        <p class="lh-footer-copy">© ${new Date().getFullYear()} LineHunter</p>
      </div>`;
    document.body.appendChild(footer);
  }

  window.addEventListener("pageshow", forceMenuClosed, { passive: true });
})();
