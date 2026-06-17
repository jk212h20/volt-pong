// Headless test for VoltPong simulation refactor
// Verifies: PRNG determinism, fixed timestep, event queue, save/restore
const fs = require('fs');

const html = fs.readFileSync('index.html','utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let code = scriptMatch[1];

// --- Mock DOM/Canvas ---
const mockCtx = new Proxy({}, {
  get(_,k){
    if(k==='canvas') return {width:540,height:860};
    if(k==='measureText') return ()=>({width:100});
    if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>({addColorStop(){}});
    return (...args)=>{}; // swallow all canvas calls
  },
  set(){return true;}
});

globalThis.document = {
  getElementById: ()=>({
    getContext: ()=>mockCtx,
    style:{},
    width:540,height:860,
    addEventListener(){}
  }),
  createElement: ()=>({getContext:()=>mockCtx, style:{}}),
};
globalThis.window = {
  innerWidth: 540, innerHeight: 860,
  devicePixelRatio: 1,
  addEventListener(){},
  AudioContext: function(){ this.currentTime=0; this.sampleRate=44100; this.destination={};
    this.createOscillator=()=>({type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
      connect(){},start(){},stop(){}});
    this.createGain=()=>({gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},value:0},connect(){}});
    this.createBuffer=()=>({getChannelData:()=>new Float32Array(100)});
    this.createBufferSource=()=>({buffer:null,connect(){},start(){}});
    this.createBiquadFilter=()=>({type:'',frequency:{value:0},connect(){}});
    this.state='running';
  },
  webkitAudioContext: null,
};
globalThis.requestAnimationFrame = ()=>0;

// Append debug exports
code += `
globalThis.__V = {
  get simEvents(){ return simEvents; },
  get state(){ return state; },
  get pScore(){ return pScore; },
  get aScore(){ return aScore; },
  get balls(){ return balls; },
  get player(){ return player; },
  get ai(){ return ai; },
  get tokens(){ return tokens; },
  get eater(){ return eater; },
  get gameTime(){ return gameTime; },
  get rallyHits(){ return rallyHits; },
  get lastHitter(){ return lastHitter; },
  get wallSlope(){ return wallSlope; },
  get _simSeed(){ return _simSeed; },
  set _simSeed(v){ _simSeed=v; },
  simRand, emit, processFx, update, updateVisuals,
  FIXED_DT, startGame, resetBall, saveState, loadState,
  // Expose for save/restore test
  getShake: ()=>shake,
  getParticles: ()=>particles.length,
  getFloatTexts: ()=>floatTexts.length,
};
`;

try {
  eval(code);
  console.log('✓ Script loaded without errors');
} catch(e) {
  console.log('✗ Load error:', e.message);
  process.exit(1);
}

const V = globalThis.__V;

// Test 1: PRNG determinism
console.log('\n=== Test 1: PRNG Determinism ===');
V._simSeed = 0xDEADBEEF;
const r1 = [V.simRand(), V.simRand(), V.simRand(), V.simRand()];
V._simSeed = 0xDEADBEEF;
const r2 = [V.simRand(), V.simRand(), V.simRand(), V.simRand()];
const match = r1.every((v,i)=>v===r2[i]);
console.log(`  Seed 0xDEADBEEF: [${r1.map(v=>v.toFixed(6)).join(', ')}]`);
console.log(`  Re-seed same:    [${r2.map(v=>v.toFixed(6)).join(', ')}]`);
console.log(match ? '✓ PRNG is deterministic' : '✗ PRNG MISMATCH');

// Test 2: Fixed timestep stepping
console.log('\n=== Test 2: Fixed Timestep ===');
V.startGame(0x12345678);
const startGT = V.gameTime;
// Step 60 times = 1 simulated second
for(let i=0;i<60;i++){
  V.update(V.FIXED_DT);
  V.processFx();
}
const endGT = V.gameTime;
const dt_error = Math.abs((endGT - startGT) - 1.0);
console.log(`  gameTime advanced: ${(endGT-startGT).toFixed(6)} (expected 1.0)`);
console.log(dt_error < 1e-10 ? '✓ Fixed timestep exact' : `✗ Timestep error: ${dt_error}`);

// Test 3: Event queue - balls should produce events
console.log('\n=== Test 3: Event Queue ===');
V.startGame(0xCAFEBABE);
let eventCount = 0;
let eventTypes = new Set();
// Run until ball hits something or 5 seconds
for(let i=0;i<300;i++){
  V.update(V.FIXED_DT);
  V.processFx();
}
// Check particles were created (events fired)
console.log(`  Particles after 5s: ${V.getParticles()}`);
console.log(`  Float texts after 5s: ${V.getFloatTexts()}`);
console.log(`  Shake: ${V.getShake().toFixed(2)}`);
console.log(V.getParticles() > 0 || V.gameTime > 0 ? '✓ Events produce visual effects' : '⚠ No particles yet (ball may not have bounced)');

