// LineHunter - js/components/playerPhoto.js
// Player initials circles with a slot for a photo. The circle shows the initials in the team's color; when PLAYER_PHOTO_URL
// is set, the photo is loaded and only added once it has loaded, so a missing or broken photo leaves the initials in place.
//
//   fillPlayerAvatar(el, { id, first, last, team })  -> initials + team color + photo slot
//   loadPlayerPhoto(el)                              -> the photo for el.dataset.playerId (when PLAYER_PHOTO_URL is set)
//
// Needs teamAvatarStyle() from js/data/teams.js for the team color.

// The photo address pattern, "{id}" = the BALLDONTLIE player id. Empty = no photos yet (initials everywhere).
// Example once photos exist: "https://cdn.example.com/nba/players/{id}.png"
const PLAYER_PHOTO_URL = "";

function playerInitials(first, last) {
  return `${(first || "").trim().charAt(0)}${(last || "").trim().charAt(0)}`.toUpperCase();
}

function loadPlayerPhoto(el) {
  const id = el && el.dataset.playerId;
  if (!PLAYER_PHOTO_URL || !id) return;
  const src = PLAYER_PHOTO_URL.replace("{id}", encodeURIComponent(id));
  const current = el.querySelector("img");
  if (current && current.dataset.src === src) return;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.dataset.src = src;
  img.onload = () => {
    if (el.dataset.playerId !== id) return; // the circle moved on to another player meanwhile
    el.querySelectorAll("img").forEach((old) => old.remove());
    el.appendChild(img);
  };
  img.src = src;
}

function fillPlayerAvatar(el, { id, first, last, team } = {}) {
  if (!el) return;
  el.dataset.playerId = id || "";
  el.textContent = playerInitials(first, last);
  if (team && typeof teamAvatarStyle === "function") {
    el.dataset.avatarTeam = team; // refreshTeamColors (js/data/teams.js) recolors it on a theme change
    el.setAttribute("style", teamAvatarStyle(team));
  }
  loadPlayerPhoto(el);
}
