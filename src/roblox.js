/**
 * Öffentliche Roblox-Abfragen. Es wird nichts eingeloggt und kein Account-Zugriff gebraucht,
 * nur öffentliche Profildaten (ID, Name, Erstellungsdatum, Avatarbild).
 */

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function isValidUsername(name) {
  return USERNAME_RE.test(name);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Roblox-API antwortet mit ${res.status} für ${url}`);
  }
  return res.json();
}

/** Sucht einen Roblox-Account per Benutzername. Gibt { id, name, displayName } oder null zurück. */
async function findUserByName(username) {
  if (!isValidUsername(username)) return null;
  const data = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
  });
  const user = data.data && data.data[0];
  return user ? { id: user.id, name: user.name, displayName: user.displayName } : null;
}

/** Profil-Details (u. a. Erstellungsdatum). Gibt null zurück, wenn es nicht klappt. */
async function getUserDetails(userId) {
  try {
    const data = await fetchJson(`https://users.roblox.com/v1/users/${userId}`);
    return { id: data.id, name: data.name, displayName: data.displayName, created: data.created };
  } catch {
    return null;
  }
}

/** URL des Avatar-Kopfbilds oder null. */
async function getHeadshotUrl(userId) {
  try {
    const data = await fetchJson(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
    );
    const entry = data.data && data.data[0];
    return entry && entry.state === 'Completed' ? entry.imageUrl : null;
  } catch {
    return null;
  }
}

function profileUrl(userId) {
  return `https://www.roblox.com/users/${userId}/profile`;
}

module.exports = { isValidUsername, findUserByName, getUserDetails, getHeadshotUrl, profileUrl };
