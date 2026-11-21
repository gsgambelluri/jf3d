const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const QRCode = require('qrcode');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { clearSupabaseAuth } = require('./supabase-baileys-auth');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname;
const WA_AUTH_DIR = path.join(__dirname, '.whatsapp_auth');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uhwadjswtcdarhidvqxr.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_miv4XL14Dlnc54TO_8ebiQ_4WeAVDzq';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Private-Network': 'true'
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.sql': 'text/plain; charset=utf-8'
};

// --- DIRECT WHATSAPP ENGINE (BAILEYS - STRICT SINGLETON) ---
let waSocket = null;
let waStatus = 'connecting'; // 'connecting' | 'qr' | 'connected' | 'disconnected'
let waQrDataUrl = null;
let waUserPhone = null;
let waUserName = null;
let isStartingWa = false;
let reconnectTimer = null;
let connectingWatchdog = null;
let consecutiveFailures = 0;
let cachedBaileysVersion = null;

function clearAuthFolder() {
    try {
        if (fs.existsSync(WA_AUTH_DIR)) {
            fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Error limpiando carpeta .whatsapp_auth:', e.message);
    }
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

async function resolveWhatsAppJid(sock, rawPhone) {
    const digits = normalizeArgPhoneDigits(rawPhone);
    if (!digits) return null;

    // If sending to the exact same phone that is linked as the sender, use its exact JID
    if (waUserPhone && (digits === waUserPhone || digits.replace(/^549/, '54') === waUserPhone.replace(/^549/, '54'))) {
        return `${waUserPhone}@s.whatsapp.net`;
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

function scheduleReconnect(delayMs = 2500) {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startWhatsAppEngine();
    }, delayMs);
}

async function startWhatsAppEngine() {
    if (isStartingWa) return;
    isStartingWa = true;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (connectingWatchdog) {
        clearTimeout(connectingWatchdog);
        connectingWatchdog = null;
    }

    // Clean up any previous socket instance completely so two sockets never compete
    if (waSocket) {
        try { waSocket.ev.removeAllListeners(); } catch (e) { }
        try { waSocket.ws.close(); } catch (e) { }
        waSocket = null;
    }

    try {
        if (!fs.existsSync(WA_AUTH_DIR)) {
            fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
        let version = cachedBaileysVersion || [2, 3000, 1015901307];
        if (!cachedBaileysVersion) {
            try {
                const latest = await Promise.race([
                    fetchLatestBaileysVersion(),
                    new Promise(r => setTimeout(() => r(null), 2500))
                ]);
                if (latest && latest.version) {
                    version = latest.version;
                    cachedBaileysVersion = latest.version;
                }
            } catch (e) { }
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

        waSocket = sock;
        const hasRegisteredCreds = !!(state?.creds?.registered);

        // Watchdog: if stuck in 'connecting' for >20s, reconnect cleanly (only wipe auth if NOT yet registered)
        connectingWatchdog = setTimeout(() => {
            if (waStatus === 'connecting' && sock === waSocket) {
                try { sock.ev.removeAllListeners(); } catch (e) { }
                try { sock.ws.close(); } catch (e) { }
                waSocket = null;
                if (!hasRegisteredCreds) {
                    console.log('🔄 [WhatsApp] Renovando sesión pendiente de QR...');
                    clearAuthFolder();
                    waQrDataUrl = null;
                    waUserPhone = null;
                    waUserName = null;
                } else {
                    console.log('🔄 [WhatsApp] Reconectando sesión vinculada tras espera de red...');
                }
                consecutiveFailures = 0;
                scheduleReconnect(800);
            }
        }, 20000);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            if (sock !== waSocket) return; // Ignore events from stale sockets

            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                if (connectingWatchdog) {
                    clearTimeout(connectingWatchdog);
                    connectingWatchdog = null;
                }
                try {
                    waQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 260 });
                    waStatus = 'qr';
                    console.log('📱 [WhatsApp] Código QR listo para escanear desde el navegador.');
                    pushWhatsAppStateToCloud();
                } catch (err) {
                    console.error('Error generando QR:', err);
                }
            }

            if (connection === 'open') {
                if (connectingWatchdog) {
                    clearTimeout(connectingWatchdog);
                    connectingWatchdog = null;
                }
                consecutiveFailures = 0;
                waStatus = 'connected';
                waQrDataUrl = null;
                const rawId = sock.user?.id || '';
                waUserPhone = rawId.split(':')[0].split('@')[0] || '';
                waUserName = sock.user?.name || 'JF 3D Studio';
                console.log(`✅ [WhatsApp] Conectado y estable como +${waUserPhone} (${waUserName})`);
                pushWhatsAppStateToCloud();
            }

            if (connection === 'close') {
                if (connectingWatchdog) {
                    clearTimeout(connectingWatchdog);
                    connectingWatchdog = null;
                }
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`⚠️ [WhatsApp] Conexión cerrada (código: ${statusCode}).`);

                try { sock.ev.removeAllListeners(); } catch (e) { }
                if (waSocket === sock) {
                    waSocket = null;
                }

                // 515 is restartRequired right after scanning a QR code
                if (statusCode === 515) {
                    waStatus = 'connecting';
                    scheduleReconnect(500);
                    return;
                }

                consecutiveFailures++;
                const isCurrentlyRegistered = !!(state?.creds?.registered || waUserPhone);
                const isExplicitLogout =
                    statusCode === DisconnectReason.loggedOut ||
                    statusCode === DisconnectReason.forbidden ||
                    statusCode === DisconnectReason.multideviceMismatch ||
                    statusCode === 401 ||
                    statusCode === 403;

                const isStuckUnregistered = !isCurrentlyRegistered && (
                    statusCode === DisconnectReason.badSession ||
                    statusCode === 405 ||
                    statusCode === 500 ||
                    consecutiveFailures >= 3
                );

                if (isExplicitLogout || isStuckUnregistered) {
                    console.log('🔄 [WhatsApp] Limpiando sesión desvinculada para generar un nuevo código QR...');
                    clearAuthFolder();
                    consecutiveFailures = 0;
                    waStatus = 'connecting';
                    waQrDataUrl = null;
                    waUserPhone = null;
                    waUserName = null;
                    pushWhatsAppStateToCloud();
                    scheduleReconnect(600);
                } else {
                    waStatus = 'connecting';
                    pushWhatsAppStateToCloud();
                    scheduleReconnect(2000);
                }
            }
        });
    } catch (err) {
        console.error('Error iniciando motor WhatsApp:', err);
        waStatus = 'disconnected';
        pushWhatsAppStateToCloud();
        scheduleReconnect(3000);
    } finally {
        isStartingWa = false;
    }
}

