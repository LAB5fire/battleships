// The Armory. Shared by the server (rules) and the browser (shop, targeting, help).
//
// action:
//   attack   – replaces your shot and ends your turn
//   tactical – free action, one per turn, you still shoot afterwards
//   deploy   – placed on your own board before the battle
//   passive  – triggers automatically while you own it
// targeting (how the item is aimed in the UI):
//   cell | line | lane | multi | none | ownShip | ownHit | relocate | deploy | passive
// plane:   can be shot down by Flak Cannon
// missile: can be intercepted by Interceptor

export const CATEGORIES = [
  { id: 'bomb', name: 'Bombs & Missiles', icon: '💥', blurb: 'Heavy hitters. Using one replaces your shot and ends your turn.' },
  { id: 'air', name: 'Air Force', icon: '✈️', blurb: 'Planes cover whole rows or columns, but a Flak Cannon can shoot them down.' },
  { id: 'intel', name: 'Intel', icon: '🛰️', blurb: 'Find the enemy fleet. Intel is a tactical action, so you still get your shot.' },
  { id: 'defense', name: 'Defense', icon: '🛡️', blurb: 'Protect, repair, trick and punish your opponent.' },
];

export const ACTIONS = {
  attack: { label: 'Attack', hint: 'Replaces your shot and ends your turn.' },
  tactical: { label: 'Tactical', hint: 'Free action, 1 per turn. You still shoot afterwards.' },
  deploy: { label: 'Deploy', hint: 'Placed on your board before the battle starts.' },
  passive: { label: 'Passive', hint: 'Works automatically while you own it.' },
};

