// evil⁶⁶⁶MD — WhatsApp pairing portal (storm UI), hosted by Aiko
// Exact web UI from James's SEYORI panel; "connected" fixed to reflect real state.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const bridge = require('./panel-bridge.js');

const PORT = Number(process.env.PORT || 3001);
const LOG = (s) => { try { fs.appendFileSync(path.join(__dirname, 'boot.log'), new Date().toISOString() + ' ' + s + '\n'); } catch {} };
globalThis.__pairLog = LOG;

process.on('uncaughtException', e => { LOG('UNCAUGHT: ' + (e.stack || e)); });
process.on('unhandledRejection', e => { LOG('REJECT: ' + (e && (e.stack || e.message) || e)); });

const app = express();
app.use(express.json());

const state = { connected: false, qr: null, qrDataUrl: null, pairingCode: null, pairedFor: null, pairingIssuedAt: null, user: null, lastError: null, busy: false };

globalThis.__onPaired = (number, dir) => {
  state.connected = true;
  state.user = number;
  state.pairingCode = null;
  state.busy = false;
  LOG('paired ok: ' + number);
};

let panelCache = { code: null, status: 'waiting', at: 0 };
async function refreshPanel() {
  try {
    const log = await bridge.logTail();
    panelCache = { code: bridge.latestCode(log), status: bridge.latestStatus(log), at: Date.now() };
  } catch {}
}
setInterval(refreshPanel, 4000); refreshPanel();

app.get('/status', async (req, res) => {
  const st = {
    connected: panelCache.status === 'connected',
    pairingCode: panelCache.code,
    pairedFor: panelCache.code ? 'panel' : null,
    pairingIssuedAt: panelCache.at,
    busy: false,
    lastError: panelCache.status === 'failed' ? 'Pairing failed — summon again' : null,
  };
  // pairing codes live ~2 minutes — after that a reload/returning visit gets the
  // number form again instead of a dead code
  if (st.pairingCode && state.pairingIssuedAt && Date.now() - state.pairingIssuedAt > 115000) {
    st.pairingCode = null; st.pairedFor = null;
  }
  res.json(st);
});
app.get('/resetpair', (req, res) => { state.pairingCode = null; state.pairedFor = null; state.pairingIssuedAt = null; state.lastError = null; res.json({ ok: true }); });
app.get('/pair', async (req, res) => {
  LOG('[pair] hit for ' + req.query.number);
  const n = String(req.query.number || '').replace(/[^0-9]/g, '');
  if (!n || n.length < 7) return res.status(400).json({ error: 'Number with country code, e.g. 22873272569' });
  state.busy = true; state.lastError = null;
  // the PANEL bot generates the code: restart it so it requests a fresh code,
  // the code lands in its console log and /status picks it up
  bridge.restartServer().then(ok => {
    state.busy = false;
    LOG('[pair] panel restart ' + (ok ? 'ok' : 'failed') + ' for +' + n);
  }).catch(e => { state.busy = false; LOG('[pair] restart failed: ' + e.message); });
  res.json({ queued: true, number: n });
});
app.get('/health', (req, res) => res.json({ ok: true, connected: state.connected }));

app.get('/', (req, res) => { res.type('html'); res.set('Cache-Control', 'no-store, must-revalidate'); res.send(WEB_HTML); });

app.listen(PORT, '0.0.0.0', () => {
  LOG(`[web] evil⁶⁶⁶MD pair portal on :${PORT}`);
});

// eslint-disable-next-line no-undef
const WEB_HTML = require('./web-html.js');