async function waitForConnectedSocket(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (waStatus === 'connected' && waSocket) {
            return waSocket;
        }
        if (waStatus === 'qr') {
            return null;
        }
        await new Promise(r => setTimeout(r, 300));
    }
    return waStatus === 'connected' ? waSocket : null;
}

async function waitForQrOrConnected(timeoutMs = 5500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (waStatus === 'connected' || (waStatus === 'qr' && waQrDataUrl)) {
            break;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return {
        status: waStatus,
        qrDataUrl: waQrDataUrl,
        userPhone: waUserPhone,
        userName: waUserName,
        mode: 'local',
        heartbeatAt: Date.now()
    };
}

async function restartWhatsAppEngineSocket() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (connectingWatchdog) {
        clearTimeout(connectingWatchdog);
        connectingWatchdog = null;
    }
    if (waSocket) {
        const oldSock = waSocket;
        waSocket = null;
        try { oldSock.ev.removeAllListeners(); } catch (e) { }
        try { oldSock.ws.close(); } catch (e) { }
    }
    consecutiveFailures = 0;
    waStatus = 'connecting';
    isStartingWa = false;
    pushWhatsAppStateToCloud();
    startWhatsAppEngine();
    return await waitForQrOrConnected(5000);
}

async function resetWhatsAppEngineSession() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (connectingWatchdog) {
        clearTimeout(connectingWatchdog);
        connectingWatchdog = null;
    }
    if (waSocket) {
        const oldSock = waSocket;
        waSocket = null;
        try { oldSock.ev.removeAllListeners(); } catch (e) { }
        try {
            await Promise.race([
                oldSock.logout().catch(() => { }),
                new Promise(r => setTimeout(r, 500))
            ]);
        } catch (e) { }
        try { oldSock.ws.close(); } catch (e) { }
    }
    clearAuthFolder();
    clearSupabaseAuth().catch(() => { });
    consecutiveFailures = 0;
    waStatus = 'connecting';
    waQrDataUrl = null;
    waUserPhone = null;
    waUserName = null;
    isStartingWa = false;
    pushWhatsAppStateToCloud();
    startWhatsAppEngine();
    return await waitForQrOrConnected(5500);
}