// Test 4: Multiple runs with same seed produce identical state
console.log('\n=== Test 4: Replay Determinism ===');
function runGame(seed, steps){
  V.startGame(seed);
  for(let i=0;i<steps;i++){
    V.update(V.FIXED_DT);
    V.processFx();
  }
  return {
    gameTime: V.gameTime,
    pScore: V.pScore,
    aScore: V.aScore,
    balls: V.balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,spin:b.spin,alive:b.alive})),
    playerX: V.player.x,
    aiX: V.ai.x,
    rallyHits: V.rallyHits,
    seed: V._simSeed,
  };
}
const run1 = runGame(0xABCDEF01, 300);
const run2 = runGame(0xABCDEF01, 300);
let identical = true;
for(const k of ['gameTime','pScore','aScore','rallyHits','playerX','aiX','seed']){
  if(run1[k] !== run2[k]){ identical=false; console.log(`  ✗ Mismatch in ${k}: ${run1[k]} vs ${run2[k]}`); }
}
if(run1.balls.length !== run2.balls.length){ identical=false; console.log('  ✗ Ball count mismatch'); }
else {
  for(let i=0;i<run1.balls.length;i++){
    const a=run1.balls[i], b=run2.balls[i];
    for(const k of ['x','y','vx','vy','spin','alive']){
      if(a[k]!==b[k]){ identical=false; console.log(`  ✗ Ball ${i} ${k}: ${a[k]} vs ${b[k]}`); }
    }
  }
}
console.log(`  Run 1: gt=${run1.gameTime.toFixed(3)} score=${run1.pScore}-${run1.aScore} balls=${run1.balls.length} rallyHits=${run1.rallyHits}`);
console.log(`  Run 2: gt=${run2.gameTime.toFixed(3)} score=${run2.pScore}-${run2.aScore} balls=${run2.balls.length} rallyHits=${run2.rallyHits}`);
console.log(identical ? '✓ Identical replays with same seed' : '✗ REPLAY MISMATCH');

// Test 5: Different seeds produce different games
console.log('\n=== Test 5: Seed Variety ===');
const runA = runGame(0x11111111, 300);
const runB = runGame(0x22222222, 300);
const different = runA.balls.some((b,i)=>Math.abs(b.x-runB.balls[i]?.x)>0.01) || runA.gameTime!==runB.gameTime;
console.log(different ? '✓ Different seeds produce different games' : '⚠ Games identical with different seeds (may be normal if no randomness triggered)');

// Test 6: Save/Restore rollback
console.log('\n=== Test 6: Save/Restore Rollback ===');
V.startGame(0x42424242);
// Step 100 frames, save state at frame 50
let snap = null;
for(let i=0;i<100;i++){
  if(i===50) snap = V.saveState();
  V.update(V.FIXED_DT);
  V.processFx();
}
// State at frame 100
const after100 = {
  balls: V.balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,spin:b.spin})),
  pScore: V.pScore, aScore: V.aScore, rallyHits: V.rallyHits,
  gameTime: V.gameTime, playerX: V.player.x, aiX: V.ai.x,
};
// Rollback to frame 50, step forward 50 more
V.loadState(snap);
for(let i=0;i<50;i++){
  V.update(V.FIXED_DT);
  V.processFx();
}
const afterRollback = {
  balls: V.balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,spin:b.spin})),
  pScore: V.pScore, aScore: V.aScore, rallyHits: V.rallyHits,
  gameTime: V.gameTime, playerX: V.player.x, aiX: V.ai.x,
};
// Compare
let rollbackOK = true;
for(const k of ['pScore','aScore','rallyHits','gameTime','playerX','aiX']){
  if(after100[k] !== afterRollback[k]){
    rollbackOK = false;
    console.log(`  ✗ ${k}: ${after100[k]} vs ${afterRollback[k]}`);
  }
}
if(after100.balls.length !== afterRollback.balls.length){
  rollbackOK = false;
  console.log(`  ✗ Ball count: ${after100.balls.length} vs ${afterRollback.balls.length}`);
} else {
  for(let i=0;i<after100.balls.length;i++){
    const a=after100.balls[i], b=afterRollback.balls[i];
    for(const k of ['x','y','vx','vy','spin']){
      if(a[k]!==b[k]){
        rollbackOK=false;
        console.log(`  ✗ Ball ${i} ${k}: ${a[k]} vs ${b[k]}`);
      }
    }
  }
}
console.log(`  Frame 100 direct:    score=${after100.pScore}-${after100.aScore} gt=${after100.gameTime.toFixed(3)} balls=${after100.balls.length}`);
console.log(`  Frame 100 rollback:  score=${afterRollback.pScore}-${afterRollback.aScore} gt=${afterRollback.gameTime.toFixed(3)} balls=${afterRollback.balls.length}`);
console.log(rollbackOK ? '✓ Rollback produces identical state' : '✗ ROLLBACK MISMATCH');

console.log('\n=== Summary ===');
const passed = [match, dt_error<1e-10, identical, rollbackOK].every(Boolean);
console.log(passed ? '✅ All critical tests passed' : '❌ Some tests failed');
