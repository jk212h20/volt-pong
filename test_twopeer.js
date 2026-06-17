// Headless two-peer simulation test
// Simulates two independent game instances exchanging inputs programmatically,
// verifying they stay perfectly in sync.
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let code = scriptMatch[1];

// --- Mock DOM/Canvas (same as test_sim.js) ---
const mockCtx = new Proxy({}, {
  get(_, k) {
    if (k === 'canvas') return { width: 540, height: 860 };
    if (k === 'measureText') return () => ({ width: 100 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient')
      return () => ({ addColorStop() {} });
    return (...a) => {};
  },
  set() { return true; }
});

function makeDOM() {
  return {
    getElementById: () => ({
      getContext: () => mockCtx,
      style: {},
      width: 540, height: 860,
      addEventListener() {},
      value: '',
    }),
    createElement: () => ({ getContext: () => mockCtx, style: {} }),
  };
}

function makeWindow() {
  return {
    innerWidth: 540, innerHeight: 860,
    devicePixelRatio: 1,
    addEventListener() {},
    AudioContext: function() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
      this.createOscillator = () => ({
        type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, start() {}, stop() {}
      });
      this.createGain = () => ({
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 },
        connect() {}
      });
      this.createBuffer = () => ({ getChannelData: () => new Float32Array(100) });
      this.createBufferSource = () => ({ buffer: null, connect() {}, start() {} });
      this.createBiquadFilter = () => ({ type: '', frequency: { value: 0 }, connect() {} });
      this.state = 'running';
    },
    webkitAudioContext: null,
  };
}

// Create two isolated game instances using Node VM
const vm = require('vm');

function createPeer(name) {
  const sandbox = {
    document: makeDOM(),
    window: makeWindow(),
    requestAnimationFrame: () => 0,
    RTCPeerConnection: function() {},
    btoa: (s) => Buffer.from(s).toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
    console: console,
    Math: Math,
    Date: Date,
    JSON: JSON,
    setTimeout: setTimeout,
    navigator: { clipboard: { writeText() {} } },
  };
  sandbox.globalThis = sandbox;

  // Add exports
  const exportCode = `
    globalThis.__V = {
      get state() { return state; },
      get pScore() { return pScore; },
      get aScore() { return aScore; },
      get balls() { return balls; },
      get gameTime() { return gameTime; },
      get player() { return player; },
      get ai() { return ai; },
      get tokens() { return tokens; },
      get rallyHits() { return rallyHits; },
      get mpFrame() { return mpFrame; },
      FIXED_DT, gameMode, mpConnected,
      startGame, startMultiplayerGame, update, processFx,
      captureLocalInput, mpPlayerInput, mpRemoteInput,
      mpLocalInputs, mpRemoteInputs, MP_INPUT_DELAY,
      input, saveState,
      // Simulate stepping one multiplayer frame
      stepMulti: null,
      // Set remote input for a frame
      setRemoteInput: null,
    };
  `;

  vm.createContext(sandbox);
  vm.runInContext(code + exportCode, sandbox);

  const V = sandbox.__V;

  // Set up multiplayer step helpers
  V.stepMulti = function(frameNum) {
    // Capture local input and store for frame+DELAY
    const localIn = V.captureLocalInput();
    V.mpLocalInputs[frameNum + V.MP_INPUT_DELAY] = localIn;

    // Get inputs for this frame
    const playerIn = V.mpLocalInputs[frameNum];
    const remoteIn = V.mpRemoteInputs[frameNum];
    if (!playerIn || !remoteIn) return false; // stalled

    V.mpPlayerInput.paddleX = playerIn.paddleX;
    V.mpPlayerInput.ability = playerIn.ability;
    V.mpRemoteInput.paddleX = remoteIn.paddleX;
    V.mpRemoteInput.ability = remoteIn.ability;

    V.update(V.FIXED_DT);
    V.processFx();
    return true;
  };

  V.setRemoteInput = function(frameNum, inp) {
    V.mpRemoteInputs[frameNum] = inp;
  };

  return V;
}

console.log('=== Two-Peer Synchronization Test ===\n');

// Create two peers
const host = createPeer('host');
const guest = createPeer('guest');

// Initialize multiplayer mode on both
host.gameMode = 'host';
host.mpConnected = true;
guest.gameMode = 'guest';
guest.mpConnected = true;

// Host generates seed, both start with same seed
const SEED = 0xDECAFBAD;
host.startMultiplayerGame(SEED);
guest.startMultiplayerGame(SEED);

