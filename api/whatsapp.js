const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}
const QRCode = require('qrcode');
const pino = require('pino');
const {
    getBaileys,
    useSupabaseAuthState,
    clearSupabaseAuth
} = require('../supabase-baileys-auth');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uhwadjswtcdarhidvqxr.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_miv4XL14Dlnc54TO_8ebiQ_4WeAVDzq';

let cachedVersion = null;

async function getBaileysVersion() {
    if (cachedVersion) return cachedVersion;
    try {
        const { fetchLatestBaileysVersion } = await getBaileys();
        const latest = await Promise.race([
            fetchLatestBaileysVersion(),
            new Promise(r => setTimeout(() => r(null), 2000))
        ]);
        if (latest && latest.version) {
            cachedVersion = latest.version;
            return cachedVersion;
        }
    } catch (e) { }
    return [2, 3000, 1015901307];
}

function normalizeArgPhoneDigits(rawPhone) {
    if (!rawPhone) return '';
    let digits = String(rawPhone).replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length === 10) {
        digits = '549' + digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
        digits = '549' + digits.substring(1);
    } else if (digits.length === 12 && digits.startsWith('54') && !digits.startsWith('549')) {
        digits = '549' + digits.substring(2);
    }
    return digits;
}

async function resolveWhatsAppJid(sock, rawPhone, senderPhone) {
    const digits = normalizeArgPhoneDigits(rawPhone);
    if (!digits) return null;
    if (senderPhone && (digits === senderPhone || digits.replace(/^549/, '54') === senderPhone.replace(/^549/, '54'))) {
        return `${senderPhone}@s.whatsapp.net`;
    }
    try {
        const candidates = [digits];
        if (digits.startsWith('549') && digits.length === 13) {
            candidates.push('54' + digits.substring(3));
        }
        for (const candidate of candidates) {
            const results = await sock.onWhatsApp(candidate);
            if (Array.isArray(results) && results.length > 0 && results[0].exists && results[0].jid) {
                return results[0].jid;
            }
        }
    } catch (e) { }
    return `${digits}@s.whatsapp.net`;
}

