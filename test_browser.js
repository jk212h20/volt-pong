// Real browser multiplayer test using Playwright
const { chromium } = require('playwright');
const path = require('path');

const GAME_URL = 'file://' + path.resolve(__dirname, 'index.html');

async function run() {
  console.log('=== Real Browser Multiplayer Test ===\n');

  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });
  
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const hostPage = await ctx1.newPage();
  const guestPage = await ctx2.newPage();

  // Collect console logs
  hostPage.on('console', msg => {
    const t = msg.text();
    if (t.includes('[MP]') || t.includes('offer') || t.includes('answer') || t.includes('ICE') || t.includes('DataChannel') || t.includes('Connection'))
      console.log('[HOST]', t);
  });
  guestPage.on('console', msg => {
    const t = msg.text();
    if (t.includes('[MP]') || t.includes('offer') || t.includes('answer') || t.includes('ICE') || t.includes('DataChannel') || t.includes('Connection'))
      console.log('[GUEST]', t);
  });
  hostPage.on('pageerror', err => console.log('[HOST ERROR]', err.message));
  guestPage.on('pageerror', err => console.log('[GUEST ERROR]', err.message));

  // Load both pages
  console.log('Loading game...');
  await hostPage.goto(GAME_URL);
  await guestPage.goto(GAME_URL);
  await hostPage.waitForTimeout(500);

  // HOST: Call showMpUI directly, then mpCreateRoom
  console.log('\n[HOST] Creating room...');
  await hostPage.evaluate(() => showMpUI('menu'));
  await hostPage.waitForTimeout(100);
  await hostPage.evaluate(() => mpCreateRoom());

  // Wait for room code
  let roomCode = null;
  for (let i = 0; i < 30; i++) {
    roomCode = await hostPage.evaluate(() => {
      const el = document.getElementById('mp-room-code');
      return el ? el.textContent : null;
    });
    if (roomCode && roomCode !== '----') break;
    await hostPage.waitForTimeout(200);
  }
  console.log('[HOST] Room code:', roomCode);

  if (!roomCode || roomCode === '----') {
    console.log('❌ Failed to get room code');
    await browser.close();
    process.exit(1);
  }

  // GUEST: Join room
  console.log('\n[GUEST] Joining room', roomCode, '...');
  await guestPage.evaluate(() => showMpUI('menu'));
  await guestPage.waitForTimeout(100);
  await guestPage.evaluate((code) => mpJoinRoom(code), roomCode);

  // Wait for connection
  console.log('\nWaiting for connection...\n');
  let connected = false;
  for (let i = 0; i < 150; i++) {
    const states = await Promise.all([
      hostPage.evaluate(() => ({
        state, mpConnected, gameMode,
        panel: (() => {
          for (const id of ['mp-menu','mp-host-waiting','mp-join-form','mp-connecting','mp-error']) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') return id;
          }
          return 'hidden';
        })(),
      })),
      guestPage.evaluate(() => ({
        state, mpConnected, gameMode,
        panel: (() => {
          for (const id of ['mp-menu','mp-host-waiting','mp-join-form','mp-connecting','mp-error']) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') return id;
          }
          return 'hidden';
        })(),
      })),
    ]);

    if (i % 10 === 0)
      console.log(`  ${(i*200)}ms: host=${states[0].state}/${states[0].panel}/${states[0].mpConnected}  guest=${states[1].state}/${states[1].panel}/${states[1].mpConnected}`);

    if (states[0].state === 'playing' && states[1].state === 'playing' &&
        states[0].mpConnected && states[1].mpConnected) {
      connected = true;
      break;
    }

    if (states[0].panel === 'mp-error' || states[1].panel === 'mp-error') {
      const errs = await Promise.all([
        hostPage.evaluate(() => document.getElementById('mp-error-msg')?.textContent || ''),
        guestPage.evaluate(() => document.getElementById('mp-error-msg')?.textContent || ''),
      ]);
      console.log('\n❌ Error:', errs[0] || errs[1]);
      break;
    }

    await hostPage.waitForTimeout(200);
  }

  if (connected) {
    console.log('\n✅ MULTIPLAYER CONNECTED IN REAL BROWSERS!');
    const hs = await hostPage.evaluate(() => ({ p: pScore, a: aScore, gt: gameTime }));
    const gs = await guestPage.evaluate(() => ({ p: pScore, a: aScore, gt: gameTime }));
    console.log('Host:   ', hs.p, '-', hs.a, 'time:', hs.gt.toFixed(2));
    console.log('Guest:  ', gs.p, '-', gs.a, 'time:', gs.gt.toFixed(2));
    console.log('Scores match:', hs.p === gs.p && hs.a === gs.a);
  } else {
    console.log('\n❌ FAILED TO CONNECT');
  }

  await browser.close();
  process.exit(connected ? 0 : 1);
}

run().catch(e => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