export const ITEMS = [
  // ---------------------------------------------------------------- bombs
  {
    id: 'cluster', name: 'Cluster Bomb', icon: '💣', category: 'bomb', action: 'attack',
    price: 150, max: 3, targeting: 'cell', shape: { kind: 'square', radius: 1 }, missile: true,
    desc: 'Blasts every cell in a 3×3 area.',
  },
  {
    id: 'nuke', name: 'Mega Nuke', icon: '☢️', category: 'bomb', action: 'attack',
    price: 450, max: 1, targeting: 'cell', shape: { kind: 'square', radius: 2 }, missile: true,
    desc: 'Wipes out a huge 5×5 area. The most expensive item in the Armory.',
  },
  {
    id: 'cross', name: 'Cross Missile', icon: '➕', category: 'bomb', action: 'attack',
    price: 130, max: 3, targeting: 'cell', shape: { kind: 'cross', radius: 2 }, missile: true,
    desc: 'Explodes in a + shape that reaches 2 cells in every direction (9 cells).',
  },
  {
    id: 'seeker', name: 'Seeker Missile', icon: '🎯', category: 'bomb', action: 'attack',
    price: 110, max: 3, targeting: 'cell', shape: { kind: 'single' }, zone: { kind: 'square', radius: 2 }, missile: true,
    desc: 'Hits the cell you aim at. If that cell is water, it homes in on the nearest ship part within 2 cells.',
  },
  {
    id: 'torpedo', name: 'Torpedo', icon: '🦈', category: 'bomb', action: 'attack',
    price: 100, max: 3, targeting: 'lane',
    desc: 'Fired from the edge along a row or column. It hits the first ship part in its path and reveals all the water it passes. It travels underwater, so Interceptors can\'t stop it.',
  },
  {
    id: 'napalm', name: 'Napalm Shell', icon: '🔥', category: 'bomb', action: 'attack',
    price: 140, max: 2, targeting: 'cell', shape: { kind: 'single' }, missile: true,
    desc: 'Hits one cell and sets the ship there on fire (damaged parts count too). The fire burns one more part at the start of each of your turns until the ship sinks or gets repaired.',
  },
  {
    id: 'chain', name: 'Chain Lightning', icon: '⚡', category: 'bomb', action: 'attack',
    price: 160, max: 2, targeting: 'cell', shape: { kind: 'single' }, missile: true,
    desc: 'Hits one cell. If it touches a ship (damaged parts count too), lightning arcs to 2 more parts of that ship.',
  },
  {
    id: 'salvo', name: 'Rocket Salvo', icon: '🎆', category: 'bomb', action: 'attack',
    price: 120, max: 3, targeting: 'multi', count: 3, missile: true,
    desc: 'Fire 3 rockets at any 3 cells you choose, anywhere on the board.',
  },
  // ---------------------------------------------------------------- air force
  {
    id: 'bomber', name: 'Bomber Run', icon: '✈️', category: 'air', action: 'attack',
    price: 280, max: 2, targeting: 'line', plane: true,
    desc: 'A bomber flies across an entire row or column and bombs every cell on it.',
  },
  {
    id: 'recon', name: 'Recon Plane', icon: '🛩️', category: 'air', action: 'tactical',
    price: 120, max: 3, targeting: 'line', plane: true,
    desc: 'Flies over an entire row or column and reveals the ships, water and mines on it. Deals no damage.',
  },
  {
    id: 'commando', name: 'Commando Drop', icon: '🪂', category: 'air', action: 'tactical',
    price: 120, max: 3, targeting: 'cell', shape: { kind: 'single' }, plane: true,
    desc: 'Paratroopers land on one cell. If it\'s a ship, they reveal the whole ship and expose decoys. If it\'s water, they scout the 4 cells around them.',
  },
  // ---------------------------------------------------------------- intel
  {
    id: 'sonar', name: 'Sonar Ping', icon: '🐬', category: 'intel', action: 'tactical',
    price: 60, max: 4, targeting: 'cell', shape: { kind: 'square', radius: 2 },
    desc: 'Counts how many intact ship parts are hidden in a 5×5 area.',
  },
  {
    id: 'radar', name: 'Radar Scan', icon: '📡', category: 'intel', action: 'tactical',
    price: 100, max: 3, targeting: 'cell', shape: { kind: 'square', radius: 1 },
    desc: 'Reveals exactly what is in a 3×3 area: ships, water and mines.',
  },
  {
    id: 'satellite', name: 'Spy Satellite', icon: '🛰️', category: 'intel', action: 'tactical',
    price: 200, max: 2, targeting: 'none',
    desc: 'Reveals one random intact part of 3 different enemy ships.',
  },
  // ---------------------------------------------------------------- defense
  {
    id: 'shield', name: 'Energy Shield', icon: '🛡️', category: 'defense', action: 'tactical',
    price: 120, max: 3, targeting: 'ownShip', secret: true,
    desc: 'Shields one of your ships so it blocks the next 2 hits. The enemy only finds out when they hit it.',
  },
  {
    id: 'repair', name: 'Repair Kit', icon: '🔧', category: 'defense', action: 'tactical',
    price: 100, max: 3, targeting: 'ownHit',
    desc: 'Fixes one damaged part of a ship that is still afloat and puts out any fire on it.',
  },
  {
    id: 'evasive', name: 'Evasive Maneuver', icon: '🌀', category: 'defense', action: 'tactical',
    price: 140, max: 2, targeting: 'relocate',
    desc: 'Moves one undamaged ship to cells the enemy hasn\'t hit or scanned. Any intel they had on it is lost.',
  },
  {
    id: 'decoy', name: 'Decoy Ship', icon: '🎭', category: 'defense', action: 'deploy',
    price: 90, max: 2, targeting: 'deploy', deploySize: 2,
    desc: 'A fake 2-cell ship you place before the battle. Shots and scans treat it as real, but it doesn\'t count toward victory.',
  },
  {
    id: 'mine', name: 'Sea Mine', icon: '🧨', category: 'defense', action: 'deploy',
    price: 100, max: 3, targeting: 'deploy', deploySize: 1,
    desc: 'Hide a mine in an empty cell before the battle. If the enemy hits it, it explodes and hits a random part of their fleet.',
  },
  {
    id: 'flak', name: 'Flak Cannon', icon: '🎇', category: 'defense', action: 'passive',
    price: 130, max: 2, targeting: 'passive',
    desc: 'Automatically shoots down the next enemy plane (Bomber Run, Recon Plane or Commando Drop).',
  },
  {
    id: 'interceptor', name: 'Interceptor', icon: '🚀', category: 'defense', action: 'passive',
    price: 150, max: 2, targeting: 'passive',
    desc: 'Automatically intercepts the next enemy bomb or missile. Only the aimed cell is hit and special effects fail. Torpedoes slip underneath.',
  },
];

export const ITEM_MAP = Object.fromEntries(ITEMS.map((item) => [item.id, item]));

export const emptyInventory = () => Object.fromEntries(ITEMS.map((item) => [item.id, 0]));
