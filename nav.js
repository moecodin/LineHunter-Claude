(function () {
  const target = document.getElementById("site-nav");
  if (!target) return;

  const currentPage = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const activePage = currentPage === "game.html" ? "schedule.html" : currentPage;

  const navMarkup = `
    <nav class="navbar lh-navbar sticky-top mb-4">
      <div class="container">
        <a class="navbar-brand lh-logo" href="index.html">Line<span>Hunter</span></a>
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
        <div class="container">
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

  window.addEventListener("pageshow", forceMenuClosed, { passive: true });
})();