async function getEngineStateFromSupabase() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.whatsappEngineState&select=value`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        if (!res.ok) return null;
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].value) {
            return rows[0].value;
        }
    } catch (e) { }
    return null;
}

async function saveEngineStateToSupabase(stateObj) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                key: 'whatsappEngineState',
                value: {
                    ...stateObj,
                    heartbeatAt: Date.now()
                },
                updated_at: new Date().toISOString()
            })
        });
    } catch (e) { }
}

async function clearCloudOutbox() {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                key: 'whatsappOutbox',
                value: { messages: [], resetRequest: null, restartRequest: null },
                updated_at: new Date().toISOString()
            })
        });
    } catch (e) { }
}

async function runCloudPairingSession(waitScanMs = 45000) {
    const { default: makeWASocket, DisconnectReason } = await getBaileys();
    const version = await getBaileysVersion();
    const { state, saveCreds, flushSave } = await useSupabaseAuthState();

    return new Promise((resolve) => {
        let currentSock = null;
        let finished = false;
        let lastQrDataUrl = null;

        const finish = async (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(overallTimer);
            if (currentSock) {
                try { currentSock.ev.removeAllListeners(); } catch (e) { }
                try { currentSock.ws.close(); } catch (e) { }
                currentSock = null;
            }
            try { await flushSave(); } catch (e) { }
            resolve(result);
        };

        const overallTimer = setTimeout(() => {
            finish({
                status: lastQrDataUrl ? 'qr' : 'connecting',
                qrDataUrl: lastQrDataUrl,
                mode: 'serverless',
                heartbeatAt: Date.now()
            });
        }, waitScanMs);

        const connectSocket = () => {
            if (finished) return;
            if (currentSock) {
                try { currentSock.ev.removeAllListeners(); } catch (e) { }
                try { currentSock.ws.close(); } catch (e) { }
            }

            const sock = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: ['JF 3D Studio', 'Chrome', '1.0.0'],
                syncFullHistory: false,
                markOnlineOnConnect: false
            });
            currentSock = sock;

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                if (finished || sock !== currentSock) return;
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        lastQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 260 });
                        await saveEngineStateToSupabase({
                            status: 'qr',
                            qrDataUrl: lastQrDataUrl,
                            userPhone: null,
                            userName: null,
                            mode: 'serverless'
                        });
                        if (waitScanMs <= 8500) {
                            return finish({
                                status: 'qr',
                                qrDataUrl: lastQrDataUrl,
                                mode: 'serverless',
                                heartbeatAt: Date.now()
                            });
                        }
                    } catch (e) { }
                }

                if (connection === 'open') {
                    await saveCreds();
                    const rawId = sock.user?.id || '';
                    const userPhone = rawId.split(':')[0].split('@')[0] || '';
                    const userName = sock.user?.name || 'JF 3D Studio';
                    const connectedState = {
                        status: 'connected',
                        qrDataUrl: null,
                        userPhone,
                        userName,
                        mode: 'serverless',
                        heartbeatAt: Date.now()
                    };
                    await saveEngineStateToSupabase(connectedState);
                    return finish(connectedState);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 515) {
                        await saveCreds();
                        setTimeout(() => connectSocket(), 400);
                        return;
                    }
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
                        await clearSupabaseAuth();
                    }
                    return finish({
                        status: lastQrDataUrl ? 'qr' : 'connecting',
                        qrDataUrl: lastQrDataUrl,
                        mode: 'serverless',
                        heartbeatAt: Date.now()
                    });
                }
            });
        };

        connectSocket();
    });
}

async function sendMessagesViaCloud(rawPhones, text, imageDataUrl = null) {
    const { default: makeWASocket, DisconnectReason } = await getBaileys();
    const phones = (Array.isArray(rawPhones) ? rawPhones : [rawPhones])
        .map(p => normalizeArgPhoneDigits(p))
        .filter(Boolean);

    if (!text || phones.length === 0) {
        return { httpCode: 400, ok: false, error: 'Falta texto o números de destino.' };
    }

    const { state, saveCreds, flushSave } = await useSupabaseAuthState();
    if (!state?.creds?.registered) {
        return {
            httpCode: 503,
            ok: false,
            needsQr: true,
            status: 'qr',
            error: 'El motor de WhatsApp aún no está vinculado. Escanea el código QR por única vez en Alertas WhatsApp.'
        };
    }

    const version = await getBaileysVersion();

    return new Promise((resolve) => {
        let sock = null;
        let done = false;

        const finish = async (resObj) => {
            if (done) return;
            done = true;
            clearTimeout(timeoutTimer);
            if (sock) {
                try { sock.ev.removeAllListeners(); } catch (e) { }
                try { sock.ws.close(); } catch (e) { }
                sock = null;
            }
            try { await flushSave(); } catch (e) { }
            resolve(resObj);
        };

        const timeoutTimer = setTimeout(() => {
            finish({
                httpCode: 504,
                ok: false,
                error: 'Tiempo de espera agotado al conectar con WhatsApp.'
            });
        }, 18000);

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ['JF 3D Studio', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            if (done) return;
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                const rawId = sock.user?.id || '';
                const senderPhone = rawId.split(':')[0].split('@')[0] || '';
                const senderName = sock.user?.name || 'JF 3D Studio';

                let imageBuffer = null;
                if (imageDataUrl && typeof imageDataUrl === 'string') {
                    try {
                        const base64Clean = imageDataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
                        if (base64Clean && base64Clean.length > 20) {
                            imageBuffer = Buffer.from(base64Clean, 'base64');
                        }
                    } catch (e) { }
                }

                const sent = [];
                const errors = [];

                for (const rawPhone of phones) {
                    try {
                        const jid = await resolveWhatsAppJid(sock, rawPhone, senderPhone);
                        if (imageBuffer && imageBuffer.length > 0) {
                            try {
                                await sock.sendMessage(jid, { image: imageBuffer, caption: text });
                            } catch (imgErr) {
                                await sock.sendMessage(jid, { text });
                            }
                        } else {
                            await sock.sendMessage(jid, { text });
                        }
                        sent.push(rawPhone);
                    } catch (err) {
                        errors.push({ phone: rawPhone, error: err.message });
                    }
                }

                await saveEngineStateToSupabase({
                    status: 'connected',
                    qrDataUrl: null,
                    userPhone: senderPhone,
                    userName: senderName,
                    mode: 'serverless'
                });

                return finish({
                    httpCode: 200,
                    ok: sent.length > 0,
                    sent,
                    errors
                });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
                    await clearSupabaseAuth();
                    await saveEngineStateToSupabase({
                        status: 'connecting',
                        qrDataUrl: null,
                        userPhone: null,
                        userName: null
                    });
                    return finish({
                        httpCode: 503,
                        ok: false,
                        needsQr: true,
                        error: 'La sesión de WhatsApp expiró. Escanea nuevamente el código QR.'
                    });
                }
            }
        });
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    const urlPath = (req.url || '').split('?')[0];
    const queryStr = (req.url || '').split('?')[1] || '';
    const searchParams = new URLSearchParams(queryStr);
    const action = req.query?.action || searchParams.get('action') || urlPath.split('/').pop();

    try {
        if (action === 'status' && req.method === 'GET') {
            const forceFresh = searchParams.get('fresh') === '1' || req.query?.fresh === '1';
            if (!forceFresh) {
                const cloudState = await getEngineStateFromSupabase();
                const isRecent = cloudState && cloudState.heartbeatAt && (Date.now() - cloudState.heartbeatAt < 35000);

                if (cloudState && cloudState.status === 'connected' && isRecent) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    return res.end(JSON.stringify(cloudState));
                }

                if (cloudState && cloudState.status === 'qr' && cloudState.qrDataUrl && isRecent) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    return res.end(JSON.stringify(cloudState));
                }
            }

            const { state } = await useSupabaseAuthState();
            if (state?.creds?.registered) {
                const meId = state.creds.me?.id || '';
                const userPhone = meId.split(':')[0].split('@')[0] || '';
                const userName = state.creds.me?.name || 'JF 3D Studio';
                const connectedObj = {
                    status: 'connected',
                    qrDataUrl: null,
                    userPhone,
                    userName,
                    mode: 'serverless',
                    heartbeatAt: Date.now()
                };
                await saveEngineStateToSupabase(connectedObj);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify(connectedObj));
            }

            const pairResult = await runCloudPairingSession(7000);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify(pairResult));
        }

        if (action === 'pair') {
            const pairResult = await runCloudPairingSession(48000);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify(pairResult));
        }

        if (action === 'restart' && req.method === 'POST') {
            await clearCloudOutbox();
            const { state } = await useSupabaseAuthState();
            if (state?.creds?.registered) {
                const meId = state.creds.me?.id || '';
                const userPhone = meId.split(':')[0].split('@')[0] || '';
                const userName = state.creds.me?.name || 'JF 3D Studio';
                const connectedObj = {
                    status: 'connected',
                    qrDataUrl: null,
                    userPhone,
                    userName,
                    mode: 'serverless',
                    heartbeatAt: Date.now()
                };
                await saveEngineStateToSupabase(connectedObj);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify({ ok: true, ...connectedObj }));
            }
            const pairResult = await runCloudPairingSession(7000);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: true, ...pairResult }));
        }

        if ((action === 'logout' || action === 'repair') && req.method === 'POST') {
            await clearSupabaseAuth();
            await clearCloudOutbox();
            await saveEngineStateToSupabase({
                status: 'connecting',
                qrDataUrl: null,
                userPhone: null,
                userName: null,
                mode: 'serverless'
            });
            const pairResult = await runCloudPairingSession(7000);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: true, ...pairResult }));
        }

        if (action === 'send' && req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) { body = {}; }
            } else if (!body) {
                body = {};
            }
            const phones = Array.isArray(body.phones) ? body.phones : (body.phone ? [body.phone] : []);
            const result = await sendMessagesViaCloud(phones, (body.text || '').trim(), body.imageDataUrl || null);
            res.statusCode = result.httpCode || 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify(result));
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
    } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
};