// Simulate 600 frames (10 seconds) with input exchange
// Both peers move their paddles randomly
let stalls = 0;
let mismatches = 0;
const TOTAL_FRAMES = 600;

// Pre-seed initial inputs for frames 1..DELAY (so first DELAY frames have inputs)
for (let f = 1; f <= host.MP_INPUT_DELAY; f++) {
  host.mpLocalInputs[f] = { paddleX: W_DEFAULT(), ability: null };
  guest.mpLocalInputs[f] = { paddleX: W_DEFAULT(), ability: null };
  // Exchange: host's local becomes guest's remote and vice versa
  host.mpRemoteInputs[f] = guest.mpLocalInputs[f];
  guest.mpRemoteInputs[f] = host.mpLocalInputs[f];
}

function W_DEFAULT() { return 270; } // W/2

// Now simulate
let frame = 1;
for (; frame <= TOTAL_FRAMES; frame++) {
  // Each peer captures its local input (already pre-seeded for first DELAY frames)
  if (frame > host.MP_INPUT_DELAY) {
    // Set local input for this frame
    host.mpLocalInputs[frame] = { paddleX: 200 + 100*Math.sin(frame*0.05), ability: null };
    guest.mpLocalInputs[frame] = { paddleX: 300 + 80*Math.cos(frame*0.07), ability: null };
  }

  // Exchange inputs (host's local → guest's remote, etc.)
  // Input for frame F is sent at frame F-DELAY, so it should already be available
  // Simulate network: host sends its localInput[F], guest receives as remoteInput[F]
  const hostInF = host.mpLocalInputs[frame];
  const guestInF = guest.mpLocalInputs[frame];

  if (hostInF) guest.setRemoteInput(frame, hostInF);
  if (guestInF) host.setRemoteInput(frame, guestInF);

  // Both peers step
  const hostOK = host.stepMulti(frame);
  const guestOK = guest.stepMulti(frame);

  if (!hostOK || !guestOK) {
    stalls++;
    frame--; // retry this frame next iteration
    if (stalls > 100) { console.log('Too many stalls at frame', frame); break; }
    continue;
  }

  // Verify sync every frame
  const hBalls = host.balls;
  const gBalls = guest.balls;

  if (hBalls.length !== gBalls.length) {
    console.log(`✗ Frame ${frame}: ball count mismatch ${hBalls.length} vs ${gBalls.length}`);
    mismatches++;
    break;
  }

  for (let i = 0; i < hBalls.length; i++) {
    const hb = hBalls[i], gb = gBalls[i];
    for (const k of ['x', 'y', 'vx', 'vy', 'spin']) {
      if (Math.abs(hb[k] - gb[k]) > 0.001) {
        console.log(`✗ Frame ${frame} Ball ${i} ${k}: host=${hb[k].toFixed(6)} guest=${gb[k].toFixed(6)}`);
        mismatches++;
        break;
      }
    }
  }

  // Check scores
  if (host.pScore !== guest.pScore || host.aScore !== guest.aScore) {
    console.log(`✗ Frame ${frame}: score mismatch ${host.pScore}-${host.aScore} vs ${guest.pScore}-${guest.aScore}`);
    mismatches++;
    break;
  }

  // Check gameTime
  if (Math.abs(host.gameTime - guest.gameTime) > 1e-10) {
    console.log(`✗ Frame ${frame}: gameTime mismatch ${host.gameTime} vs ${guest.gameTime}`);
    mismatches++;
    break;
  }

  if (host.state !== 'playing') break;
}

console.log(`Simulated ${frame} frames (${(frame/60).toFixed(1)}s)`);
console.log(`Stalls: ${stalls}`);
console.log(`Mismatches: ${mismatches}`);
console.log(`Final: host score ${host.pScore}-${host.aScore}, guest score ${guest.pScore}-${guest.aScore}`);
console.log(`Host state: ${host.state}, Guest state: ${guest.state}`);
console.log(`Host balls: ${host.balls.length}, Guest balls: ${guest.balls.length}`);

// Detailed state comparison
if (mismatches === 0) {
  console.log('\n✅ Both peers stayed in perfect sync!');
} else {
  console.log('\n❌ Peers desynced!');
  // Show detailed diff
  const hs = host.saveState();
  const gs = guest.saveState();
  for (const k of ['pScore','aScore','gameTime','rallyHits']) {
    if (hs[k] !== gs[k]) console.log(`  ${k}: host=${hs[k]} guest=${gs[k]}`);
  }
}
