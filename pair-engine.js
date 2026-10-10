// evil666MD pair engine — ported from working DEV-Baileys setup
// Uses the DEV fork's fixed-code pairing + 515/408 reconnect handling
const path = require('path');
const fs = require('fs');

let baileys;
try { baileys = require('@whiskeysockets/baileys'); } catch (e) { baileys = null; }

function lg(s) { try { fs.appendFileSync(path.join(__dirname, 'boot.log'), new Date().toISOString().slice(11,19) + ' ' + s + '\n'); } catch (_) {} }
globalThis.__pairLog = lg;

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const pending = new Map(); // number -> entry {sock, code, open, error, retries, timer}

function getSessionDir(num) { return path.join(SESSIONS_DIR, num); }

function killPending(num) {
    const e = pending.get(num);
    if (e) { try { e.sock?.end?.(); } catch {} try { e.sock?.ev?.removeAllListeners?.(); } catch {} pending.delete(num); if (e.timer) clearTimeout(e.timer); }
}

async function pairCode(number, timeoutMs = 120000) {
    const clean = String(number).replace(/[^0-9]/g, '');
    if (!clean || clean.length < 7) throw new Error('bad_number');

    killPending(clean);
    // always clean auth state on a new pair request
    try { fs.rmSync(getSessionDir(clean), { recursive: true, force: true }); } catch {}

    const dir = getSessionDir(clean);
    const { state: auth, saveCreds } = await baileys.useMultiFileAuthState(dir);
    // stale versions get 405 client_too_old — sanity-check and pin the live one
    let version = [2, 3000, 1049203729];
    try {
        const v = (await baileys.fetchLatestWaWebVersion({})).version;
        if (v && v[2] > 1000000000) version = v;
    } catch (e) { lg('live version fetch failed, using pinned'); }
    lg('WA version: ' + version.join('.'));

    const entry = { sock: null, code: null, open: false, error: null, retries: 0, timer: null };
    pending.set(clean, entry);

    // WhatsApp sends 515 (restartRequired) right after a pairing code is requested.
    // Pairing only completes once we RECONNECT with the same auth state.
    // Same for 408 (connection lost) while the user is entering the code.
    const RECONNECTABLE = new Set([515, 408, 428, 440]);
    let connecting = false;

    const connect = () => {
        if (connecting) return;
        connecting = true;
        lg('connect() for ' + clean);
        const sock = baileys.makeWASocket({
            logger: { level:'silent', child(){return this}, info(){}, debug(){}, trace(){}, warn(){}, error(){} },
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            auth: { creds: auth.creds, keys: auth.keys },
            version,
            getMessage: async () => ({})
        });
        entry.sock = sock;
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect, qr } = u;
            if (qr && !entry.code) {
                try { entry.code = await sock.requestPairingCode(clean); lg('code for ' + clean + ': ' + entry.code); }
                catch (e) { entry.error = e.message; lg('code req failed: ' + e.message); }
            }
            if (connection === 'open') {
                entry.open = true;
                lg('connected for ' + clean + ' — pairing complete');
                if (entry.timer) clearTimeout(entry.timer);
                pending.delete(clean);
                try { sock.end(); } catch {}
                // hand off to session manager (index.js will pick it up)
                if (globalThis.__onPaired) globalThis.__onPaired(clean, dir);
            }
            if (connection === 'close') {
                const dc = lastDisconnect?.error?.output?.statusCode;
                connecting = false;
                if (entry.open) return;
                if (RECONNECTABLE.has(dc) && entry.retries < 6) {
                    entry.retries++;
                    lg('reconnecting pair for ' + clean + ' (dc=' + dc + ', try ' + entry.retries + ')');
                    setTimeout(connect, 1500);
                } else {
                    lg('pair session closed for ' + clean + ' dc=' + dc);
                    if (entry.timer) clearTimeout(entry.timer);
                    pending.delete(clean);
                    try { sock.end(); } catch {}
                }
            }
        });
    };

    connect();

    // wait up to timeoutMs for the pairing code
    for (let i = 0; i < timeoutMs / 500; i++) {
        if (entry.code || entry.error) break;
        await new Promise(r => setTimeout(r, 500));
    }
    if (entry.error) { killPending(clean); throw new Error(entry.error); }
    if (!entry.code) { killPending(clean); throw new Error('Timed out requesting code — try again'); }

    // keep the reconnect loop alive while the user enters the code
    entry.timer = setTimeout(() => { killPending(clean); lg('pair timeout for ' + clean); }, timeoutMs + 120000);
    return { code: entry.code, number: clean };
}

function getPendingCode(number) {
    const clean = String(number).replace(/[^0-9]/g, '');
    const e = pending.get(clean);
    return e && e.code ? e.code : null;
}

module.exports = { pairCode, getPendingCode, killPending, getSessionDir, SESSIONS_DIR };