async function sendMessagesThroughEngine(rawPhones, text, imageDataUrl = null) {
    const phones = (Array.isArray(rawPhones) ? rawPhones : [rawPhones])
        .map(p => normalizeArgPhoneDigits(p))
        .filter(Boolean);

    if (!text || phones.length === 0) {
        return { httpCode: 400, ok: false, error: 'Falta texto o números de destino.' };
    }

    const sock = await waitForConnectedSocket(6000);
    if (!sock) {
        return {
            httpCode: 503,
            ok: false,
            needsQr: waStatus === 'qr',
            status: waStatus,
            error: 'El motor de WhatsApp aún no está vinculado. Escanea el código QR por única vez en Alertas WhatsApp.'
        };
    }

    let imageBuffer = null;
    if (imageDataUrl && typeof imageDataUrl === 'string') {
        try {
            const base64Clean = imageDataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
            if (base64Clean && base64Clean.length > 20) {
                imageBuffer = Buffer.from(base64Clean, 'base64');
            }
        } catch (e) {
            console.warn('Error decodificando imagen para WhatsApp:', e.message);
        }
    }

    const sent = [];
    const errors = [];

    for (const rawPhone of phones) {
        try {
            const jid = await resolveWhatsAppJid(sock, rawPhone);
            if (imageBuffer && imageBuffer.length > 0) {
                try {
                    await sock.sendMessage(jid, { image: imageBuffer, caption: text });
                    console.log(`📤🖼️ [WhatsApp] Foto + Mensaje enviados automáticamente a +${rawPhone} (${jid})`);
                } catch (imgErr) {
                    console.warn(`⚠️ [WhatsApp] Fallo envío con foto a +${rawPhone}, enviando texto:`, imgErr.message);
                    await sock.sendMessage(jid, { text });
                }
            } else {
                await sock.sendMessage(jid, { text });
                console.log(`📤 [WhatsApp] Mensaje enviado automáticamente a +${rawPhone} (${jid})`);
            }
            sent.push(rawPhone);
        } catch (err) {
            console.error(`❌ [WhatsApp] Error enviando a ${rawPhone}:`, err.message);
            errors.push({ phone: rawPhone, error: err.message });
        }
    }

    return {
        httpCode: 200,
        ok: sent.length > 0,
        sent,
        errors
    };
}

// --- SUPABASE CLOUD BRIDGE (CONECTA EL PRODUCTIVO VERCEL/NETLIFY CON ESTE MOTOR) ---
let isPushingCloudState = false;
let pendingCloudStatePush = false;
let isPollingOutbox = false;

async function pushWhatsAppStateToCloud() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    if (isPushingCloudState) {
        pendingCloudStatePush = true;
        return;
    }
    isPushingCloudState = true;
    try {
        do {
            pendingCloudStatePush = false;
            const payload = {
                key: 'whatsappEngineState',
                value: {
                    status: waStatus,
                    qrDataUrl: waQrDataUrl,
                    userPhone: waUserPhone,
                    userName: waUserName,
                    heartbeatAt: Date.now()
                },
                updated_at: new Date().toISOString()
            };
            await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(payload)
            });
        } while (pendingCloudStatePush);
    } catch (e) {
        // Ignore transient network errors
    } finally {
        isPushingCloudState = false;
    }
}

