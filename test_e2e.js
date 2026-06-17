// End-to-end multiplayer test with trickle ICE through real signaling server
const WebSocket = require('ws');
const { RTCPeerConnection, RTCSessionDescription } = require('@koush/wrtc');
const fs = require('fs');

const SIGNALING_URL = 'ws://localhost:8080';
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let step = 0;
const log = (...a) => console.log(`[${step++}]`, ...a);

async function run() {
  log('Starting e2e test');

  // Connect both to signaling server
  const hostWs = new WebSocket(SIGNALING_URL);
  const guestWs = new WebSocket(SIGNALING_URL);
  await Promise.all([
    new Promise(r => hostWs.on('open', r)),
    new Promise(r => guestWs.on('open', r)),
  ]);
  log('Both connected to signaling server');

  // Host creates room
  let roomCode = null;
  hostWs.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'created') { roomCode = m.code; log('Host got room:', m.code); }
    if (m.type === 'peer_joined') { log('Host: guest joined'); startHostPC(); }
    if (m.type === 'relay') {
      if (m.data.kind === 'ice') {
        hostPc.addIceCandidate(m.data.data).catch(()=>{});
      } else if (m.data.kind === 'answer') {
        log('Host: got answer');
        hostPc.setRemoteDescription(new RTCSessionDescription(m.data.data)).catch(e=>log('Host setRemote err:',e.message));
      }
    }
  });

  hostWs.send(JSON.stringify({ type: 'create' }));
  while (!roomCode) await new Promise(r => setTimeout(r, 50));

  let hostPc, hostDc;
  let hostConnected = false;

  function startHostPC() {
    hostPc = new RTCPeerConnection(ICE);
    hostDc = hostPc.createDataChannel('game', { ordered: true });
    hostDc.onopen = () => { log('HOST DataChannel OPEN'); hostConnected = true; };
    hostPc.onicecandidate = e => {
      if (e.candidate) hostWs.send(JSON.stringify({ type:'relay', data:{ kind:'ice', data: { candidate: e.candidate.candidate, sdpMLineIndex: e.candidate.sdpMLineIndex, sdpMid: e.candidate.sdpMid } } }));
    };
    hostPc.onconnectionstatechange = () => log('Host PC state:', hostPc.connectionState);

    hostPc.createOffer()
      .then(o => hostPc.setLocalDescription(o))
      .then(() => {
        log('Host: sending offer');
        hostWs.send(JSON.stringify({ type:'relay', data:{ kind:'offer', data:{ sdp: hostPc.localDescription.sdp, type: hostPc.localDescription.type } } }));
      });
  }

  // Guest joins
  let guestPc, pendingCandidates = [], remoteDescSet = false;
  guestWs.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'joined') {
      log('Guest joined room');
      guestPc = new RTCPeerConnection(ICE);
      guestPc.ondatachannel = e => {
        log('Guest: DataChannel received');
        e.channel.onopen = () => log('GUEST DataChannel OPEN');
      };
      guestPc.onicecandidate = e => {
        if (e.candidate) guestWs.send(JSON.stringify({ type:'relay', data:{ kind:'ice', data: { candidate: e.candidate.candidate, sdpMLineIndex: e.candidate.sdpMLineIndex, sdpMid: e.candidate.sdpMid } } }));
      };
      guestPc.onconnectionstatechange = () => log('Guest PC state:', guestPc.connectionState);
    }
    if (m.type === 'relay') {
      if (m.data.kind === 'ice') {
        if (!remoteDescSet) { pendingCandidates.push(m.data.data); }
        else guestPc.addIceCandidate(m.data.data).catch(()=>{});
      } else if (m.data.kind === 'offer') {
        log('Guest: got offer');
        guestPc.setRemoteDescription(new RTCSessionDescription(m.data.data))
          .then(() => {
            remoteDescSet = true;
            for (const c of pendingCandidates) guestPc.addIceCandidate(c).catch(()=>{});
            pendingCandidates = [];
            return guestPc.createAnswer();
          })
          .then(a => guestPc.setLocalDescription(a))
          .then(() => {
            log('Guest: sending answer');
            guestWs.send(JSON.stringify({ type:'relay', data:{ kind:'answer', data:{ sdp: guestPc.localDescription.sdp, type: guestPc.localDescription.type } } }));
          });
      }
    }
  });

  log('Guest joining room', roomCode);
  guestWs.send(JSON.stringify({ type: 'join', code: roomCode }));

  // Wait for connection
  const start = Date.now();
  while (!hostConnected && Date.now() - start < 20000) {
    await new Promise(r => setTimeout(r, 100));
  }

  if (hostConnected) {
    log('✅ SUCCESS: DataChannel connected via trickle ICE');
  } else {
    log('❌ FAILED: DataChannel never opened');
    log('Host state:', hostPc ? hostPc.connectionState : 'null');
    log('Guest state:', guestPc ? guestPc.connectionState : 'null');
  }

  // Cleanup
  try { hostDc.close(); } catch(e) {}
  try { hostPc.close(); } catch(e) {}
  try { guestPc.close(); } catch(e) {}
  try { hostWs.close(); } catch(e) {}
  try { guestWs.close(); } catch(e) {}
  process.exit(hostConnected ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
