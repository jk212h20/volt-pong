// Full game stress test
const fs = require('fs');
const html = fs.readFileSync('index.html','utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
let code = m[1];

// Mock DOM/Canvas
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

globalThis.document = {
  getElementById: () => ({
    getContext: () => mockCtx,
    style: {},
    width: 540, height: 860,
    addEventListener() {}
  }),
  createElement: () => ({ getContext: () => mockCtx, style: {} }),
};
globalThis.window = {
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
globalThis.requestAnimationFrame = () => 0;

code += `
globalThis.__V = {
  startGame, update, processFx, updateVisuals, saveState, loadState,
  get balls() { return balls; },
  get pScore() { return pScore; },
  get aScore() { return aScore; },
  get state() { return state; },
  get gameTime() { return gameTime; },
  get tokens() { return tokens; },
  get particles() { return particles; },
  get shake() { return shake; },
  FIXED_DT,
};
`;

eval(code);
const V = globalThis.__V;

// Play multiple full games with different seeds
let totalGames = 0;
let allClean = true;

for (const seed of [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555]) {
  V.startGame(seed);
  let frames = 0;
  const maxFrames = 60 * 120; // 2 min max

  while (V.state === 'playing' && frames < maxFrames) {
    V.update(V.FIXED_DT);
    V.processFx();
    V.updateVisuals(V.FIXED_DT);
    frames++;
  }

  const duration = (frames / 60).toFixed(1);
  const ok = V.state === 'gameover' && frames < maxFrames;
  console.log(`Seed 0x${seed.toString(16).toUpperCase()}: ${duration}s  score ${V.pScore}-${V.aScore}  ${ok ? '✓' : '⚠'}`);
  if (!ok) allClean = false;
  totalGames++;
}

console.log(`\n${totalGames} games played. ${allClean ? '✅ All completed cleanly' : '❌ Issues detected'}`);
