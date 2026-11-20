// Board geometry helpers. Cells are addressed by index i = r * size + c.

// What one player knows about a cell of the other player's board.
export const VIEW = Object.freeze({
  UNKNOWN: 0,
  MISS: 1, // shot here, water
  HIT: 2, // ship part hit (ship still afloat)
  SUNK: 3, // part of a sunk ship
  SPOTTED: 4, // intel shows an intact ship part here
  CLEAR: 5, // intel shows water here
  DECOY: 6, // known decoy
  MINE: 7, // a mine exploded here
  MINE_SPOTTED: 8, // intel shows a mine here
});

export const LANE_DIRS = ['right', 'left', 'down', 'up'];

export const toIdx = (size, r, c) => r * size + c;
export const toRC = (size, i) => [Math.floor(i / size), i % size];

export const inBounds = (size, r, c) =>
  Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < size && c < size;

export const colLabel = (c) => String.fromCharCode(65 + c);
export const cellLabel = (size, i) => {
  const [r, c] = toRC(size, i);
  return `${colLabel(c)}${r + 1}`;
};

// Cells of a ship whose first cell is (r, c). Returns null if any part is off the board.
export function shipCells(size, r, c, dir, len) {
  const out = [];
  for (let k = 0; k < len; k++) {
    const rr = dir === 'v' ? r + k : r;
    const cc = dir === 'v' ? c : c + k;
    if (!inBounds(size, rr, cc)) return null;
    out.push(rr * size + cc);
  }
  return out;
}

// (2k+1) x (2k+1) square around (r, c), clipped to the board.
export function squareCells(size, r, c, k) {
  const out = [];
  for (let dr = -k; dr <= k; dr++) {
    for (let dc = -k; dc <= k; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(size, rr, cc)) out.push(rr * size + cc);
    }
  }
  return out;
}

// "+" shape reaching k cells in each direction, clipped to the board.
export function crossCells(size, r, c, k) {
  const out = [r * size + c];
  for (let d = 1; d <= k; d++) {
    for (const [dr, dc] of [[-d, 0], [d, 0], [0, -d], [0, d]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(size, rr, cc)) out.push(rr * size + cc);
    }
  }
  return out;
}

// Whole row (orient 'h') or whole column (orient 'v') through (r, c).
export function lineCells(size, r, c, orient) {
  const out = [];
  for (let k = 0; k < size; k++) out.push(orient === 'v' ? k * size + c : r * size + k);
  return out;
}

// Torpedo path in travel order. 'right' runs along row r starting at the left edge, etc.
export function lanePath(size, r, c, dir) {
  const out = [];
  for (let k = 0; k < size; k++) {
    if (dir === 'right') out.push(r * size + k);
    else if (dir === 'left') out.push(r * size + (size - 1 - k));
    else if (dir === 'down') out.push(k * size + c);
    else out.push((size - 1 - k) * size + c);
  }
  return out;
}

export function shapeCells(shape, size, r, c) {
  if (!shape) return [r * size + c];
  if (shape.kind === 'square') return squareCells(size, r, c, shape.radius);
  if (shape.kind === 'cross') return crossCells(size, r, c, shape.radius);
  return [r * size + c];
}

export const laneLabel = (size, r, c, dir) =>
  dir === 'right' || dir === 'left' ? `row ${r + 1}` : `column ${colLabel(c)}`;

// The 8 cells around i (diagonals included), inside the board.
export function neighborCells(size, i) {
  const r = Math.floor(i / size);
  const c = i % size;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
    }
  }
  return out;
}

// True if any of `cells` is on, or next to (diagonals too), a cell in `taken`.
export function touchesAny(size, cells, taken) {
  return cells.some((i) => taken.has(i) || neighborCells(size, i).some((n) => taken.has(n)));
}
