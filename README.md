# ⚓ Fleet Fury

Online 1v1 battleships with an arsenal: nukes, bombers, torpedoes, sonar, sea mines, shields, decoys and more.
Play with a friend in a private room using a 5-letter code.

## How a match works

- **Best of 3 / 5 / 7 rounds** (the host chooses when creating the room, along with the board size, starting coins and an optional turn timer).
- **Every round:** Armory (buy phase) → deploy your fleet (+ decoys and mines) → battle.
- **Your turn:** use up to one *tactical* item (intel or defense), then make one *attack*: a free standard shot or an attack item.
- **Coins:** +10 per hit and +30 per sink. Winning a round pays +200; losing pays +150, plus 50 more for each loss in a row (up to 300). Coins are paid out at the end of the round, and unused items carry over.

### The 21 items

| Bombs & Missiles | Air Force | Intel | Defense |
|---|---|---|---|
| 💣 Cluster Bomb (3×3) | ✈️ Bomber Run (whole row/column) | 🐬 Sonar Ping (counts parts in 5×5) | 🛡️ Energy Shield (blocks 2 hits) |
| ☢️ Mega Nuke (5×5) | 🛩️ Recon Plane (reveals row/column) | 📡 Radar Scan (reveals 3×3) | 🔧 Repair Kit (fixes a part, puts out fire) |
| ➕ Cross Missile (+ shape) | 🪂 Commando Drop (reveals a whole ship) | 🛰️ Spy Satellite (marks 3 ships) | 🌀 Evasive Maneuver (move a ship) |
| 🎯 Seeker Missile (homing) | | | 🎭 Decoy Ship (fake ship) |
| 🦈 Torpedo (first ship in a lane) | | | 🧨 Sea Mine (hits back) |
| 🔥 Napalm Shell (fire spreads) | | | 🎇 Flak Cannon (shoots down planes) |
| ⚡ Chain Lightning (arcs through a ship) | | | 🚀 Interceptor (stops missiles) |
| 🎆 Rocket Salvo (3 free shots) | | | |

The full rules and item details are in the in-game **How to play** screen.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # rules tests + a full two-player match over WebSockets
```

To test alone, open the game in two different browsers (or one normal and one private window).

## Deploy on Render (free)

1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com): **New → Blueprint**, then pick the repository. Render reads `render.yaml` and creates a free web service.
   (Or use **New → Web Service** with build command `npm ci --omit=dev`, start command `npm start` and instance type **Free**.)
3. Open your `https://<name>.onrender.com` URL, create a room and send your friend the code or the invite link.

Note: free Render services go to sleep after 15 minutes without visitors, so the first visit after that takes about a minute to load.
While a game is open, the page pings the server so it stays awake. Rooms live in memory and are lost when the service restarts or redeploys.

## Project layout

- `server/` – Express + Socket.IO server (`index.js`), rooms and match flow (`room.js`), battle rules and items (`game.js`)
- `shared/` – item catalog, board geometry and settings, used by both the server and the browser
- `public/` – the web client (plain HTML/CSS/JS modules, no build step)
- `test/` – unit tests and an end-to-end match test
