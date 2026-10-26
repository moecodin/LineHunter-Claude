// Collapse toggle for the player page cards. Each card has data-lh-collapse="key" and one title row with
// data-lh-collapse-head; a small chevron button is added to that row. Collapsing hides everything in the card
// after the title row (its later siblings, and the later siblings of each wrapper up to the card).
// Collapsed cards are remembered in localStorage (lh-collapsed-cards). Charts refit when a card opens again:
// Chart.js and the animated bars watch their own size, and a resize event is sent as a fallback.
(function () {
  const STORE_KEY = "lh-collapsed-cards";

  function readCollapsed() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function saveCollapsed(key, collapsed) {
    try {
      const list = readCollapsed().filter((item) => item !== key);
      if (collapsed) list.push(key);
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (error) {
      // storage blocked: the card still toggles, it just isn't remembered
    }
  }

  // Everything after the head inside the card: its later siblings, then its parent's, up to the card.
  function bodyParts(card, head) {
    const parts = [];
    for (let node = head; node && node !== card; node = node.parentElement) {
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) parts.push(next);
    }
    return parts;
  }

  function setCollapsed(card, button, collapsed) {
    card.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    const name = button.dataset.name;
    button.setAttribute("aria-label", (collapsed ? "Show " : "Hide ") + name);
    button.title = collapsed ? "Show" : "Hide";
  }

  function initCard(card, collapsedKeys) {
    const key = card.dataset.lhCollapse;
    const head = card.querySelector("[data-lh-collapse-head]");
    if (!key || !head) return;

    bodyParts(card, head).forEach((part) => part.classList.add("lh-cc-part"));

    const label = head.querySelector(".lh-label") || head;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lh-cc-toggle";
    button.dataset.name = card.dataset.lhCollapseName || (label.textContent || "").trim() || "card";
    button.innerHTML = '<i class="bi bi-chevron-up" aria-hidden="true"></i>';
    head.appendChild(button);

    setCollapsed(card, button, collapsedKeys.includes(key));

    button.addEventListener("click", () => {
      const collapsed = !card.classList.contains("is-collapsed");
      setCollapsed(card, button, collapsed);
      saveCollapsed(key, collapsed);
      if (!collapsed) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
  }

  function initCardCollapse(root) {
    const collapsedKeys = readCollapsed();
    (root || document).querySelectorAll("[data-lh-collapse]").forEach((card) => initCard(card, collapsedKeys));
  }

  window.initCardCollapse = initCardCollapse;
  initCardCollapse();
})();
