// Game settings, fleets and economy. Shared by the server (rules) and the browser (UI).

export const GAME_NAME = 'Fleet Fury';

export const BOARD_SIZES = [10, 12, 14];
export const BEST_OF_OPTIONS = [3, 5, 7];
export const COIN_OPTIONS = [250, 400, 800, 1500];
export const TIMER_OPTIONS = [0, 30, 60, 90];

export const DEFAULT_SETTINGS = Object.freeze({
  bestOf: 3,
  boardSize: 12,
  startingCoins: 400,
  turnTimer: 0,
});

const CARRIER = { type: 'carrier', name: 'Carrier', size: 5 };
const BATTLESHIP = { type: 'battleship', name: 'Battleship', size: 4 };
const FRIGATE = { type: 'frigate', name: 'Frigate', size: 4 };
const CRUISER = { type: 'cruiser', name: 'Cruiser', size: 3 };
const SUBMARINE = { type: 'submarine', name: 'Submarine', size: 3 };
const DESTROYER = { type: 'destroyer', name: 'Destroyer', size: 2 };
const PATROL = { type: 'patrol', name: 'Patrol Boat', size: 2 };

// Bigger boards get a slightly bigger fleet so games don't drag on.
export const FLEETS = {
  10: [CARRIER, BATTLESHIP, CRUISER, SUBMARINE, DESTROYER],
  12: [CARRIER, BATTLESHIP, CRUISER, SUBMARINE, DESTROYER, PATROL],
  14: [CARRIER, BATTLESHIP, FRIGATE, CRUISER, SUBMARINE, DESTROYER, PATROL],
};

// Coins earned during a round are paid out when the round ends,
// so they can only be spent in the next round's Armory.
export const ECONOMY = Object.freeze({
  hit: 10, // per ship part hit
  sink: 30, // per enemy ship sunk
  winBonus: 200, // for winning a round
  lossBonus: 150, // for losing a round...
  lossStreakStep: 50, // ...plus this much for every loss in a row before it
  lossBonusMax: 300,
});

export const EMOTES = ['👍', '😂', '😱', '😡', '🔥', '🫡', 'GG'];

export const roundsToWin = (bestOf) => Math.ceil(bestOf / 2);

export function lossBonusFor(streak) {
  return Math.min(ECONOMY.lossBonusMax, ECONOMY.lossBonus + ECONOMY.lossStreakStep * streak);
}

export function sanitizeSettings(raw = {}) {
  const pick = (value, options, fallback) => (options.includes(Number(value)) ? Number(value) : fallback);
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    bestOf: pick(s.bestOf, BEST_OF_OPTIONS, DEFAULT_SETTINGS.bestOf),
    boardSize: pick(s.boardSize, BOARD_SIZES, DEFAULT_SETTINGS.boardSize),
    startingCoins: pick(s.startingCoins, COIN_OPTIONS, DEFAULT_SETTINGS.startingCoins),
    turnTimer: pick(s.turnTimer, TIMER_OPTIONS, DEFAULT_SETTINGS.turnTimer),
  };
}
