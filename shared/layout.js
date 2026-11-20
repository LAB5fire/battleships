// Random fleet placement, used by the browser ("Randomize") and by tests.
// Ships never touch each other or `hulls` (decoys), not even diagonally, and never overlap `blocked`.
import { shipCells, touchesAny } from './geometry.js';

function tryPlace(size, fleet, blocked, hulls, rng) {
  const taken = new Set(hulls);
  const ships = [];
  for (const spec of fleet) {
    let placed = false;
    for (let t = 0; t < 400 && !placed; t++) {
      const dir = rng() < 0.5 ? 'h' : 'v';
      const r = Math.floor(rng() * size);
      const c = Math.floor(rng() * size);
      const cells = shipCells(size, r, c, dir, spec.size);
      if (!cells || cells.some((i) => blocked.has(i)) || touchesAny(size, cells, taken)) continue;
      for (const i of cells) taken.add(i);
      ships.push({ type: spec.type, r, c, dir });
      placed = true;
    }
    if (!placed) return null;
  }
  return ships;
}

// Returns [{type, r, c, dir}] or null.
export function randomFleet(size, fleet, blocked = new Set(), rng = Math.random, hulls = new Set()) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const ships = tryPlace(size, fleet, blocked, hulls, rng);
    if (ships) return ships;
  }
  return null;
}
