// Default fetch for all radar API calls. Tests can swap it with setRadarFetch(fn)
// without touching globalThis.fetch (which the test client itself uses).
let impl = null;

export function radarFetch(...args) {
  return (impl || globalThis.fetch)(...args);
}

export function setRadarFetch(fn) {
  impl = fn || null;
}
