# VOLT — Spin Pong

Real spin physics pong with multiplayer netcode. Single self-contained HTML file + a tiny signaling server for online play.

## Quick Start (Single Player)

Open `index.html` in any modern browser. That's it.

## Online Multiplayer

Multiplayer uses WebRTC (peer-to-peer, no game server) + a tiny WebSocket signaling server for matchmaking.

### 1. Start the signaling server

```bash
cd server
npm install
npm start
# Runs on ws://localhost:8080
```

### 2. Configure the client

In `index.html`, find this line and point it at your server:

```js
const SIGNALING_URL = 'ws://localhost:8080';
```

For production, deploy the signaling server to a host (Render, Railway, Fly.io, etc.) and use `wss://your-server.com`.

### 3. Play

1. Open `index.html` in two browsers (or share the URL with a friend)
2. Player 1: tap **2 PLAYER ONLINE** → **CREATE GAME** → gets a 4-letter code
3. Player 2: tap **2 PLAYER ONLINE** → **JOIN GAME** → enters the code
4. Connected! Host picks the seed, both sides run identical simulations.

### Connection details

- **STUN servers**: Google public STUN (NAT discovery)
- **TURN servers**: OpenRelay free TURN (fallback for restrictive NATs)
- **ICE candidates**: trickled via the signaling relay
- **DataChannel**: ordered, reliable (TCP-like)

## Architecture

### Deterministic simulation
- **Seeded PRNG** (mulberry32): All physics-affecting randomness is deterministic
- **Fixed timestep** (1/60s): Physics decoupled from render framerate via accumulator
- **Event queue**: Side effects (sound, particles, shake) separated from pure simulation

### Lockstep netcode
- **Input delay**: 4 frames (~66ms). Both peers send inputs, apply them 4 frames later
- **Stall-on-missing**: If remote input hasn't arrived, simulation pauses (never desyncs)
- **Local prediction**: Player's paddle renders at live input position, not delayed sim position
- **No rollback needed**: We never simulate with unconfirmed remote inputs

### Signaling protocol
```
Client → Server              Server → Client
─────────────────────────────────────────────
{ type:'create' }        →   { type:'created', code:'ABCD' }
{ type:'join', code }    →   { type:'joined', code }
                             { type:'peer_joined' }      (to host)
{ type:'relay', data }   →   { type:'relay', data }      (forwarded to peer)
```

Relay data contains WebRTC SDP offers/answers and ICE candidates — the server never inspects them, just passes them through.

## Files

```
VoltPong/
├── index.html          # The entire game (physics, rendering, multiplayer client)
├── server/
│   ├── signaling.js    # WebSocket signaling server (~130 lines)
│   └── package.json
├── test_sim.js         # PRNG, fixed timestep, replay, rollback tests
├── test_stress.js      # Full-game stress tests
└── test_twopeer.js     # Two-peer synchronization test
```

## Run Tests

```bash
node test_sim.js        # Core simulation correctness
node test_stress.js     # Full games to completion
node test_twopeer.js    # Two-peer lockstep sync verification
```

## Controls

- **Mouse/Touch**: Move paddle horizontally
- **Keyboard**: A/D or ←/→ to move, Q/W/E/R for abilities, P to pause
- **Abilities**: GROW (bigger paddle), SLOW (decelerate incoming ball), SPLIT (trail ball), MOVE (relocate energy eater)
