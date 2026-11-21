const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uhwadjswtcdarhidvqxr.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_miv4XL14Dlnc54TO_8ebiQ_4WeAVDzq';
const AUTH_STORAGE_KEY = 'whatsappCloudAuth';

let baileysModPromise = null;
async function getBaileys() {
    if (!baileysModPromise) {
        baileysModPromise = import('@whiskeysockets/baileys');
    }
    return baileysModPromise;
}

async function loadRawAuthFromSupabase() {
    try {
        const { BufferJSON } = await getBaileys();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${AUTH_STORAGE_KEY}&select=value`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        if (!res.ok) return null;
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].value && rows[0].value.data) {
            return JSON.parse(rows[0].value.data, BufferJSON.reviver);
        }
    } catch (e) {
        console.warn('Error leyendo auth de Supabase:', e.message);
    }
    return null;
}

async function saveRawAuthToSupabase(authObj) {
    try {
        const { BufferJSON } = await getBaileys();
        const serialized = JSON.stringify(authObj, BufferJSON.replacer);
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                key: AUTH_STORAGE_KEY,
                value: { data: serialized, updatedAt: Date.now() },
                updated_at: new Date().toISOString()
            })
        });
    } catch (e) {
        console.warn('Error guardando auth en Supabase:', e.message);
    }
}

async function clearSupabaseAuth() {
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
                key: AUTH_STORAGE_KEY,
                value: { data: null, updatedAt: Date.now() },
                updated_at: new Date().toISOString()
            })
        });
    } catch (e) { }
}

async function useSupabaseAuthState() {
    const { initAuthCreds, proto } = await getBaileys();
    let stored = await loadRawAuthFromSupabase();
    const creds = (stored && stored.creds) ? stored.creds : initAuthCreds();
    const keys = (stored && stored.keys) ? stored.keys : {};

    let saveTimer = null;
    let savePromise = Promise.resolve();

    const flushSave = async () => {
        savePromise = savePromise.then(() => saveRawAuthToSupabase({ creds, keys })).catch(() => { });
        return savePromise;
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            flushSave();
        }, 250);
    };

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = keys[`${type}-${id}`];
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                keys[key] = value;
                            } else {
                                delete keys[key];
                            }
                        }
                    }
                    scheduleSave();
                }
            }
        },
        saveCreds: async () => {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            await flushSave();
        },
        flushSave
    };
}

module.exports = {
    getBaileys,
    useSupabaseAuthState,
    clearSupabaseAuth,
    loadRawAuthFromSupabase,
    saveRawAuthToSupabase
};
