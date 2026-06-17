// Real browser multiplayer test — two pages in same browser context
const { chromium } = require('playwright');
const path = require('path');

const GAME_URL = 'file://' + path.resolve(__dirname, 'index.html');

async function run() {
  console.log('=== Real Browser Multiplayer Test ===\n');

  const browser = await chromium.launch({ 
    headless: false,  // headful for real WebRTC
    args: ['--use-fake-ui-for-media-stream']
  });
  
  // Single context, two pages — shares the network stack, local ICE works
  const hostPage = await browser.newPage();
  const guestPage = await browser.newPage();

  hostPage.on('console', msg => {
    const t = msg.text();
    if (t.includes('[MP]'))
      console.log('[HOST]', t);
  });
  guestPage.on('console', msg => {
    const t = msg.text();
    if (t.includes('[MP]'))
      console.log('[GUEST]', t);
  });
  hostPage.on('pageerror', err => console.log('[HOST ERROR]', err.message));
  guestPage.on('pageerror', err => console.log('[GUEST ERROR]', err.message));

  console.log('Loading game...');
  await hostPage.goto(GAME_URL);
  await guestPage.goto(GAME_URL);
  await hostPage.waitForTimeout(500);

  // HOST: Create room
  console.log('\n[HOST] Creating room...');
  await hostPage.evaluate(() => mpCreateRoom());

  let roomCode = null;
  for (let i = 0; i < 30; i++) {
    roomCode = await hostPage.evaluate(() => document.getElementById('mp-room-code')?.textContent);
    if (roomCode && roomCode !== '----') break;
    await hostPage.waitForTimeout(200);
  }
  console.log('[HOST] Room code:', roomCode);

  // GUEST: Join
  console.log('[GUEST] Joining room', roomCode, '...');
  await guestPage.evaluate((code) => mpJoinRoom(code), roomCode);

  console.log('\nWaiting for connection...\n');
  let connected = false;
  for (let i = 0; i < 150; i++) {
    const [hs, gs] = await Promise.all([
      hostPage.evaluate(() => ({
        state, mpConnected,
        panel: (() => {
          for (const id of ['mp-menu','mp-host-waiting','mp-join-form','mp-connecting','mp-error']) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') return id;
          }
          return 'hidden';
        })(),
      })),
      guestPage.evaluate(() => ({
        state, mpConnected,
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
      console.log(`  ${(i*200)}ms: host=${hs.state}/${hs.mpConnected}  guest=${gs.state}/${gs.mpConnected}`);

    if (hs.state === 'playing' && gs.state === 'playing' && hs.mpConnected && gs.mpConnected) {
      connected = true;
      break;
    }

    if (hs.panel === 'mp-error' || gs.panel === 'mp-error') {
      const errs = await Promise.all([
        hostPage.evaluate(() => document.getElementById('mp-error-msg')?.textContent || ''),
        guestPage.evaluate(() => document.getElementById('mp-error-msg')?.textContent || ''),
      ]);
      console.log('Error overlay:', errs[0] || errs[1]);
      break;
    }

    await hostPage.waitForTimeout(200);
  }

  if (connected) {
    console.log('\n✅ MULTIPLAYER CONNECTED!');
    await hostPage.waitForTimeout(1000);
    const h = await hostPage.evaluate(() => ({ p: pScore, a: aScore }));
    const g = await guestPage.evaluate(() => ({ p: pScore, a: aScore }));
    console.log('Host:', h.p, '-', h.a, '  Guest:', g.p, '-', g.a);
  } else {
    console.log('\n❌ FAILED');
  }

  await browser.close();
  process.exit(connected ? 0 : 1);
}

run().catch(e => {
  console.error('Crashed:', e.message);
  process.exit(1);
});
