/* =====================================================================
   VOLT Spin Pong — Signaling Server
   =====================================================================
   Tiny WebSocket server that handles room-code matchmaking.
   Peers exchange WebRTC SDP offers/answers through this server,
   then connect directly P2P via WebRTC DataChannel.

   Usage:
     npm install
     npm start
     # Runs on port 8080 (override with PORT env var)
   ===================================================================== */

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Room storage: code → { host: ws, guest: ws }
const rooms = {};
// Reverse lookup: ws → roomCode
const wsRooms = new WeakMap();

// Generate a 4-letter room code (A-Z, no ambiguous I/O)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function genCode() {
  let code = '';
  for (let i = 0; i < 4; i++)
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// Clean up a room when a peer leaves
function cleanupRoom(ws) {
  const code = wsRooms.get(ws);
  if (!code || !rooms[code]) return;

  const room = rooms[code];
  const other = (room.host === ws) ? room.guest : room.host;

  // Notify the other peer
  if (other && other.readyState === WebSocket.OPEN) {
    other.send(JSON.stringify({ type: 'peer_left' }));
  }

  // Remove the room
  delete rooms[code];
  wsRooms.delete(ws);
}

wss.on('connection', (ws) => {
  console.log(`[+] Client connected (total: ${wss.clients.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) {
      ws.send(JSON.stringify({ type: 'error', msg: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {

      // ---- Host creates a room ----
      case 'create': {
        const code = genCode();
        rooms[code] = { host: ws, guest: null };
        wsRooms.set(ws, code);
        console.log(`[ROOM] Created ${code}`);
        ws.send(JSON.stringify({ type: 'created', code }));
        break;
      }

      // ---- Guest joins a room ----
      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms[code];
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' }));
          return;
        }
        if (room.guest) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
          return;
        }
        room.guest = ws;
        wsRooms.set(ws, code);
        console.log(`[ROOM] Guest joined ${code}`);
        ws.send(JSON.stringify({ type: 'joined', code }));
        // Tell host to start the WebRTC handshake
        room.host.send(JSON.stringify({ type: 'peer_joined' }));
        break;
      }

      // ---- Relay SDP/ICE to the other peer (opaque passthrough) ----
      case 'relay': {
        const code = wsRooms.get(ws);
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        const other = (room.host === ws) ? room.guest : room.host;
        if (other && other.readyState === WebSocket.OPEN) {
          other.send(JSON.stringify({ type: 'relay', data: msg.data }));
        }
        break;
      }

      // ---- Leave room ----
      case 'leave': {
        cleanupRoom(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected (total: ${wss.clients.size - 1})`);
    cleanupRoom(ws);
  });

  ws.on('error', (e) => {
    console.log(`[!] Client error: ${e.message}`);
    cleanupRoom(ws);
  });
});

console.log(`VOLT signaling server running on port ${PORT}`);
console.log(`  ws://localhost:${PORT}`);
