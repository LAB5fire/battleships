// Random fleet placement, used by the browser ("Randomize") and by tests.
import { shipCells, toRC } from './geometry.js';

function neighbors(size, i) {
  const [r, c] = toRC(size, i);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
    }
  }
  return out;
}

function tryPlace(size, fleet, blocked, spaced, rng) {
  const occupied = new Set(blocked);
  const buffer = new Set(blocked);
  const ships = [];
  for (const spec of fleet) {
    let placed = false;
    for (let t = 0; t < 400 && !placed; t++) {
      const dir = rng() < 0.5 ? 'h' : 'v';
      const r = Math.floor(rng() * size);
      const c = Math.floor(rng() * size);
      const cells = shipCells(size, r, c, dir, spec.size);
      if (!cells) continue;
      const taken = spaced ? buffer : occupied;
      if (cells.some((i) => taken.has(i))) continue;
      for (const i of cells) {
        occupied.add(i);
        for (const n of neighbors(size, i)) buffer.add(n);
      }
      ships.push({ type: spec.type, r, c, dir });
      placed = true;
    }
    if (!placed) return null;
  }
  return ships;
}

// Returns [{type, r, c, dir}] or null. Tries to keep ships from touching first.
export function randomFleet(size, fleet, blocked = new Set(), rng = Math.random) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ships = tryPlace(size, fleet, blocked, attempt < 40, rng);
    if (ships) return ships;
  }
  return null;
}
