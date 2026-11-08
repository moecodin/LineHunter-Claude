// LineHunter - js/components/playerPhoto.js
// Player initials circles with a slot for a photo. The circle shows the initials in the team's color; when PLAYER_PHOTO_URL
// is set, the photo is loaded and only added once it has loaded, so a missing or broken photo leaves the initials in place.
//
//   fillPlayerAvatar(el, { id, first, last, team })  -> initials + team color + photo slot
//   loadPlayerPhoto(el)                              -> the photo for el.dataset.playerId (when PLAYER_PHOTO_URL is set)
//
// Needs teamAvatarStyle() from js/data/teams.js for the team color.

// The photo address pattern, "{id}" = the NBA player id (looked up by name in js/data/nbaIds.js, since the API's ids differ).
// These are the league's own headshots on its public CDN: unofficial and unlicensed, fine for the beta; move to a licensed
// source before charging. A player with no match, or a photo that fails to load, keeps the initials circle.
const PLAYER_PHOTO_URL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{id}.png";

// "Luka Dončić" -> "luka doncic"; Jr. / Sr. / II / III / IV dropped, hyphens become spaces. Must match js/data/nbaIds.js keys.
function nbaNameKey(first, last) {
  const plain = `${first || ""} ${last || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "");
  return plain.split(/\s+/).filter((word) => word && !["jr", "sr", "ii", "iii", "iv", "v"].includes(word)).join(" ");
}

function playerInitials(first, last) {
  return `${(first || "").trim().charAt(0)}${(last || "").trim().charAt(0)}`.toUpperCase();
}

function loadPlayerPhoto(el) {
  const id = el && el.dataset.playerId;
  if (!PLAYER_PHOTO_URL || !id) return;
  const nbaId = typeof NBA_PLAYER_IDS === "object" ? NBA_PLAYER_IDS[el.dataset.nameKey || ""] : null;
  if (!nbaId) return;
  const src = PLAYER_PHOTO_URL.replace("{id}", encodeURIComponent(nbaId));
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
  el.dataset.nameKey = nbaNameKey(first, last);
  el.textContent = playerInitials(first, last);
  if (team && typeof teamAvatarStyle === "function") {
    el.dataset.avatarTeam = team; // refreshTeamColors (js/data/teams.js) recolors it on a theme change
    el.setAttribute("style", teamAvatarStyle(team));
  }
  loadPlayerPhoto(el);
}