async function pollWhatsAppCloudOutbox() {
    if (!SUPABASE_URL || !SUPABASE_KEY || isPollingOutbox) return;
    isPollingOutbox = true;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.whatsappOutbox&select=value`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        if (!res.ok) return;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0 || !rows[0].value) return;

        const outbox = rows[0].value;
        let modified = false;

        // 1. Check if Production requested a QR Reset / Logout
        if (outbox.resetRequest && outbox.resetRequest.status === 'pending') {
            console.log('🔄 [Cloud Bridge] Solicitud de nuevo QR recibida desde el productivo.');
            outbox.resetRequest.status = 'done';
            outbox.resetRequest.processedAt = Date.now();
            await saveCloudOutbox(outbox);
            await resetWhatsAppEngineSession();
            return;
        }

        // 1b. Check if Production requested an Engine Restart (without wiping valid session)
        if (outbox.restartRequest && outbox.restartRequest.status === 'pending') {
            console.log('⚡ [Cloud Bridge] Solicitud de reinicio de motor recibida desde el productivo.');
            outbox.restartRequest.status = 'done';
            outbox.restartRequest.processedAt = Date.now();
            await saveCloudOutbox(outbox);
            await restartWhatsAppEngineSocket();
            return;
        }

        // 2. Check if Production queued any outgoing WhatsApp messages
        if (Array.isArray(outbox.messages)) {
            const now = Date.now();
            for (const msg of outbox.messages) {
                if (msg && msg.status === 'pending') {
                    // Ignore messages older than 24 hours
                    if (msg.createdAt && (now - msg.createdAt > 24 * 60 * 60 * 1000)) {
                        msg.status = 'expired';
                        modified = true;
                        continue;
                    }
                    console.log(`☁️ [Cloud Bridge] Procesando envío desde el productivo (${(msg.phones || []).join(', ')})...`);
                    const result = await sendMessagesThroughEngine(msg.phones || [], (msg.text || '').trim(), msg.imageDataUrl || null);
                    msg.status = result.ok ? 'sent' : 'error';
                    msg.sent = result.sent || [];
                    msg.error = result.error || null;
                    msg.needsQr = !!result.needsQr;
                    msg.processedAt = Date.now();
                    delete msg.imageDataUrl; // Free base64 payload once processed
                    modified = true;
                }
            }

            // Keep only messages from last 30 minutes (max 15)
            const filtered = outbox.messages.filter(m => m && m.createdAt && (now - m.createdAt < 30 * 60 * 1000)).slice(-15);
            if (filtered.length !== outbox.messages.length) {
                outbox.messages = filtered;
                modified = true;
            }
        }

        if (modified) {
            await saveCloudOutbox(outbox);
        }
    } catch (e) {
        // Ignore transient network errors
    } finally {
        isPollingOutbox = false;
    }
}

async function saveCloudOutbox(outbox) {
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
                value: outbox,
                updated_at: new Date().toISOString()
            })
        });
    } catch (e) { }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 10e6) req.destroy();
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    let pathname = decodeURIComponent(parsedUrl.pathname);
    const actionParam = parsedUrl.query?.action || '';

    // --- WHATSAPP API ENDPOINTS ---
    if ((pathname === '/api/whatsapp/status' || pathname === '/api/whatsapp/pair' || (pathname === '/api/whatsapp' && (actionParam === 'status' || actionParam === 'pair'))) && req.method === 'GET') {
        if (waStatus !== 'connected' && !waQrDataUrl) {
            startWhatsAppEngine();
            await waitForQrOrConnected(4500);
        }
        return sendJson(res, 200, {
            status: waStatus,
            qrDataUrl: waQrDataUrl,
            userPhone: waUserPhone,
            userName: waUserName,
            mode: 'local',
            heartbeatAt: Date.now()
        });
    }

    if ((pathname === '/api/whatsapp/restart' || (pathname === '/api/whatsapp' && actionParam === 'restart')) && req.method === 'POST') {
        try {
            const stateResult = await restartWhatsAppEngineSocket();
            return sendJson(res, 200, { ok: true, message: 'Motor de WhatsApp reiniciado.', ...stateResult });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    }

    if ((pathname === '/api/whatsapp/logout' || pathname === '/api/whatsapp/repair' || (pathname === '/api/whatsapp' && (actionParam === 'logout' || actionParam === 'repair'))) && req.method === 'POST') {
        try {
            await saveCloudOutbox({ messages: [], resetRequest: null, restartRequest: null });
            const stateResult = await resetWhatsAppEngineSession();
            return sendJson(res, 200, { ok: true, message: 'Sesión de WhatsApp reiniciada con nuevo QR.', ...stateResult });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    }

    if ((pathname === '/api/whatsapp/send' || (pathname === '/api/whatsapp' && actionParam === 'send')) && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const phones = Array.isArray(body.phones) ? body.phones : (body.phone ? [body.phone] : []);
            const result = await sendMessagesThroughEngine(phones, (body.text || '').trim(), body.imageDataUrl || null);
            return sendJson(res, result.httpCode || 200, result);
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: err.message });
        }
    }

    // --- STATIC FILE SERVER ---
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
        safePath = 'index.html';
    }

    let filePath = path.join(PUBLIC_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            return serveFile(filePath, res);
        }

        if (!err && stats.isFile()) {
            return serveFile(filePath, res);
        }

        const ext = path.extname(safePath).toLowerCase();
        if (!ext || ext === '.html') {
            const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
            return serveFile(fallbackPath, res);
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
    });
});

function serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`500 Server Error: ${err.message}`);
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(content);
    });
}

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 🚀 [JF 3D Studio] Servidor local en ejecución`);
    console.log(` 🌐 URL: http://localhost:${PORT}`);
    console.log(` 📁 Directorio: ${PUBLIC_DIR}`);
    console.log(` 💬 Motor directo de WhatsApp + Puente Productivo activo`);
    console.log(`====================================================`);
    startWhatsAppEngine();
    setTimeout(() => pushWhatsAppStateToCloud(), 1200);
    setInterval(() => pushWhatsAppStateToCloud(), 8000);
    setInterval(() => pollWhatsAppCloudOutbox(), 1500);
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
