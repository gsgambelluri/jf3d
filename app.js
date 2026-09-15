// --- STATE MANAGEMENT ---
let appState = {
    products: [],
    imagePool: [], // Stores all extracted unique base64 images
    selectedProductForImgChange: null, // Track which product is changing image
    orders: [],      // array of { id, clientName, products: [], totalPrice, status, payment, date, filamentDeducted }
    inventory: [],   // array of { id, brand, material, color, cost, weightGrams, remainingGrams }
    internalProducts: [], // New state storage for cost calculator items (Internal Catalog)
    settings: {
        brandName: "JF 3D",
        brandContact: "WhatsApp: +54 9 11 1234-5678 | Instagram: @jf3d.ok",
        catalogTitle: "CATÁLOGO DE PRODUCTOS",
        catalogSubtitle: "Impresiones 3D y Diseños Personalizados",
        backTitle: "¡Gracias por elegirnos!",
        backSubtitle: "Hacemos realidad tus ideas en 3D",
        accentColor: "#0099ff",
        textColor: "#1f2937",
        bgColor: "#ffffff",
        theme: "modern", // modern, luxury, industrial
        margins: "normal", // narrow, normal, wide
        logoImg: "logo.jpg",
        coverImg: "",
        showCover: true,
        showBack: true,
        productsPerPage: 4
    }
};

// --- INDEXEDDB STORAGE CONFIGURATION ---
const DB_NAME = "JF3D_Catalog_DB";
const STORE_NAME = "CatalogState";

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('CatalogState')) {
                db.createObjectStore('CatalogState');
            }
            if (!db.objectStoreNames.contains('OrdersState')) {
                db.createObjectStore('OrdersState');
            }
            if (!db.objectStoreNames.contains('InventoryState')) {
                db.createObjectStore('InventoryState');
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// --- DOM ELEMENTS ---
const elements = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    
    // View Panels
    panelSetup: document.getElementById('panel-setup'),
    panelEditor: document.getElementById('panel-editor'),
    panelPreview: document.getElementById('panel-preview'),
    panelRaw: document.getElementById('panel-raw'),
    
    // Tabs
    tabEditor: document.getElementById('tab-editor'),
    tabPreview: document.getElementById('tab-preview'),
    tabRaw: document.getElementById('tab-raw'),
    
    // Config controls in Sidebar
    sidebar: document.getElementById('sidebar-controls'),
    inputBrandName: document.getElementById('brand-name'),
    inputBrandContact: document.getElementById('brand-contact'),
    inputCatalogTitle: document.getElementById('catalog-title'),
    inputCatalogSubtitle: document.getElementById('catalog-subtitle'),
    inputBackTitle: document.getElementById('back-title'),
    inputBackSubtitle: document.getElementById('back-subtitle'),
    inputAccentColor: document.getElementById('accent-color'),
    inputTextColor: document.getElementById('text-color'),
    inputBgColor: document.getElementById('bg-color'),
    inputProductsPerPage: document.getElementById('prod-per-page'),
    checkboxShowCover: document.getElementById('show-cover'),
    checkboxShowBack: document.getElementById('show-back'),
    logoUpload: document.getElementById('logo-upload'),
    coverUpload: document.getElementById('cover-upload'),
    btnSelectCoverPool: document.getElementById('btn-select-cover-pool'),
    btnUseLogoCover: document.getElementById('btn-use-logo-cover'),
    
    // Lists & Containers
    productGrid: document.getElementById('product-grid'),
    rawContent: document.getElementById('raw-content'),
    previewSheets: document.getElementById('preview-sheets'),
    
    // Stats
    statProducts: document.getElementById('stat-products'),
    statPages: document.getElementById('stat-pages'),
    
    // Modal
    modalImageSelect: document.getElementById('modal-image-select'),
    imagePoolGrid: document.getElementById('image-pool-grid'),
    modalClose: document.getElementById('modal-close'),
    
    // Top-bar action button
    btnPrint: document.getElementById('btn-print'),
    btnReset: document.getElementById('btn-reset'),
    btnAddProduct: document.getElementById('btn-add-product')
};

// --- SUPABASE CLOUD DATABASE SERVICE ---
const DEFAULT_SUPABASE_URL = 'https://uhwadjswtcdarhidvqxr.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_miv4XL14Dlnc54TO_8ebiQ_4WeAVDzq';
let supabaseClient = null;

// --- USER AUTHENTICATION & LOGIN LOGIC ---
let currentAuthUser = null;
let currentAuthTab = 'login';
const MASTER_WORKSHOP_PIN = '1234'; // Clave maestra de taller offline

window.lockApp = function() {
    const appCont = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');
    if (appCont) appCont.classList.add('auth-locked');
    if (loginScreen) loginScreen.classList.remove('hidden');
};

window.unlockApp = function() {
    const appCont = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');
    if (appCont) appCont.classList.remove('auth-locked');
    if (loginScreen) loginScreen.classList.add('hidden');
};

window.setUserSession = function(user) {
    currentAuthUser = user;
    const emailDisp = document.getElementById('user-email-display');
    const avatar = document.getElementById('user-avatar');
    
    const email = user?.email || 'Administrador';
    if (emailDisp) emailDisp.textContent = email;
    
    if (avatar) {
        if (email && email.includes('@')) {
            const initial = email.substring(0, 2).toUpperCase();
            avatar.textContent = initial;
        } else {
            avatar.textContent = 'JF';
        }
    }
};

window.initAuth = async function() {
    // 1. Check if offline master session is stored
    if (localStorage.getItem('jf3d_offline_session') === 'true') {
        setUserSession({ email: 'taller@jf3d.local', isOffline: true });
        unlockApp();
        return;
    }

    // 2. If Supabase is available, check active session
    if (supabaseClient && supabaseClient.auth) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && session.user) {
                setUserSession(session.user);
                unlockApp();
                return;
            }
        } catch (e) {
            console.warn('Error checking Supabase session:', e);
        }
    }

    // 3. Default: Locked
    lockApp();
};

window.switchAuthTab = function(tab) {
    currentAuthTab = tab;
    const btnLogin = document.getElementById('tab-auth-login');
    const btnRegister = document.getElementById('tab-auth-register');
    const confirmBox = document.getElementById('register-password-confirm-box');
    const submitBtn = document.getElementById('btn-auth-submit');
    const alertBox = document.getElementById('auth-alert');
    if (alertBox) alertBox.style.display = 'none';

    if (tab === 'login') {
        if (btnLogin) btnLogin.classList.add('active');
        if (btnRegister) btnRegister.classList.remove('active');
        if (confirmBox) confirmBox.style.display = 'none';
        if (submitBtn) submitBtn.textContent = 'Ingresar al Sistema';
    } else {
        if (btnRegister) btnRegister.classList.add('active');
        if (btnLogin) btnLogin.classList.remove('active');
        if (confirmBox) confirmBox.style.display = 'block';
        if (submitBtn) submitBtn.textContent = 'Crear Cuenta y Entrar';
    }
};

window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

window.showAuthAlert = function(msg, isSuccess = false) {
    const alertBox = document.getElementById('auth-alert');
    if (!alertBox) return;
    alertBox.className = 'auth-alert ' + (isSuccess ? 'success' : 'error');
    alertBox.textContent = msg;
    alertBox.style.display = 'flex';
};

window.handleAuthSubmit = async function(event) {
    if (event) event.preventDefault();
    const email = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    const confirmPassword = document.getElementById('auth-password-confirm')?.value;
    const submitBtn = document.getElementById('btn-auth-submit');

    if (!email || !password) {
        showAuthAlert('Por favor completa todos los campos.');
        return;
    }

    if (password.length < 6) {
        showAuthAlert('La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    if (currentAuthTab === 'register' && password !== confirmPassword) {
        showAuthAlert('Las contraseñas ingresadas no coinciden.');
        return;
    }

    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';
    }

    try {
        if (currentAuthTab === 'login') {
            // Attempt Supabase Login
            if (supabaseClient && supabaseClient.auth) {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) {
                    if (error.message.includes('Invalid login credentials')) {
                        showAuthAlert('Correo o contraseña incorrectos. Si aún no te registraste, selecciona la pestaña "Registrarse".');
                    } else {
                        showAuthAlert(`Error: ${error.message}`);
                    }
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
                    return;
                }

                setUserSession(data.user);
                unlockApp();
                showToast(`¡Bienvenido/a, ${data.user.email}!`);
            } else {
                // Offline fallback login check
                if (password === MASTER_WORKSHOP_PIN || password === 'admin' || password === 'jf3d') {
                    localStorage.setItem('jf3d_offline_session', 'true');
                    setUserSession({ email: email || 'taller@jf3d.local', isOffline: true });
                    unlockApp();
                    showToast('Ingresaste en modo taller local');
                } else {
                    showAuthAlert('Sin conexión a Supabase. Ingresa la clave maestra del taller (1234).');
                }
            }
        } else {
            // Register new account with Supabase
            if (supabaseClient && supabaseClient.auth) {
                const { data, error } = await supabaseClient.auth.signUp({ email, password });
                if (error) {
                    showAuthAlert(`Error al registrar: ${error.message}`);
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
                    return;
                }

                if (data.session && data.user) {
                    setUserSession(data.user);
                    unlockApp();
                    showToast('¡Cuenta creada y sesión iniciada!');
                } else {
                    showAuthAlert('¡Cuenta creada exitosamente! Ya puedes iniciar sesión con tu correo y contraseña.', true);
                    switchAuthTab('login');
                }
            } else {
                showAuthAlert('Para registrar una cuenta nueva en la nube, la base de datos debe estar conectada.');
            }
        }
    } catch (err) {
        console.error('Auth error:', err);
        showAuthAlert('Ocurrió un error inesperado al procesar la autenticación.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }
};

window.handleQuickStudioAccess = function() {
    const pin = prompt('Ingresa la Clave Maestra del Taller para acceso rápido offline:', '');
    if (!pin) return;
    
    if (pin.trim() === MASTER_WORKSHOP_PIN || pin.trim() === 'jf3d' || pin.trim() === 'admin') {
        localStorage.setItem('jf3d_offline_session', 'true');
        setUserSession({ email: 'taller@jf3d.local', isOffline: true });
        unlockApp();
        showToast('Acceso maestro concedido');
    } else {
        alert('Clave maestra incorrecta.');
    }
};

window.logoutUser = async function() {
    if (!confirm('¿Deseas cerrar la sesión actual de JF 3D Studio?')) return;

    try {
        if (supabaseClient && supabaseClient.auth) {
            await supabaseClient.auth.signOut();
        }
    } catch (e) {
        console.warn('Error on Supabase signOut:', e);
    }

    localStorage.removeItem('jf3d_offline_session');
    currentAuthUser = null;
    lockApp();
    showToast('Sesión cerrada.');
};

window.initSupabase = async function() {
    if (localStorage.getItem('jf3d_cloud_disabled') === 'true') {
        updateCloudStatusBadge(false, 'Modo Local');
        await initAuth();
        return;
    }

    let url = localStorage.getItem('jf3d_supabase_url') || DEFAULT_SUPABASE_URL;
    const key = localStorage.getItem('jf3d_supabase_key') || DEFAULT_SUPABASE_KEY;
    
    updateCloudStatusBadge(false, 'Conectando...');
    
    if (!url || !key) {
        updateCloudStatusBadge(false, 'Modo Local');
        await initAuth();
        return;
    }

    // Clean URL in case /rest/v1 or trailing slashes were copied
    url = url.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('Supabase SDK not loaded yet. Running in local mode.');
        updateCloudStatusBadge(false, 'Modo Local');
        await initAuth();
        return;
    }
    
    try {
        supabaseClient = window.supabase.createClient(url, key);

        // Listen for auth state changes from Supabase
        if (supabaseClient.auth) {
            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_IN' && session?.user) {
                    setUserSession(session.user);
                    unlockApp();
                } else if (event === 'SIGNED_OUT') {
                    currentAuthUser = null;
                    if (localStorage.getItem('jf3d_offline_session') !== 'true') {
                        lockApp();
                    }
                }
            });
        }

        // Check authentication state
        await initAuth();

        const { data, error } = await supabaseClient.from('inventory').select('id').limit(1);
        if (error) {
            console.error('Supabase connection error:', error);
            updateCloudStatusBadge(false, 'Error Conexión');
            return;
        }
        
        updateCloudStatusBadge(true, 'Nube Conectada');
        const btnDisconnect = document.getElementById('btn-disconnect-supabase');
        if (btnDisconnect) btnDisconnect.style.display = 'block';
        
        await syncFromCloud();
    } catch (err) {
        console.error('Failed to initialize Supabase client:', err);
        updateCloudStatusBadge(false, 'Error');
        await initAuth();
    }
};

function updateCloudStatusBadge(isConnected, text) {
    document.querySelectorAll('.cloud-status-dot').forEach(dot => {
        dot.className = 'cloud-status-dot ' + (isConnected ? 'connected' : 'offline');
    });
    document.querySelectorAll('.cloud-status-text').forEach(label => {
        label.textContent = text;
    });
    const label = document.getElementById('cloud-status-text') || document.getElementById('cloud-status-label');
    if (label) label.textContent = text;
}

window.openSupabaseModal = function() {
    const modal = document.getElementById('modal-supabase-config');
    if (!modal) return;
    
    const inputUrl = document.getElementById('supabase-url');
    const inputKey = document.getElementById('supabase-anon-key');
    const btnDisconnect = document.getElementById('btn-disconnect-supabase');
    
    if (inputUrl) inputUrl.value = localStorage.getItem('jf3d_supabase_url') || DEFAULT_SUPABASE_URL;
    if (inputKey) inputKey.value = localStorage.getItem('jf3d_supabase_key') || DEFAULT_SUPABASE_KEY;
    if (btnDisconnect) btnDisconnect.style.display = supabaseClient ? 'block' : 'none';
    
    modal.classList.add('active');
};

window.closeSupabaseModal = function() {
    const modal = document.getElementById('modal-supabase-config');
    if (modal) modal.classList.remove('active');
};

window.saveSupabaseConfig = async function() {
    let url = document.getElementById('supabase-url')?.value.trim();
    const key = document.getElementById('supabase-anon-key')?.value.trim();
    
    if (!url || !key) {
        alert('Por favor, ingresa tanto la URL del Proyecto como la Anon Public Key de Supabase.');
        return;
    }
    
    // Auto-clean URL
    url = url.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    
    localStorage.removeItem('jf3d_cloud_disabled');
    localStorage.setItem('jf3d_supabase_url', url);
    localStorage.setItem('jf3d_supabase_key', key);
    
    closeSupabaseModal();
    showToast('Conectando a Supabase...');
    await initSupabase();
};

window.disconnectSupabase = function() {
    if (confirm('¿Deseas desconectar la base de datos en la nube y volver al Modo Local?')) {
        localStorage.setItem('jf3d_cloud_disabled', 'true');
        localStorage.removeItem('jf3d_supabase_url');
        localStorage.removeItem('jf3d_supabase_key');
        supabaseClient = null;
        updateCloudStatusBadge(false, 'Modo Local');
        const btnDisconnect = document.getElementById('btn-disconnect-supabase');
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        closeSupabaseModal();
        showToast('Desconectado de la nube. Modo Local activo.');
    }
};

window.syncFromCloud = async function() {
    if (!supabaseClient) return;
    
    updateCloudStatusBadge(false, 'Sincronizando...');
    try {
        const { data: cloudInv } = await supabaseClient.from('inventory').select('*');
        const { data: cloudOrders } = await supabaseClient.from('orders').select('*');
        const { data: cloudInternal } = await supabaseClient.from('internal_products').select('*');
        const { data: cloudPublic } = await supabaseClient.from('public_products').select('*');
        const { data: cloudSettings } = await supabaseClient.from('app_settings').select('*');
        
        const hasCloudData = (cloudInv && cloudInv.length > 0) || 
                             (cloudOrders && cloudOrders.length > 0) || 
                             (cloudInternal && cloudInternal.length > 0) ||
                             (cloudPublic && cloudPublic.length > 0);
        
        if (hasCloudData) {
            if (cloudInv && cloudInv.length > 0) {
                appState.inventory = cloudInv.map(r => ({
                    id: r.id,
                    brand: r.brand,
                    material: r.material,
                    color: r.color,
                    cost: parseFloat(r.cost) || 12000,
                    weightGrams: parseFloat(r.weight_grams) || 1000,
                    remainingGrams: parseFloat(r.remaining_grams) || 1000
                }));
            }
            
            if (cloudOrders && cloudOrders.length > 0) {
                appState.orders = cloudOrders.map(r => ({
                    id: r.id,
                    clientName: r.client_name,
                    products: Array.isArray(r.products) ? r.products : [],
                    totalPrice: parseFloat(r.total_price) || 0,
                    status: r.status,
                    payment: r.payment,
                    date: r.date,
                    filamentDeducted: !!r.filament_deducted
                }));
            }
            
            if (cloudInternal && cloudInternal.length > 0) {
                appState.internalProducts = cloudInternal.map(r => ({
                    id: r.id,
                    title: r.title,
                    weightGrams: parseFloat(r.weight_grams) || 0,
                    hours: parseFloat(r.hours) || 0,
                    spoolId: r.spool_id,
                    materialCost: parseFloat(r.material_cost) || 0,
                    errorMarginPercent: parseFloat(r.error_margin_percent) || 10,
                    errorMarginCost: parseFloat(r.error_margin_cost) || 0,
                    electricityRate: parseFloat(r.electricity_rate) || 15,
                    electricityCost: parseFloat(r.electricity_cost) || 0,
                    depreciationRate: parseFloat(r.depreciation_rate) || 25,
                    depreciationCost: parseFloat(r.depreciation_cost) || 0,
                    netCost: parseFloat(r.net_cost) || 0,
                    markupPercent: parseFloat(r.markup_percent) || 150,
                    profitCost: parseFloat(r.profit_cost) || 0,
                    suggestedPrice: parseFloat(r.suggested_price) || 0,
                    category: r.category || 'Calculado',
                    imageSrc: r.image_src || ''
                }));
            }
            
            if (cloudPublic && cloudPublic.length > 0) {
                appState.products = cloudPublic.map(r => ({
                    id: r.id,
                    internalProdId: r.internal_prod_id,
                    title: r.title,
                    description: r.description,
                    price: r.price,
                    category: r.category,
                    imageSrc: r.image_src
                }));
            }
            
            if (cloudSettings && cloudSettings.length > 0) {
                cloudSettings.forEach(s => {
                    if (s.key === 'costSettings') appState.costSettings = s.value;
                    if (s.key === 'appSettings') appState.settings = { ...appState.settings, ...s.value };
                });
            }
            
            saveStateToStorage();
            syncCostInputsFromState();
            syncSidebarInputsFromState();
            updateFilamentDropdown();
            renderInventoryGrid();
            renderOrdersTable();
            renderInternalProductTable();
            renderProductCardsInEditor();
            updatePreviewAndStats();
            updateDashboardData();
            
            updateCloudStatusBadge(true, 'Nube Conectada');
            showToast('¡Datos sincronizados exitosamente con Supabase!');
        } else {
            await pushAllToCloud();
            updateCloudStatusBadge(true, 'Nube Conectada');
            showToast('Base de datos inicializada con tus datos locales.');
        }
    } catch (err) {
        console.error('Error syncing from cloud:', err);
        updateCloudStatusBadge(true, 'Nube Conectada');
    }
};

window.pushAllToCloud = async function() {
    if (!supabaseClient) return;
    try {
        if (appState.inventory && appState.inventory.length > 0) {
            for (const s of appState.inventory) { await pushInventoryToCloud(s); }
        }
        if (appState.orders && appState.orders.length > 0) {
            for (const o of appState.orders) { await pushOrderToCloud(o); }
        }
        if (appState.internalProducts && appState.internalProducts.length > 0) {
            for (const p of appState.internalProducts) { await pushInternalProductToCloud(p); }
        }
        if (appState.products && appState.products.length > 0) {
            for (const p of appState.products) { await pushPublicProductToCloud(p); }
        }
        await pushSettingsToCloud();
    } catch (err) {
        console.error('Error pushing all to cloud:', err);
    }
};

window.pushInventoryToCloud = async function(spool) {
    if (!supabaseClient || !spool) return;
    try {
        await supabaseClient.from('inventory').upsert({
            id: spool.id,
            brand: spool.brand,
            material: spool.material,
            color: spool.color,
            cost: spool.cost,
            weight_grams: spool.weightGrams,
            remaining_grams: spool.remainingGrams
        });
    } catch (e) { console.error('Cloud inventory upsert failed:', e); }
};

window.deleteInventoryFromCloud = async function(id) {
    if (!supabaseClient || !id) return;
    try { await supabaseClient.from('inventory').delete().eq('id', id); } catch (e) {}
};

window.pushOrderToCloud = async function(order) {
    if (!supabaseClient || !order) return;
    try {
        await supabaseClient.from('orders').upsert({
            id: order.id,
            client_name: order.clientName,
            products: order.products,
            total_price: order.totalPrice,
            status: order.status,
            payment: order.payment,
            date: order.date,
            filament_deducted: order.filamentDeducted
        });
    } catch (e) { console.error('Cloud order upsert failed:', e); }
};

window.deleteOrderFromCloud = async function(id) {
    if (!supabaseClient || !id) return;
    try { await supabaseClient.from('orders').delete().eq('id', id); } catch (e) {}
};

window.pushInternalProductToCloud = async function(prod) {
    if (!supabaseClient || !prod) return;
    try {
        await supabaseClient.from('internal_products').upsert({
            id: prod.id,
            title: prod.title,
            weight_grams: prod.weightGrams,
            hours: prod.hours,
            spool_id: prod.spoolId || null,
            material_cost: prod.materialCost,
            error_margin_percent: prod.errorMarginPercent,
            error_margin_cost: prod.errorMarginCost,
            electricity_rate: prod.electricityRate,
            electricity_cost: prod.electricityCost,
            depreciation_rate: prod.depreciationRate,
            depreciation_cost: prod.depreciationCost,
            net_cost: prod.netCost,
            markup_percent: prod.markupPercent,
            profit_cost: prod.profitCost,
            suggested_price: prod.suggestedPrice,
            category: prod.category || 'Calculado',
            image_src: (prod.imageSrc && prod.imageSrc.length < 50000) ? prod.imageSrc : ''
        });
    } catch (e) { console.error('Cloud internal product upsert failed:', e); }
};

window.deleteInternalProductFromCloud = async function(id) {
    if (!supabaseClient || !id) return;
    try { await supabaseClient.from('internal_products').delete().eq('id', id); } catch (e) {}
};

window.pushPublicProductToCloud = async function(prod) {
    if (!supabaseClient || !prod) return;
    try {
        await supabaseClient.from('public_products').upsert({
            id: prod.id,
            internal_prod_id: prod.internalProdId || null,
            title: prod.title,
            description: prod.description || '',
            price: prod.price || '$ 0.00',
            category: prod.category || 'General',
            image_src: (prod.imageSrc && prod.imageSrc.length < 50000) ? prod.imageSrc : ''
        });
    } catch (e) { console.error('Cloud public product upsert failed:', e); }
};

window.deletePublicProductFromCloud = async function(id) {
    if (!supabaseClient || !id) return;
    try { await supabaseClient.from('public_products').delete().eq('id', id); } catch (e) {}
};

window.pushSettingsToCloud = async function() {
    if (!supabaseClient) return;
    try {
        if (appState.costSettings) {
            await supabaseClient.from('app_settings').upsert({
                key: 'costSettings',
                value: appState.costSettings,
                updated_at: new Date().toISOString()
            });
        }
        if (appState.settings) {
            await supabaseClient.from('app_settings').upsert({
                key: 'appSettings',
                value: appState.settings,
                updated_at: new Date().toISOString()
            });
        }
    } catch (e) { console.error('Cloud settings upsert failed:', e); }
};

// --- INITIALIZE APPLICATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    
    // Load state asynchronously from IndexedDB
    getDB().then(db => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get('current_state');
        request.onsuccess = (e) => {
            const savedState = e.target.result;
            if (savedState) {
                // Deep merge state
                appState = {
                    ...appState,
                    ...savedState,
                    products: savedState.products || [],
                    orders: savedState.orders || [],
                    inventory: savedState.inventory || [],
                    internalProducts: savedState.internalProducts || [],
                    imagePool: savedState.imagePool || [],
                    costSettings: savedState.costSettings || {
                        electricityRate: 15,
                        depreciationRate: 25,
                        errorMarginPercent: 10,
                        markupPercent: 150,
                        spoolId: ''
                    },
                    settings: {
                        ...appState.settings,
                        ...savedState.settings
                    }
                };
                
                syncCostInputsFromState();
                
                // Apply visual catalog styles
                if (appState.settings.accentColor) document.documentElement.style.setProperty('--catalog-accent', appState.settings.accentColor);
                if (appState.settings.textColor) document.documentElement.style.setProperty('--catalog-text', appState.settings.textColor);
                if (appState.settings.bgColor) document.documentElement.style.setProperty('--catalog-bg', appState.settings.bgColor);
                
                // Synchronize sidebar form values
                syncSidebarInputsFromState();
                
                // Render editor list and sheets preview
                renderProductCardsInEditor();
                renderCatalogSheets();
                
                // Display active sidebar workspace
                elements.panelSetup.style.display = 'none';
                elements.sidebar.style.display = 'flex';
                
                // Switch to default start page
                switchModule('dashboard');
                
                // Reveal tabs and statistics
                const navTabs = document.getElementById('nav-tabs');
                const statsView = document.getElementById('stats-view');
                if (navTabs) { navTabs.style.opacity = '1'; navTabs.style.pointerEvents = 'auto'; }
                if (statsView) { statsView.style.opacity = '1'; statsView.style.pointerEvents = 'auto'; }
            } else {
                loadSampleDataIfEmpty();
                switchModule('dashboard');
            }
            
            // Connect to Supabase in cloud if credentials are saved
            initSupabase();
        };
        request.onerror = () => {
            loadSampleDataIfEmpty();
            switchModule('dashboard');
            initSupabase();
        };
    }).catch(err => {
        console.error('IndexedDB load error:', err);
        loadSampleDataIfEmpty();
        switchModule('dashboard');
        initSupabase();
    });
});

// Setup event listeners for UI interactions
function setupEventListeners() {
    // Setup file drag and drop
    if (elements.dropZone) {
        elements.dropZone.addEventListener('click', () => elements.fileInput.click());
        elements.fileInput.addEventListener('change', handleFileSelect);
        elements.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            elements.dropZone.classList.add('dragover');
        });
        elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragover'));
        elements.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            elements.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                processDocxFile(e.dataTransfer.files[0]);
            }
        });
    }

    // Tabs Navigation (within Catalog Creator section)
    if (elements.tabEditor) elements.tabEditor.addEventListener('click', () => switchTab('editor'));
    if (elements.tabPreview) elements.tabPreview.addEventListener('click', () => switchTab('preview'));
    if (elements.tabRaw) elements.tabRaw.addEventListener('click', () => switchTab('raw'));

    // Config Input Binding (Catalog Sidebar panel)
    bindSettingsInput(elements.inputBrandName, 'brandName');
    bindSettingsInput(elements.inputBrandContact, 'brandContact');
    bindSettingsInput(elements.inputCatalogTitle, 'catalogTitle');
    bindSettingsInput(elements.inputCatalogSubtitle, 'catalogSubtitle');
    bindSettingsInput(elements.inputBackTitle, 'backTitle');
    bindSettingsInput(elements.inputBackSubtitle, 'backSubtitle');
    bindSettingsInput(elements.inputAccentColor, 'accentColor', true);
    bindSettingsInput(elements.inputTextColor, 'textColor', true);
    bindSettingsInput(elements.inputBgColor, 'bgColor', true);
    
    if (elements.inputProductsPerPage) {
        elements.inputProductsPerPage.addEventListener('change', (e) => {
            appState.settings.productsPerPage = parseInt(e.target.value) || 4;
            updatePreviewAndStats();
        });
    }
    
    if (elements.checkboxShowCover) {
        elements.checkboxShowCover.addEventListener('change', (e) => {
            appState.settings.showCover = e.target.checked;
            updatePreviewAndStats();
        });
    }
    
    if (elements.checkboxShowBack) {
        elements.checkboxShowBack.addEventListener('change', (e) => {
            appState.settings.showBack = e.target.checked;
            updatePreviewAndStats();
        });
    }

    // Logo Upload
    if (elements.logoUpload) {
        elements.logoUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    appState.settings.logoImg = event.target.result;
                    updatePreviewAndStats();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Cover Upload
    if (elements.coverUpload) {
        elements.coverUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    appState.settings.coverImg = event.target.result;
                    updatePreviewAndStats();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Cover Image selection from extracted pool
    if (elements.btnSelectCoverPool) {
        elements.btnSelectCoverPool.addEventListener('click', () => {
            openImageSelector('COVER');
        });
    }

    // Use Logo as Cover Image quick action
    if (elements.btnUseLogoCover) {
        elements.btnUseLogoCover.addEventListener('click', () => {
            if (appState.settings.logoImg) {
                appState.settings.coverImg = appState.settings.logoImg;
                updatePreviewAndStats();
            } else {
                alert('Por favor, primero sube el Logo de tu empresa en la sección "Identidad Corporativa".');
            }
        });
    }

    // Theme selector buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const theme = e.currentTarget.dataset.theme;
            appState.settings.theme = theme;
            
            // Adjust default products-per-page based on theme for optical density
            if (theme === 'luxury') {
                appState.settings.productsPerPage = 2;
            } else if (theme === 'industrial') {
                appState.settings.productsPerPage = 6;
            } else {
                appState.settings.productsPerPage = 4;
            }
            
            if (elements.inputProductsPerPage) {
                elements.inputProductsPerPage.value = appState.settings.productsPerPage;
            }
            
            updatePreviewAndStats();
        });
    });

    // Margin selector buttons
    document.querySelectorAll('[data-margin]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-margin]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            appState.settings.margins = e.currentTarget.dataset.margin;
            updatePreviewAndStats();
        });
    });

    // Add Product Button
    if (elements.btnAddProduct) {
        elements.btnAddProduct.addEventListener('click', addNewProduct);
    }

    // Print Button
    if (elements.btnPrint) {
        elements.btnPrint.addEventListener('click', () => {
            window.print();
        });
    }

    // Reset Button
    if (elements.btnReset) {
        elements.btnReset.addEventListener('click', () => {
            if (confirm('¿Estás seguro de que deseas restablecer el catálogo? Se perderán todos tus cambios.')) {
                resetToSetupState();
            }
        });
    }

    // Modal Close
    if (elements.modalClose) {
        elements.modalClose.addEventListener('click', () => {
            elements.modalImageSelect.classList.remove('active');
        });
    }
}

// Bind standard input changes to State and refresh UI
function bindSettingsInput(inputElement, stateKey, isColor = false) {
    if (!inputElement) return;
    inputElement.addEventListener('input', (e) => {
        appState.settings[stateKey] = e.target.value;
        if (isColor) {
            document.documentElement.style.setProperty(`--catalog-${stateKey.replace('Color', '')}`, e.target.value);
        }
        updatePreviewAndStats();
    });
}

// --- FILE SELECTION & DOCX CONVERSION ---
function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        processDocxFile(e.target.files[0]);
    }
}

function processDocxFile(file) {
    if (!file.name.endsWith('.docx')) {
        alert('Por favor, selecciona un archivo válido con extensión .docx (Word).');
        return;
    }

    showLoading('Leyendo archivo de Word...');

    const reader = new FileReader();
    reader.onload = function(event) {
        const arrayBuffer = event.target.result;
        
        showLoading('Convirtiendo contenido del documento...');
        
        // Use Mammoth.js to convert docx to clean HTML
        mammoth.convertToHtml({ arrayBuffer: arrayBuffer })
            .then(result => {
                const htmlContent = result.value;
                const messages = result.messages;
                
                if (messages.length > 0) {
                    console.log('Mammoth messages:', messages);
                }
                
                showLoading('Extrayendo productos e imágenes...');
                
                // Store raw HTML in the preview tab
                if (elements.rawContent) {
                    elements.rawContent.innerHTML = htmlContent;
                }
                
                // Parse products from Mammoth HTML
                parseProductsFromHtml(htmlContent);
                
                hideLoading();
                
                // Transition layout
                elements.panelSetup.style.display = 'none';
                elements.sidebar.style.display = 'flex';
                switchTab('preview'); // Open preview tab first to show results
                
                // Explicitly show navigation tabs and stats
                const navTabs = document.getElementById('nav-tabs');
                const statsView = document.getElementById('stats-view');
                if (navTabs) { navTabs.style.opacity = '1'; navTabs.style.pointerEvents = 'auto'; }
                if (statsView) { statsView.style.opacity = '1'; statsView.style.pointerEvents = 'auto'; }
            })
            .catch(err => {
                console.error(err);
                hideLoading();
                alert('Error al convertir el archivo: ' + err.message);
            });
    };
    
    reader.onerror = function() {
        hideLoading();
        alert('Error al leer el archivo físico.');
    };
    
    reader.readAsArrayBuffer(file);
}

// --- SMART DOCX HEURISTIC PARSER ---
function parseProductsFromHtml(htmlString) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    let detectedProducts = [];
    let extractedImages = [];
    
    // 1. Gather all base64 images from the document first to populate the image pool
    const docImages = tempDiv.querySelectorAll('img');
    docImages.forEach((img, idx) => {
        if (img.src && img.src.startsWith('data:')) {
            extractedImages.push({
                id: `pool_img_${idx}`,
                src: img.src
            });
        }
    });
    
    appState.imagePool = extractedImages;
    
    // Set default Cover Image if we found any images
    if (extractedImages.length > 0) {
        appState.settings.coverImg = extractedImages[0].src;
    }

    // Heuristic A: Look for table layouts (highly common in structured catalogs)
    const tables = tempDiv.querySelectorAll('table');
    if (tables.length > 0) {
        console.log(`Found ${tables.length} tables. Attempting structured parsing...`);
        
        tables.forEach((table, tableIdx) => {
            const rows = table.querySelectorAll('tr');
            
            rows.forEach((row, rowIdx) => {
                const cells = row.querySelectorAll('td');
                if (cells.length === 0) return;
                
                // Check if row contains cell with image and cell with text
                let cellImage = null;
                let cellTextChunks = [];
                let cellPrices = [];
                
                cells.forEach(cell => {
                    const img = cell.querySelector('img');
                    if (img && img.src && img.src.startsWith('data:')) {
                        cellImage = img.src;
                    }
                    
                    const text = cell.innerText || cell.textContent || '';
                    const cleanText = text.trim();
                    if (cleanText) {
                        cellTextChunks.push(cleanText);
                        
                        // Heuristic for finding prices inside cell text
                        const priceRegex = /(?:\$|usd|usd\s*|\$\s*)\s*(\d+(?:[\.,]\d+)*)/gi;
                        let match;
                        while ((match = priceRegex.exec(cleanText)) !== null) {
                            cellPrices.push(match[0]);
                        }
                    }
                });
                
                // If this row has content (either text & image, or text & price)
                if (cellTextChunks.length > 0) {
                    // Try to compile a candidate product
                    let fullText = cellTextChunks.join('\n');
                    let lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    if (lines.length > 0) {
                        let title = lines[0];
                        // Remove price from title if it got caught there
                        if (cellPrices.length > 0) {
                            title = title.replace(cellPrices[0], '').trim();
                        }
                        
                        let price = cellPrices.length > 0 ? cellPrices[0] : "";
                        let description = lines.slice(1).join(', ');
                        
                        // Clean up description if price is in it
                        if (price && description.includes(price)) {
                            description = description.replace(price, '').replace(/,\s*,/g, ',').trim();
                        }
                        
                        // Limit description length if too long
                        if (description.length > 150) {
                            description = description.substring(0, 147) + '...';
                        }
                        
                        // Avoid duplicates or parsing header columns (like "Imagen", "Nombre", "Precio")
                        const isHeader = /nombre|producto|precio|descripción|imagen/i.test(title);
                        
                        if (!isHeader && (title.length > 2 || cellImage)) {
                            detectedProducts.push({
                                id: `prod_${tableIdx}_${rowIdx}`,
                                title: title || `Producto sin Nombre #${rowIdx}`,
                                description: description || "Sin descripción disponible.",
                                price: price || "$ Consultar",
                                category: "General",
                                imageSrc: cellImage || ""
                            });
                        }
                    }
                }
            });
        });
    }

    // Heuristic B: Parsing paragraphs sequentially (if no tables were found or tables yielded very few items)
    if (detectedProducts.length < 3) {
        console.log("Tables did not provide enough data. Parsing paragraphs sequentially...");
        detectedProducts = []; // Reset table results to avoid duplicates
        
        let currentItem = { title: '', description: '', price: '', imageSrc: '', category: 'General' };
        let index = 0;
        
        // Scan elements of the div
        const children = Array.from(tempDiv.children);
        children.forEach(el => {
            const tagName = el.tagName.toLowerCase();
            const text = (el.textContent || el.innerText || '').trim();
            
            // Check for images
            const img = el.querySelector('img') || (tagName === 'img' ? el : null);
            if (img && img.src && img.src.startsWith('data:')) {
                if (currentItem.title || currentItem.imageSrc) {
                    currentItem.id = `prod_seq_${index++}`;
                    detectedProducts.push({...currentItem});
                    currentItem = { title: '', description: '', price: '', imageSrc: '', category: 'General' };
                }
                currentItem.imageSrc = img.src;
                return;
            }
            
            if (!text) return;
            
            // Heuristic for finding prices
            const priceRegex = /(?:\$|usd|usd\s*|\$\s*)\s*(\d+(?:[\.,]\d+)*)/i;
            const priceMatch = text.match(priceRegex);
            
            if (priceMatch) {
                currentItem.price = priceMatch[0];
                let remainingText = text.replace(priceMatch[0], '').trim();
                if (remainingText) {
                    if (!currentItem.title) {
                        currentItem.title = remainingText;
                    } else {
                        currentItem.description = (currentItem.description ? currentItem.description + " " : "") + remainingText;
                    }
                }
            } else if (tagName.startsWith('h')) {
                // Headers are treated as brand new product titles
                if (currentItem.title || currentItem.imageSrc) {
                    currentItem.id = `prod_seq_${index++}`;
                    detectedProducts.push({...currentItem});
                    currentItem = { title: '', description: '', price: '', imageSrc: '', category: 'General' };
                }
                currentItem.title = text;
            } else {
                // Normal paragraph text
                if (!currentItem.title) {
                    if (text.length < 50 && !/página|page|catalogo/i.test(text)) {
                        currentItem.title = text;
                    } else {
                        currentItem.description = text;
                    }
                } else {
                    currentItem.description = (currentItem.description ? currentItem.description + " " : "") + text;
                }
            }
            
            if (currentItem.description && currentItem.description.length > 200) {
                currentItem.description = currentItem.description.substring(0, 197) + '...';
            }
            
            // Auto commit if we have Title, Description, and Price
            if (currentItem.title && currentItem.price && currentItem.imageSrc) {
                currentItem.id = `prod_seq_${index++}`;
                detectedProducts.push({...currentItem});
                currentItem = { title: '', description: '', price: '', imageSrc: '', category: 'General' };
            }
        });
        
        // Push last item if outstanding
        if (currentItem.title || currentItem.imageSrc) {
            currentItem.id = `prod_seq_${index++}`;
            detectedProducts.push({...currentItem});
        }
    }

    // Clean up empty cards or bad items
    detectedProducts = detectedProducts.filter(p => p.title.length > 0 || p.imageSrc.length > 0);
    
    // Assign images to imageless products from the pool if available
    detectedProducts.forEach((prod, i) => {
        if (!prod.imageSrc && appState.imagePool.length > 0) {
            prod.imageSrc = appState.imagePool[i % appState.imagePool.length].src;
        }
        if (!prod.price) prod.price = "$ Consultar";
        if (!prod.description) prod.description = "Producto de alta calidad fabricado con tecnología de impresión 3D.";
    });

    appState.products = detectedProducts;
    
    // Populate UI
    renderProductCardsInEditor();
    updatePreviewAndStats();
}

// --- SWITCH VISUAL TABS (Within Catalog Creator Section) ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    elements.panelEditor.classList.remove('active');
    elements.panelPreview.classList.remove('active');
    elements.panelRaw.classList.remove('active');
    
    if (tabName === 'editor') elements.panelEditor.classList.add('active');
    if (tabName === 'preview') elements.panelPreview.classList.add('active');
    if (tabName === 'raw') elements.panelRaw.classList.add('active');
}

// --- RENDER DYNAMIC EDITOR GRID (Within Catalog Creator Section - Public Digital Catalog) ---
function renderProductCardsInEditor() {
    if (!elements.productGrid) return;
    elements.productGrid.innerHTML = '';
    
    if (appState.products.length === 0) {
        elements.productGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">No hay productos en tu catálogo digital. Añade uno nuevo, publica uno calculado o carga un documento de Word.</div>';
        return;
    }
    
    appState.products.forEach((prod) => {
        const card = document.createElement('div');
        card.className = 'product-card animate-fade';
        card.dataset.id = prod.id;
        
        let imgContent = `
            <div class="product-card-img-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span>Añadir Imagen</span>
            </div>
        `;
        
        if (prod.imageSrc) {
            imgContent = `<img src="${prod.imageSrc}" alt="${prod.title}">`;
        }
        
        card.innerHTML = `
            <button class="product-card-delete" onclick="deleteProduct('${prod.id}')" title="Eliminar Producto">×</button>
            <div class="product-card-img-container" onclick="openImageSelector('${prod.id}')">
                ${imgContent}
                <div class="img-change-badge">Cambiar Imagen</div>
            </div>
            <div class="product-card-fields">
                <div class="form-group">
                    <label>Título del Producto</label>
                    <input type="text" value="${prod.title}" oninput="updateProductField('${prod.id}', 'title', this.value)">
                </div>
                <div class="row-2">
                    <div class="form-group">
                        <label>Categoría / Etiqueta</label>
                        <input type="text" value="${prod.category || 'General'}" oninput="updateProductField('${prod.id}', 'category', this.value)">
                    </div>
                    <div class="form-group">
                        <label>Precio</label>
                        <input type="text" value="${prod.price}" oninput="updateProductField('${prod.id}', 'price', this.value)">
                    </div>
                </div>
                <div class="form-group">
                    <label>Descripción Corta</label>
                    <textarea rows="2" oninput="updateProductField('${prod.id}', 'description', this.value)">${prod.description}</textarea>
                </div>
            </div>
        `;
        
        elements.productGrid.appendChild(card);
    });
}

// Update single field of product in state and preview
window.updateProductField = function(id, field, value) {
    const prod = appState.products.find(p => p.id === id);
    if (prod) {
        prod[field] = value;
        updatePreviewAndStats();
        if (typeof pushPublicProductToCloud === 'function') pushPublicProductToCloud(prod);
    }
};

// Delete product card
window.deleteProduct = function(id) {
    appState.products = appState.products.filter(p => p.id !== id);
    renderProductCardsInEditor();
    updatePreviewAndStats();
    if (typeof deletePublicProductFromCloud === 'function') deletePublicProductFromCloud(id);
};

// Add empty product card
function addNewProduct() {
    const newId = `prod_new_${Date.now()}`;
    const newProd = {
        id: newId,
        title: "Nuevo Producto",
        description: "Descripción de tu nuevo e increíble producto de impresión 3D.",
        price: "$ 0.00",
        category: "Impresión",
        imageSrc: appState.imagePool.length > 0 ? appState.imagePool[0].src : ""
    };
    
    appState.products.push(newProd);
    renderProductCardsInEditor();
    updatePreviewAndStats();
    if (typeof pushPublicProductToCloud === 'function') pushPublicProductToCloud(newProd);
    
    switchTab('editor');
    
    setTimeout(() => {
        const cards = elements.productGrid.querySelectorAll('.product-card');
        if (cards.length > 0) {
            cards[cards.length - 1].scrollIntoView({ behavior: 'smooth' });
        }
    }, 100);
}

// --- IMAGE POOL SELECTOR FOR PRODUCTS ---
window.openImageSelector = function(productId) {
    appState.selectedProductForImgChange = productId;
    
    if (!elements.imagePoolGrid) return;
    elements.imagePoolGrid.innerHTML = '';
    
    if (appState.imagePool.length === 0) {
        elements.imagePoolGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-secondary);">
                No se encontraron imágenes en el documento de Word original.<br>
                Puedes usar el botón de subir abajo para añadir nuevas.
            </div>
        `;
    } else {
        // Render extracted pool images
        appState.imagePool.forEach(img => {
            const item = document.createElement('div');
            item.className = 'pool-img-item';
            
            // Check selections (both public and internal catalog image targets are supported)
            const activeProduct = appState.products.find(p => p.id === productId) || (appState.internalProducts && appState.internalProducts.find(p => p.id === productId));
            const isSelected = productId === 'COVER' ? (appState.settings.coverImg === img.src) : (activeProduct && activeProduct.imageSrc === img.src);
            if (isSelected) {
                item.classList.add('selected');
            }
            
            item.innerHTML = `<img src="${img.src}">`;
            item.addEventListener('click', () => selectImageFromPool(img.src));
            elements.imagePoolGrid.appendChild(item);
        });
    }

    // Add local upload action inside modal for extra convenience
    const uploadItem = document.createElement('div');
    uploadItem.className = 'pool-img-item';
    uploadItem.style.borderStyle = 'dashed';
    uploadItem.style.display = 'flex';
    uploadItem.style.flexDirection = 'column';
    uploadItem.style.gap = '4px';
    uploadItem.style.fontSize = '10px';
    uploadItem.style.color = 'var(--text-secondary)';
    
    uploadItem.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span>Subir</span>
        <input type="file" id="modal-img-upload" accept="image/*" style="display:none">
    `;
    
    uploadItem.addEventListener('click', () => {
        uploadItem.querySelector('input').click();
    });
    
    uploadItem.querySelector('input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const newImgSrc = event.target.result;
                appState.imagePool.push({
                    id: `pool_uploaded_${Date.now()}`,
                    src: newImgSrc
                });
                selectImageFromPool(newImgSrc);
            };
            reader.readAsDataURL(file);
        }
    });

    elements.imagePoolGrid.appendChild(uploadItem);
    elements.modalImageSelect.classList.add('active');
};

function selectImageFromPool(imgSrc) {
    const prodId = appState.selectedProductForImgChange;
    if (prodId === 'COVER') {
        appState.settings.coverImg = imgSrc;
        updatePreviewAndStats();
    } else if (prodId) {
        // First look inside public products
        let prod = appState.products.find(p => p.id === prodId);
        if (prod) {
            prod.imageSrc = imgSrc;
            renderProductCardsInEditor();
            updatePreviewAndStats();
        } else if (appState.internalProducts) {
            // Otherwise look inside internal products
            prod = appState.internalProducts.find(p => p.id === prodId);
            if (prod) {
                prod.imageSrc = imgSrc;
                renderInternalProductTable();
                saveStateToStorage();
            }
        }
    }
    elements.modalImageSelect.classList.remove('active');
}

// --- RENDER DYNAMIC A4 SHEETS & PAGE BUDGETING ---
function renderCatalogSheets() {
    if (!elements.previewSheets) return;
    elements.previewSheets.innerHTML = '';
    
    const sets = appState.settings;
    const itemsPerPage = sets.productsPerPage;
    
    let totalSheets = 0;
    
    // 1. Cover Page
    if (sets.showCover) {
        totalSheets++;
        const coverSheet = document.createElement('div');
        coverSheet.className = `a4-sheet theme-${sets.theme} margin-${sets.margins}`;
        coverSheet.style.setProperty('--catalog-accent', sets.accentColor || '#4f46e5');
        coverSheet.style.setProperty('--catalog-text', sets.textColor || '#1f2937');
        coverSheet.style.setProperty('--catalog-bg', sets.bgColor || '#ffffff');
        
        let coverImgHtml = '';
        if (sets.coverImg) {
            coverImgHtml = `<div class="cover-img-wrapper"><img src="${sets.coverImg}" alt="Cover Image"></div>`;
        }
        
        coverSheet.innerHTML = `
            <div class="cover-page">
                <div style="height: 10mm;"></div>
                <div class="cover-mid">
                    <h1 class="cover-title">${sets.catalogTitle}</h1>
                    <div class="cover-divider"></div>
                    <p class="cover-subtitle">${sets.catalogSubtitle}</p>
                    ${coverImgHtml}
                </div>
                <div class="cover-bottom">
                    <span class="brand-name">${sets.brandName}</span>
                    <span>${sets.brandContact}</span>
                </div>
            </div>
        `;
        
        elements.previewSheets.appendChild(coverSheet);
    }
    
    // 2. Product Pages
    const productChunks = chunkArray(appState.products, itemsPerPage);
    
    productChunks.forEach((chunk) => {
        totalSheets++;
        const sheet = document.createElement('div');
        sheet.className = `a4-sheet theme-${sets.theme} margin-${sets.margins}`;
        sheet.style.setProperty('--catalog-accent', sets.accentColor || '#4f46e5');
        sheet.style.setProperty('--catalog-text', sets.textColor || '#1f2937');
        sheet.style.setProperty('--catalog-bg', sets.bgColor || '#ffffff');
        
        let gridClass = 'grid-modern';
        if (sets.theme === 'luxury') gridClass = 'grid-luxury';
        if (sets.theme === 'industrial') gridClass = 'grid-industrial';
        
        let logoHeaderHtml = sets.brandName;
        if (sets.logoImg) {
            logoHeaderHtml = `<img src="${sets.logoImg}" class="header-logo" alt="Logo">`;
        }
        
        let productsHtml = '';
        chunk.forEach(prod => {
            let imgBoxHtml = '';
            if (prod.imageSrc) {
                imgBoxHtml = `<div class="prod-img-box"><img src="${prod.imageSrc}" alt="${prod.title}"></div>`;
            } else {
                imgBoxHtml = `<div class="prod-img-box"><div style="color:#d1d5db;font-size:10px;">Sin Imagen</div></div>`;
            }
            
            if (sets.theme === 'luxury') {
                productsHtml += `
                    <div class="prod-item">
                        ${imgBoxHtml}
                        <div class="prod-info-box">
                            <span class="prod-tag">${prod.category || 'General'}</span>
                            <h2 class="prod-title">${prod.title}</h2>
                            <p class="prod-desc">${prod.description}</p>
                            <span class="prod-price">${prod.price}</span>
                        </div>
                    </div>
                `;
            } else {
                productsHtml += `
                    <div class="prod-item">
                        ${imgBoxHtml}
                        <span class="prod-tag">${prod.category || 'General'}</span>
                        <h2 class="prod-title">${prod.title}</h2>
                        <p class="prod-desc">${prod.description}</p>
                        <span class="prod-price">${prod.price}</span>
                    </div>
                `;
            }
        });
        
        sheet.innerHTML = `
            <div class="catalog-header">
                <div class="header-brand">
                    ${logoHeaderHtml}
                </div>
                <div>${sets.catalogTitle}</div>
            </div>
            <div class="catalog-content">
                <div class="${gridClass}">
                    ${productsHtml}
                </div>
            </div>
            <div class="catalog-footer">
                <div>${sets.brandName} - Contacto: ${sets.brandContact.split('|')[0]}</div>
                <div>Página ${totalSheets}</div>
            </div>
        `;
        
        elements.previewSheets.appendChild(sheet);
    });
    
    // 3. Back Page
    if (sets.showBack) {
        totalSheets++;
        const backSheet = document.createElement('div');
        backSheet.className = `a4-sheet theme-${sets.theme} margin-${sets.margins}`;
        backSheet.style.setProperty('--catalog-accent', sets.accentColor || '#4f46e5');
        backSheet.style.setProperty('--catalog-text', sets.textColor || '#1f2937');
        backSheet.style.setProperty('--catalog-bg', sets.bgColor || '#ffffff');
        
        let contactDetailsHtml = `
            <div style="font-size:13px; color:#4b5563; line-height:2; margin-top:20px;">
                <strong>Branding &amp; Contacto</strong><br>
                ${sets.brandName}<br>
                ${sets.brandContact.replace(/\|/g, '<br>')}
            </div>
        `;
        
        backSheet.innerHTML = `
            <div class="back-page">
                <div class="back-top">
                    <h2>${sets.backTitle || '¡Gracias por elegirnos!'}</h2>
                    <p>${sets.backSubtitle || 'Hacemos realidad tus ideas en 3D'}</p>
                </div>
                <div class="back-mid">
                    <div class="qr-code-placeholder" title="WhatsApp Contact QR">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" stroke="currentColor" fill="none" stroke-width="2" style="width: 80px; height:80px; color:#4b5563;">
                            <path d="M10,10 H30 V30 H10 Z M15,15 H25 V25 H15 Z" fill="currentColor"/>
                            <path d="M70,10 H90 V30 H70 Z M75,15 H85 V25 H75 Z" fill="currentColor"/>
                            <path d="M10,70 H30 V90 H10 Z M15,75 H25 V85 H15 Z" fill="currentColor"/>
                            <path d="M40,10 H50 V30 H40 Z M45,40 H60 V55 H45 Z" fill="currentColor"/>
                            <path d="M70,70 H80 V90 H70 Z M80,60 H90 V70 H80 Z" fill="currentColor"/>
                            <circle cx="50" cy="80" r="3" fill="currentColor"/>
                            <rect x="40" y="65" width="8" height="8" fill="currentColor"/>
                        </svg>
                    </div>
                    ${contactDetailsHtml}
                </div>
                <div class="back-bottom">
                    <span>Impreso mediante el Generador de Catálogos JF 3D</span>
                    <span>Documento optimizado para impresión física o PDF</span>
                </div>
            </div>
        `;
        
        elements.previewSheets.appendChild(backSheet);
    }
    
    if (elements.statProducts) elements.statProducts.textContent = appState.products.length;
    if (elements.statPages) elements.statPages.textContent = totalSheets;
}

// Utility to chunk array into pages
function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

// --- UTILITY METHODS ---
function updatePreviewAndStats() {
    renderCatalogSheets();
    saveStateToStorage();
}

function showLoading(text) {
    if (elements.loadingOverlay) {
        elements.loadingText.textContent = text;
        elements.loadingOverlay.style.display = 'flex';
    }
}

// Unified Hide Overlay helper
function hideLoading() {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.style.display = 'none';
    }
}

// --- RESET TO SETUP STATE ---
function resetToSetupState() {
    appState.products = [];
    appState.imagePool = [];
    appState.settings.logoImg = "";
    appState.settings.coverImg = "";
    
    clearStorage();
    
    if (elements.logoUpload) elements.logoUpload.value = '';
    if (elements.coverUpload) elements.coverUpload.value = '';
    
    elements.sidebar.style.display = 'none';
    elements.panelSetup.style.display = 'flex';
    
    const navTabs = document.getElementById('nav-tabs');
    const statsView = document.getElementById('stats-view');
    if (navTabs) { navTabs.style.opacity = '0'; navTabs.style.pointerEvents = 'none'; }
    if (statsView) { statsView.style.opacity = '0'; statsView.style.pointerEvents = 'none'; }
    
    elements.productGrid.innerHTML = '';
    elements.previewSheets.innerHTML = '';
    elements.rawContent.innerHTML = '';
    elements.fileInput.value = '';
}

// --- SAMPLE DATA LOAD FOR SCREEN PREVIEW & EMPTY TESTING ---
function loadSampleDataIfEmpty() {
    console.log("Initializing default clean system state...");
    appState.inventory = [
        {
            id: 'spool_sample_1',
            brand: 'Printalot',
            material: 'PLA',
            color: 'Negro Mate',
            cost: 14500,
            weightGrams: 1000,
            remainingGrams: 850
        },
        {
            id: 'spool_sample_2',
            brand: 'Grilon3',
            material: 'PLA',
            color: 'Rojo Semáforo',
            cost: 13800,
            weightGrams: 1000,
            remainingGrams: 520
        }
    ];
    appState.orders = [];
    appState.products = [];
    appState.costSettings = {
        electricityRate: 15,
        depreciationRate: 25,
        errorMarginPercent: 10,
        markupPercent: 150,
        spoolId: 'spool_sample_1'
    };
    appState.internalProducts = [
        {
            id: 'prod_sample_1',
            title: 'Maceta Geométrica Mini',
            weightGrams: 45,
            hours: 4.5,
            spoolId: 'spool_sample_1',
            materialCost: 652.50,
            errorMarginPercent: 10,
            errorMarginCost: 65.25,
            electricityRate: 15,
            electricityCost: 67.50,
            depreciationRate: 25,
            depreciationCost: 112.50,
            netCost: 897.75,
            markupPercent: 150,
            profitCost: 1346.63,
            suggestedPrice: 2244.38,
            category: 'Calculado',
            imageSrc: ''
        },
        {
            id: 'prod_sample_2',
            title: 'Soporte Universal Celular',
            weightGrams: 30,
            hours: 3.0,
            spoolId: 'spool_sample_2',
            materialCost: 414.00,
            errorMarginPercent: 10,
            errorMarginCost: 41.40,
            electricityRate: 15,
            electricityCost: 45.00,
            depreciationRate: 25,
            depreciationCost: 75.00,
            netCost: 575.40,
            markupPercent: 150,
            profitCost: 863.10,
            suggestedPrice: 1438.50,
            category: 'Calculado',
            imageSrc: ''
        }
    ];
    saveStateToStorage();
    updateDashboardData();
}

// --- INDEXEDDB STATE PERSISTENCE ---
function saveStateToStorage() {
    getDB().then(db => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(appState, 'current_state');
    }).catch(err => {
        console.error('IndexedDB save error:', err);
    });
    if (typeof pushSettingsToCloud === 'function') {
        pushSettingsToCloud();
    }
}

function clearStorage() {
    getDB().then(db => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete('current_state');
    }).catch(err => {
        console.error('IndexedDB clear error:', err);
    });
}

function syncSidebarInputsFromState() {
    const sets = appState.settings;
    if (elements.inputBrandName) elements.inputBrandName.value = sets.brandName || '';
    if (elements.inputBrandContact) elements.inputBrandContact.value = sets.brandContact || '';
    if (elements.inputCatalogTitle) elements.inputCatalogTitle.value = sets.catalogTitle || '';
    if (elements.inputCatalogSubtitle) elements.inputCatalogSubtitle.value = sets.catalogSubtitle || '';
    if (elements.inputBackTitle) elements.inputBackTitle.value = sets.backTitle || '';
    if (elements.inputBackSubtitle) elements.inputBackSubtitle.value = sets.backSubtitle || '';
    if (elements.inputAccentColor) elements.inputAccentColor.value = sets.accentColor || '#4f46e5';
    if (elements.inputTextColor) elements.inputTextColor.value = sets.textColor || '#1f2937';
    if (elements.inputBgColor) elements.inputBgColor.value = sets.bgColor || '#ffffff';
    if (elements.inputProductsPerPage) elements.inputProductsPerPage.value = sets.productsPerPage || 4;
    if (elements.checkboxShowCover) elements.checkboxShowCover.checked = sets.showCover !== false;
    if (elements.checkboxShowBack) elements.checkboxShowBack.checked = sets.showBack !== false;
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.dataset.theme === sets.theme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    document.querySelectorAll('[data-margin]').forEach(btn => {
        if (btn.dataset.margin === sets.margins) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// --- GLOBAL MULTI-MODULE NAVIGATOR (SPA ROUTING) ---
window.switchModule = function(moduleName) {
    // Update desktop sidebar buttons
    document.querySelectorAll('.system-sidebar .nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`btn-nav-${moduleName}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Update mobile bottom nav buttons
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeMobileBtn = document.getElementById(`btn-mob-nav-${moduleName}`);
    if (activeMobileBtn) activeMobileBtn.classList.add('active');
    
    // Switch active view
    document.querySelectorAll('.module-view').forEach(view => {
        view.classList.remove('active');
    });
    const activeView = document.getElementById(`view-${moduleName}`);
    if (activeView) activeView.classList.add('active');

    // Smooth scroll to top on mobile and desktop
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const content = document.querySelector('.system-content');
    if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Initialize module data or updates
    if (moduleName === 'catalog') {
        updatePreviewAndStats();
    } else if (moduleName === 'dashboard') {
        updateDashboardData();
    } else if (moduleName === 'orders') {
        renderOrdersTable();
    } else if (moduleName === 'calculator') {
        updateFilamentDropdown();
        syncCostInputsFromState();
        calculatePrintCost();
        renderInternalProductTable();
    } else if (moduleName === 'inventory') {
        renderInventoryGrid();
    }
};

window.switchCatalogMobileTab = function(tabName) {
    const viewCatalog = document.getElementById('view-catalog');
    const btnEditor = document.getElementById('btn-cat-mob-editor');
    const btnPreview = document.getElementById('btn-cat-mob-preview');
    if (!viewCatalog) return;

    if (tabName === 'editor') {
        viewCatalog.classList.remove('mobile-tab-preview');
        viewCatalog.classList.add('mobile-tab-editor');
        if (btnEditor) btnEditor.classList.add('active');
        if (btnPreview) btnPreview.classList.remove('active');
    } else {
        viewCatalog.classList.remove('mobile-tab-editor');
        viewCatalog.classList.add('mobile-tab-preview');
        if (btnPreview) btnPreview.classList.add('active');
        if (btnEditor) btnEditor.classList.remove('active');
        if (typeof switchTab === 'function') {
            switchTab('preview');
        }
    }
};

// --- INVENTORY (FILAMENT) MANAGEMENT LOGIC ---
window.openAddFilamentModal = function() {
    const modal = document.getElementById('modal-add-filament');
    if (modal) modal.classList.add('active');
};

window.closeAddFilamentModal = function() {
    const modal = document.getElementById('modal-add-filament');
    if (modal) modal.classList.remove('active');
};

window.saveNewFilamentSpool = function() {
    const brand = document.getElementById('fil-brand').value.trim() || 'Grilon3';
    const material = document.getElementById('fil-material').value;
    const color = document.getElementById('fil-color').value.trim() || 'Natural';
    const cost = parseFloat(document.getElementById('fil-cost').value) || 12000;
    const weightGrams = parseFloat(document.getElementById('fil-weight').value) || 1000;
    
    const spool = {
        id: `spool_${Date.now()}`,
        brand,
        material,
        color,
        cost,
        weightGrams,
        remainingGrams: weightGrams
    };
    
    if (!appState.inventory) appState.inventory = [];
    appState.inventory.push(spool);
    
    saveStateToStorage();
    renderInventoryGrid();
    updateFilamentDropdown();
    recalculateInternalCatalog({ showToast: true });
    updateDashboardData();
    closeAddFilamentModal();
    if (typeof pushInventoryToCloud === 'function') pushInventoryToCloud(spool);
    
    // Reset form fields
    document.getElementById('fil-brand').value = '';
    document.getElementById('fil-color').value = '';
    document.getElementById('fil-cost').value = 12000;
    document.getElementById('fil-weight').value = 1000;
};

window.renderInventoryGrid = function() {
    const grid = document.getElementById('inventory-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (!appState.inventory || appState.inventory.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-secondary);">
                No hay bobinas registradas. Haz clic en "Registrar Filamento" para añadir una.
            </div>
        `;
        return;
    }
    
    appState.inventory.forEach(spool => {
        const percentage = Math.max(0, Math.min(100, (spool.remainingGrams / spool.weightGrams) * 100));
        
        let progressColor = 'var(--success)';
        if (percentage < 20) progressColor = '#ef4444';
        else if (percentage < 50) progressColor = '#f59e0b';
        
        const card = document.createElement('div');
        card.className = 'filament-spool-card animate-fade';
        
        card.innerHTML = `
            <div class="spool-card-header">
                <div>
                    <span class="spool-brand" style="font-weight:600; color:white; font-size:14px;">${spool.brand}</span>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${spool.material}</div>
                </div>
                <div class="spool-color-circle" style="background-color: ${getColorHex(spool.color)};" title="${spool.color}"></div>
            </div>
            
            <div style="font-size: 13px; font-weight: 500; color: white; margin-top: 4px;">${spool.color}</div>
            
            <div class="spool-gauge-container" style="margin-top: 10px;">
                <div class="spool-gauge-bar" style="width: ${percentage}%; background-color: ${progressColor};"></div>
            </div>
            
            <div class="spool-meta" style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                <span>Peso restante:</span>
                <strong style="color: white;">${spool.remainingGrams.toFixed(0)}g / ${spool.weightGrams}g</strong>
            </div>
            
            <div class="spool-meta" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span>Costo Bobina:</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="color: var(--text-muted); font-size: 11px;">$</span>
                    <input type="number" style="width: 85px; padding: 2px 6px; font-size: 11px; height: 22px; text-align: right;" value="${spool.cost}" onchange="updateSpoolCost('${spool.id}', this.value)" min="100" step="500" title="Modificar costo de bobina y actualizar catálogo">
                </div>
            </div>
            
            <div class="spool-card-actions" style="display: flex; align-items: center; justify-content: space-between; margin-top: 12px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="number" style="width: 70px; padding: 4px 6px; font-size:11px; height:24px;" value="${spool.remainingGrams}" onchange="updateSpoolGrams('${spool.id}', this.value)" min="0" max="${spool.weightGrams}">
                    <span style="font-size:10px; color:var(--text-muted);">g</span>
                </div>
                <button class="action-link delete" onclick="deleteSpool('${spool.id}')" style="font-size:11px; background:none; border:none; color:var(--danger); cursor:pointer;">Eliminar</button>
            </div>
        `;
        grid.appendChild(card);
    });
};

window.updateSpoolGrams = function(id, value) {
    const spool = appState.inventory.find(s => s.id === id);
    if (spool) {
        let grams = parseFloat(value);
        if (isNaN(grams)) grams = spool.weightGrams;
        spool.remainingGrams = Math.max(0, Math.min(spool.weightGrams, grams));
        saveStateToStorage();
        renderInventoryGrid();
        updateDashboardData();
        if (typeof pushInventoryToCloud === 'function') pushInventoryToCloud(spool);
    }
};

window.updateSpoolCost = function(id, value) {
    const spool = appState.inventory.find(s => s.id === id);
    if (spool) {
        let cost = parseFloat(value);
        if (isNaN(cost) || cost <= 0) cost = 12000;
        spool.cost = cost;
        saveStateToStorage();
        updateFilamentDropdown();
        calculatePrintCost();
        recalculateInternalCatalog({ showToast: true });
        updateDashboardData();
        if (typeof pushInventoryToCloud === 'function') pushInventoryToCloud(spool);
    }
};

window.deleteSpool = function(id) {
    if (confirm('¿Estás seguro de que deseas eliminar esta bobina de filamento?')) {
        appState.inventory = appState.inventory.filter(s => s.id !== id);
        saveStateToStorage();
        renderInventoryGrid();
        updateFilamentDropdown();
        recalculateInternalCatalog();
        updateDashboardData();
        if (typeof deleteInventoryFromCloud === 'function') deleteInventoryFromCloud(id);
    }
};

function getColorHex(colorName) {
    const name = colorName.toLowerCase();
    if (name.includes('rojo') || name.includes('red')) return '#ef4444';
    if (name.includes('verde') || name.includes('green')) return '#10b981';
    if (name.includes('azul') || name.includes('blue')) return '#3b82f6';
    if (name.includes('amarillo') || name.includes('yellow')) return '#f59e0b';
    if (name.includes('negro') || name.includes('black')) return '#111827';
    if (name.includes('blanco') || name.includes('white')) return '#f9fafb';
    if (name.includes('gris') || name.includes('grey') || name.includes('gray')) return '#6b7280';
    if (name.includes('naranja') || name.includes('orange')) return '#f97316';
    if (name.includes('violeta') || name.includes('purpura') || name.includes('purple')) return '#8b5cf6';
    if (name.includes('rosa') || name.includes('pink')) return '#ec4899';
    if (name.includes('oro') || name.includes('gold') || name.includes('dorado')) return '#d97706';
    if (name.includes('plata') || name.includes('silver')) return '#9ca3af';
    if (name.includes('cobre') || name.includes('copper')) return '#b45309';
    return '#4f46e5';
}

// --- COST CALCULATOR & INTERNAL CATALOG LOGIC ---
window.updateFilamentDropdown = function() {
    const select = document.getElementById('calc-filament');
    if (!select) return;
    
    const previousVal = select.value;
    select.innerHTML = '';
    
    if (!appState.inventory || appState.inventory.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'default_12000_1000';
        opt.textContent = 'Bobina Genérica ($12.000 / 1000g)';
        select.appendChild(opt);
        return;
    }
    
    appState.inventory.forEach(spool => {
        const opt = document.createElement('option');
        opt.value = spool.id;
        opt.textContent = `${spool.brand} ${spool.material} (${spool.color}) - $ ${spool.cost.toLocaleString('es-AR')}`;
        select.appendChild(opt);
    });

    if (previousVal && Array.from(select.options).some(o => o.value === previousVal)) {
        select.value = previousVal;
    } else if (appState.costSettings && appState.costSettings.spoolId) {
        if (Array.from(select.options).some(o => o.value === appState.costSettings.spoolId)) {
            select.value = appState.costSettings.spoolId;
        }
    }
};

window.syncCostInputsFromState = function() {
    if (!appState.costSettings) return;
    const sets = appState.costSettings;
    const electricityInput = document.getElementById('calc-electricity');
    const depreciationInput = document.getElementById('calc-depreciation');
    const errorMarginInput = document.getElementById('calc-error-margin');
    const markupInput = document.getElementById('calc-markup');
    const filamentSelect = document.getElementById('calc-filament');

    if (electricityInput && sets.electricityRate !== undefined) electricityInput.value = sets.electricityRate;
    if (depreciationInput && sets.depreciationRate !== undefined) depreciationInput.value = sets.depreciationRate;
    if (errorMarginInput && sets.errorMarginPercent !== undefined) errorMarginInput.value = sets.errorMarginPercent;
    if (markupInput && sets.markupPercent !== undefined) markupInput.value = sets.markupPercent;
    if (filamentSelect && sets.spoolId) {
        if (Array.from(filamentSelect.options).some(o => o.value === sets.spoolId)) {
            filamentSelect.value = sets.spoolId;
        }
    }
};

window.showToast = function(msg) {
    let toast = document.getElementById('system-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'system-toast';
        toast.className = 'system-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" style="width:18px; height:18px; color:var(--success);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>${msg}</span>
    `;
    toast.classList.add('show');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
};

window.calculatePrintCost = function() {
    const select = document.getElementById('calc-filament');
    if (!select) return;
    
    let spoolCost = 12000;
    let spoolWeight = 1000;
    
    const selectedId = select.value;
    if (selectedId && selectedId !== 'default_12000_1000') {
        const spool = (appState.inventory || []).find(s => s.id === selectedId);
        if (spool) {
            spoolCost = spool.cost;
            spoolWeight = spool.weightGrams;
        }
    }
    
    const weight = parseFloat(document.getElementById('calc-weight')?.value) || 0;
    const hours = parseFloat(document.getElementById('calc-hours')?.value) || 0;
    const errorPercent = parseFloat(document.getElementById('calc-error-margin')?.value) || 0;
    const markup = parseFloat(document.getElementById('calc-markup')?.value) || 0;
    const electricityRate = parseFloat(document.getElementById('calc-electricity')?.value) || 0;
    const depreciationRate = parseFloat(document.getElementById('calc-depreciation')?.value) || 0;
    
    const materialCost = weight * (spoolCost / spoolWeight);
    const errorMarginCost = materialCost * (errorPercent / 100);
    const electricityCost = hours * electricityRate;
    const depreciationCost = hours * depreciationRate;
    const netCost = materialCost + errorMarginCost + electricityCost + depreciationCost;
    const profitCost = netCost * (markup / 100);
    const suggestedPrice = netCost + profitCost;
    
    const elMat = document.getElementById('calc-cost-material');
    const elErr = document.getElementById('calc-cost-error');
    const elElec = document.getElementById('calc-cost-electricity');
    const elDep = document.getElementById('calc-cost-depreciation');
    const elNet = document.getElementById('calc-cost-net');
    const elPrice = document.getElementById('calc-price-suggested');

    if (elMat) elMat.textContent = `$ ${materialCost.toFixed(2)}`;
    if (elErr) elErr.textContent = `$ ${errorMarginCost.toFixed(2)}`;
    if (elElec) elElec.textContent = `$ ${electricityCost.toFixed(2)}`;
    if (elDep) elDep.textContent = `$ ${depreciationCost.toFixed(2)}`;
    if (elNet) elNet.textContent = `$ ${netCost.toFixed(2)}`;
    if (elPrice) elPrice.textContent = `$ ${suggestedPrice.toFixed(2)}`;
};

window.onCostFormChange = function(event) {
    calculatePrintCost();
    const targetId = event && event.target ? event.target.id : '';
    // If the input modified is a cost factor, instantly update the entire internal catalog
    if (['calc-electricity', 'calc-depreciation', 'calc-error-margin', 'calc-markup', 'calc-filament'].includes(targetId)) {
        recalculateInternalCatalog({ silent: true });
    }
};

window.onFilamentDropdownChange = function() {
    calculatePrintCost();
    recalculateInternalCatalog({ silent: true });
};

// Recalculates all items in the internal catalog with current cost parameters
window.recalculateInternalCatalog = function(options = {}) {
    const electricityInput = document.getElementById('calc-electricity');
    const depreciationInput = document.getElementById('calc-depreciation');
    const errorMarginInput = document.getElementById('calc-error-margin');
    const markupInput = document.getElementById('calc-markup');
    const filamentSelect = document.getElementById('calc-filament');

    const electricityRate = electricityInput ? (parseFloat(electricityInput.value) || 0) : (appState.costSettings?.electricityRate ?? 15);
    const depreciationRate = depreciationInput ? (parseFloat(depreciationInput.value) || 0) : (appState.costSettings?.depreciationRate ?? 25);
    const errorPercent = errorMarginInput ? (parseFloat(errorMarginInput.value) || 0) : (appState.costSettings?.errorMarginPercent ?? 10);
    const markup = markupInput ? (parseFloat(markupInput.value) || 0) : (appState.costSettings?.markupPercent ?? 150);
    const selectedSpoolId = filamentSelect ? filamentSelect.value : (appState.costSettings?.spoolId || '');

    // Persist cost settings in appState
    appState.costSettings = {
        electricityRate,
        depreciationRate,
        errorMarginPercent: errorPercent,
        markupPercent: markup,
        spoolId: selectedSpoolId
    };

    // Determine fallback/default spool cost and weight from active select
    let activeSpoolCost = 12000;
    let activeSpoolWeight = 1000;
    if (selectedSpoolId && selectedSpoolId !== 'default_12000_1000') {
        const found = (appState.inventory || []).find(s => s.id === selectedSpoolId);
        if (found) {
            activeSpoolCost = found.cost;
            activeSpoolWeight = found.weightGrams;
        }
    }

    if (!appState.internalProducts) appState.internalProducts = [];

    appState.internalProducts.forEach(prod => {
        const weight = parseFloat(prod.weightGrams) || 0;
        const hours = parseFloat(prod.hours) || 0;

        let spoolCost = activeSpoolCost;
        let spoolWeight = activeSpoolWeight;

        if (prod.spoolId && prod.spoolId !== 'default_12000_1000') {
            const specificSpool = (appState.inventory || []).find(s => s.id === prod.spoolId);
            if (specificSpool) {
                spoolCost = specificSpool.cost;
                spoolWeight = specificSpool.weightGrams;
            }
        }

        const itemMarkup = (prod.customMarkup !== undefined && prod.customMarkup !== null) ? prod.customMarkup : markup;
        const itemErrorMargin = (prod.customErrorMargin !== undefined && prod.customErrorMargin !== null) ? prod.customErrorMargin : errorPercent;

        const materialCost = weight * (spoolCost / spoolWeight);
        const errorMarginCost = materialCost * (itemErrorMargin / 100);
        const electricityCost = hours * electricityRate;
        const depreciationCost = hours * depreciationRate;
        const netCost = materialCost + errorMarginCost + electricityCost + depreciationCost;
        const profitCost = netCost * (itemMarkup / 100);
        const suggestedPrice = netCost + profitCost;

        prod.materialCost = materialCost;
        prod.errorMarginPercent = itemErrorMargin;
        prod.errorMarginCost = errorMarginCost;
        prod.electricityRate = electricityRate;
        prod.electricityCost = electricityCost;
        prod.depreciationRate = depreciationRate;
        prod.depreciationCost = depreciationCost;
        prod.netCost = netCost;
        prod.markupPercent = itemMarkup;
        prod.profitCost = profitCost;
        prod.suggestedPrice = suggestedPrice;

        // Auto-update price of linked product in sales catalog
        if (appState.products && appState.products.length > 0) {
            const linkedProd = appState.products.find(p => p.internalProdId === prod.id);
            if (linkedProd) {
                linkedProd.price = `$ ${suggestedPrice.toFixed(2)}`;
            }
        }
    });

    saveStateToStorage();
    renderInternalProductTable();

    if (options.showToast) {
        showToast('Catálogo interno recalculado y actualizado con éxito.');
    }
};

// Saves calculated item directly to the Catálogo Interno
window.pushCalculatedProductToCatalog = function() {
    const nameInput = document.getElementById('calc-prod-name');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Por favor, ingresa un nombre para el producto antes de agregarlo al catálogo.');
        return;
    }
    
    const select = document.getElementById('calc-filament');
    const selectedId = select ? select.value : '';
    let spoolCost = 12000;
    let spoolWeight = 1000;
    
    if (selectedId && selectedId !== 'default_12000_1000') {
        const spool = (appState.inventory || []).find(s => s.id === selectedId);
        if (spool) {
            spoolCost = spool.cost;
            spoolWeight = spool.weightGrams;
        }
    }
    
    const weight = parseFloat(document.getElementById('calc-weight')?.value) || 0;
    const hours = parseFloat(document.getElementById('calc-hours')?.value) || 0;
    const errorPercent = parseFloat(document.getElementById('calc-error-margin')?.value) || 0;
    const markup = parseFloat(document.getElementById('calc-markup')?.value) || 0;
    const electricityRate = parseFloat(document.getElementById('calc-electricity')?.value) || 0;
    const depreciationRate = parseFloat(document.getElementById('calc-depreciation')?.value) || 0;
    
    const materialCost = weight * (spoolCost / spoolWeight);
    const errorMarginCost = materialCost * (errorPercent / 100);
    const electricityCost = hours * electricityRate;
    const depreciationCost = hours * depreciationRate;
    const netCost = materialCost + errorMarginCost + electricityCost + depreciationCost;
    const profitCost = netCost * (markup / 100);
    const suggestedPrice = netCost + profitCost;
    
    const newProd = {
        id: `prod_calc_${Date.now()}`,
        title: name,
        weightGrams: weight,
        hours: hours,
        spoolId: (selectedId && selectedId !== 'default_12000_1000') ? selectedId : null,
        materialCost: materialCost,
        errorMarginPercent: errorPercent,
        errorMarginCost: errorMarginCost,
        electricityRate: electricityRate,
        electricityCost: electricityCost,
        depreciationRate: depreciationRate,
        depreciationCost: depreciationCost,
        netCost: netCost,
        markupPercent: markup,
        profitCost: profitCost,
        suggestedPrice: suggestedPrice,
        category: 'Calculado',
        imageSrc: appState.imagePool && appState.imagePool.length > 0 ? appState.imagePool[0].src : ""
    };
    
    if (!appState.internalProducts) appState.internalProducts = [];
    appState.internalProducts.push(newProd);
    
    nameInput.value = '';
    
    saveStateToStorage();
    renderInternalProductTable();
    showToast(`¡"${name}" guardado en el Catálogo Interno!`);
    if (typeof pushInternalProductToCloud === 'function') pushInternalProductToCloud(newProd);
};

// Render Catálogo Interno Tabular Sheet
window.renderInternalProductTable = function() {
    const tbody = document.getElementById('calculator-internal-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!appState.internalProducts || appState.internalProducts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align:center;color:var(--text-secondary);padding:30px;">
                    No hay productos guardados en tu catálogo interno. Usa los controles superiores para calcular y guardar un item.
                </td>
            </tr>
        `;
        return;
    }
    
    appState.internalProducts.forEach(prod => {
        const tr = document.createElement('tr');
        tr.className = 'catalog-row-updated';
        
        const weight = prod.weightGrams || 0;
        const matCost = prod.materialCost || 0;
        const hours = prod.hours || 0;
        const elecCost = prod.electricityCost || 0;
        const depCost = prod.depreciationCost || 0;
        const errCost = prod.errorMarginCost || 0;
        const net = prod.netCost || 0;
        const profit = prod.profitCost || 0;
        const suggested = prod.suggestedPrice || 0;
        
        tr.innerHTML = `
            <td><strong>${prod.title}</strong></td>
            <td class="col-suggested" style="text-align: center;"><strong style="color:var(--success); font-size:14px;">$ ${suggested.toFixed(2)}</strong></td>
            <td class="col-time" style="text-align: center;">⏱️ ${hours.toFixed(1)}h</td>
            <td class="col-actions" style="text-align: center;">
                <div style="display:flex; gap:6px; justify-content:center; flex-wrap:nowrap;">
                    <button class="btn btn-secondary btn-small btn-view-prod-action" onclick="openViewInternalProductModal('${prod.id}')" style="padding:4px 8px; font-size:11px; width:auto; color:var(--jf-blue); border-color:rgba(0,153,255,0.35);" title="Ver todos los datos y desglose de costos">
                        👁️ Ver
                    </button>
                    <button class="btn btn-secondary btn-small" onclick="openEditInternalProductModal('${prod.id}')" style="padding:4px 8px; font-size:11px; width:auto;" title="Editar dimensiones y parámetros">
                        Editar
                    </button>
                    <button class="btn btn-primary btn-small" onclick="publishProductToDigital('${prod.id}')" style="padding:4px 8px; font-size:11px; width:auto;" title="Publicar al catálogo de ventas">
                        Publicar
                    </button>
                    <button class="btn btn-secondary btn-small" onclick="deleteInternalProduct('${prod.id}')" style="padding:4px 8px; font-size:11px; width:auto; color:var(--danger); border-color:rgba(239,68,68,0.2);" title="Eliminar del catálogo interno">
                        Eliminar
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
};

window.openViewInternalProductModal = function(id) {
    const prod = (appState.internalProducts || []).find(p => p.id === id);
    if (!prod) return;

    const modal = document.getElementById('modal-view-internal-product');
    const title = document.getElementById('view-prod-modal-title');
    const body = document.getElementById('view-prod-modal-body');
    const btnEdit = document.getElementById('view-prod-btn-edit');

    if (title) title.textContent = prod.title;
    if (btnEdit) {
        btnEdit.onclick = () => {
            closeViewInternalProductModal();
            openEditInternalProductModal(prod.id);
        };
    }

    let spoolName = 'Bobina General';
    if (prod.spoolId && prod.spoolId !== 'default_12000_1000') {
        const spool = (appState.inventory || []).find(s => s.id === prod.spoolId);
        if (spool) spoolName = `${spool.brand} ${spool.material} (${spool.color})`;
    }

    const weight = prod.weightGrams || 0;
    const hours = prod.hours || 0;
    const matCost = prod.materialCost || 0;
    const elecCost = prod.electricityCost || 0;
    const depCost = prod.depreciationCost || 0;
    const errPercent = prod.errorMarginPercent || 10;
    const errCost = prod.errorMarginCost || 0;
    const netCost = prod.netCost || 0;
    const markupPercent = prod.markupPercent || 150;
    const profitCost = prod.profitCost || 0;
    const suggested = prod.suggestedPrice || 0;

    if (body) {
        body.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <!-- Main KPI Card -->
                <div style="background: linear-gradient(135deg, rgba(236,72,153,0.12), rgba(0,153,255,0.12)); border: 1px solid rgba(0,153,255,0.3); border-radius: 14px; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.5px;">Valor Sugerido</span>
                        <h2 style="font-size: 24px; font-weight: 700; color: var(--success); margin-top: 2px;">$ ${suggested.toFixed(2)}</h2>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 11px; color: var(--text-secondary);">Tiempo de Impresión</span>
                        <div style="font-size: 17px; font-weight: 700; color: white; margin-top: 2px;">⏱️ ${hours.toFixed(1)} hs</div>
                    </div>
                </div>

                <!-- Complete Cost Parameters Breakdown -->
                <div style="background: rgba(10, 12, 16, 0.6); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 9px; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--border-color);">
                        <span style="color: var(--text-secondary);">🧵 Filamento:</span>
                        <strong style="color: white; text-align: right; max-width: 65%;">${spoolName}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">⚖️ Peso del Modelo:</span>
                        <strong style="color: white;">${weight.toFixed(0)} gramos</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">💵 Costo de Material:</span>
                        <strong style="color: white;">$ ${matCost.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">⚡ Electricidad (${prod.electricityRate || 15}/h):</span>
                        <strong style="color: white;">$ ${elecCost.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">🛠️ Desgaste Impresora (${prod.depreciationRate || 25}/h):</span>
                        <strong style="color: white;">$ ${depCost.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">⚠️ Margen de Error (${errPercent}%):</span>
                        <strong style="color: white;">$ ${errCost.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                        <span style="color: var(--text-primary); font-weight: 600;">📊 Costo Total de Producción:</span>
                        <strong style="color: #cbd5e1; font-weight: 700;">$ ${netCost.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">📈 Margen Ganancia (${markupPercent}%):</span>
                        <strong style="color: var(--jf-blue); font-weight: 700;">+ $ ${profitCost.toFixed(2)}</strong>
                    </div>
                </div>
            </div>
        `;
    }

    if (modal) modal.classList.add('active');
};

window.closeViewInternalProductModal = function() {
    const modal = document.getElementById('modal-view-internal-product');
    if (modal) modal.classList.remove('active');
};

window.deleteInternalProduct = function(id) {
    if (confirm('¿Estás seguro de que deseas eliminar este diseño de tu catálogo interno?')) {
        appState.internalProducts = appState.internalProducts.filter(p => p.id !== id);
        saveStateToStorage();
        renderInternalProductTable();
        showToast('Producto eliminado del catálogo interno.');
        if (typeof deleteInternalProductFromCloud === 'function') deleteInternalProductFromCloud(id);
    }
};

window.openEditInternalProductModal = function(id) {
    const prod = (appState.internalProducts || []).find(p => p.id === id);
    if (!prod) return;

    document.getElementById('edit-prod-id').value = prod.id;
    document.getElementById('edit-prod-title').value = prod.title || '';
    document.getElementById('edit-prod-weight').value = prod.weightGrams || 0;
    document.getElementById('edit-prod-hours').value = prod.hours || 0;
    document.getElementById('edit-prod-markup').value = (prod.customMarkup !== undefined ? prod.customMarkup : prod.markupPercent) || 150;

    const spoolSelect = document.getElementById('edit-prod-spool');
    if (spoolSelect) {
        spoolSelect.innerHTML = '<option value="">(Usar bobina activa de la calculadora)</option>';
        (appState.inventory || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.brand} ${s.material} (${s.color}) - $ ${s.cost.toLocaleString('es-AR')}`;
            if (prod.spoolId === s.id) opt.selected = true;
            spoolSelect.appendChild(opt);
        });
    }

    const modal = document.getElementById('modal-edit-internal-product');
    if (modal) modal.classList.add('active');
};

window.closeEditInternalProductModal = function() {
    const modal = document.getElementById('modal-edit-internal-product');
    if (modal) modal.classList.remove('active');
};

window.saveEditedInternalProduct = function() {
    const id = document.getElementById('edit-prod-id').value;
    const prod = (appState.internalProducts || []).find(p => p.id === id);
    if (!prod) return;

    const title = document.getElementById('edit-prod-title').value.trim();
    if (!title) {
        alert('Por favor, ingresa un nombre para el producto.');
        return;
    }

    const weight = parseFloat(document.getElementById('edit-prod-weight').value) || 0;
    const hours = parseFloat(document.getElementById('edit-prod-hours').value) || 0;
    const markup = parseFloat(document.getElementById('edit-prod-markup').value);
    const spoolId = document.getElementById('edit-prod-spool').value || null;

    prod.title = title;
    prod.weightGrams = weight;
    prod.hours = hours;
    prod.spoolId = spoolId;
    if (!isNaN(markup) && markup >= 0) {
        prod.customMarkup = markup;
        prod.markupPercent = markup;
    }

    closeEditInternalProductModal();
    recalculateInternalCatalog({ showToast: true });
    if (typeof pushInternalProductToCloud === 'function') pushInternalProductToCloud(prod);
};

// Copies a template item from Catálogo Interno to Catálogo Público/Digital
window.publishProductToDigital = function(prodId) {
    const internalProd = (appState.internalProducts || []).find(p => p.id === prodId);
    if (!internalProd) return;
    
    const suggested = internalProd.suggestedPrice || 0;
    
    // Check if item was already published by internalProdId or exact title
    if (!appState.products) appState.products = [];
    const existing = appState.products.find(p => p.internalProdId === internalProd.id || p.title.trim().toLowerCase() === internalProd.title.trim().toLowerCase());
    if (existing) {
        existing.internalProdId = internalProd.id;
        existing.price = `$ ${suggested.toFixed(2)}`;
        existing.description = `Modelo fabricado en impresión 3D. Peso neto: ${internalProd.weightGrams || 0}g. Tiempo estimado de manufactura: ${internalProd.hours || 0}h.`;
        saveStateToStorage();
        renderProductCardsInEditor();
        updatePreviewAndStats();
        showToast(`¡"${internalProd.title}" actualizado en Catálogo Digital!`);
        if (typeof pushPublicProductToCloud === 'function') pushPublicProductToCloud(existing);
        switchModule('catalog');
        return;
    }
    
    const clonedProd = {
        id: `prod_pub_${Date.now()}`,
        internalProdId: internalProd.id,
        title: internalProd.title,
        description: `Modelo fabricado en impresión 3D. Peso neto: ${internalProd.weightGrams || 0}g. Tiempo estimado de manufactura: ${internalProd.hours || 0}h.`,
        price: `$ ${suggested.toFixed(2)}`,
        category: 'Calculado',
        imageSrc: internalProd.imageSrc || (appState.imagePool && appState.imagePool.length > 0 ? appState.imagePool[0].src : "")
    };
    
    appState.products.push(clonedProd);
    
    saveStateToStorage();
    renderProductCardsInEditor();
    updatePreviewAndStats();
    
    showToast(`¡"${internalProd.title}" publicado con éxito en tu catálogo de ventas!`);
    if (typeof pushPublicProductToCloud === 'function') pushPublicProductToCloud(clonedProd);
    switchModule('catalog');
};

// Syncs all internal products with matching titles or internalProdIds in the sales catalog
window.syncAllInternalPricesToSalesCatalog = function() {
    if (!appState.internalProducts || appState.internalProducts.length === 0) {
        alert('No hay productos en el catálogo interno para sincronizar.');
        return;
    }
    
    let updatedCount = 0;
    appState.internalProducts.forEach(internalProd => {
        const matches = (appState.products || []).filter(p => p.internalProdId === internalProd.id || p.title.trim().toLowerCase() === internalProd.title.trim().toLowerCase());
        matches.forEach(p => {
            p.internalProdId = internalProd.id;
            p.price = `$ ${(internalProd.suggestedPrice || 0).toFixed(2)}`;
            updatedCount++;
        });
    });

    if (updatedCount > 0) {
        saveStateToStorage();
        renderProductCardsInEditor();
        updatePreviewAndStats();
        showToast(`Se sincronizaron ${updatedCount} precio(s) con el Catálogo de Ventas.`);
    } else {
        alert('No se encontraron productos coincidentes en el Catálogo de Ventas. Usa el botón "Publicar" en cada fila para agregarlos.');
    }
};

// --- CUSTOMER ORDERS TRACKER LOGIC ---
window.openNewOrderModal = function() {
    const modal = document.getElementById('modal-new-order');
    if (!modal) return;
    
    document.getElementById('order-client').value = '';
    document.getElementById('order-payment').value = 'Pendiente';
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('order-delivery-date').value = today;
    
    const searchInput = document.getElementById('order-product-search');
    if (searchInput) searchInput.value = '';
    
    const productListBox = document.getElementById('order-product-list');
    if (productListBox) {
        productListBox.innerHTML = '';
        const internalList = appState.internalProducts || [];
        if (internalList.length === 0) {
            productListBox.innerHTML = `
                <div style="color:var(--text-secondary); font-size:12px; padding:16px; text-align:center; line-height:1.5;">
                    ⚠️ No tienes productos guardados en tu <strong>Catálogo Interno</strong>.<br>
                    Calcula y guarda productos en la sección <strong>Calculadora</strong> para seleccionarlos aquí.
                </div>
            `;
        } else {
            internalList.forEach(prod => {
                const item = document.createElement('label');
                item.className = 'order-product-item';
                item.dataset.title = prod.title || '';
                const price = Number(prod.suggestedPrice || 0);
                const weight = Number(prod.weightGrams || 0);
                const hours = Number(prod.hours || 0);
                item.innerHTML = `
                    <input type="checkbox" class="order-prod-checkbox" value="${prod.title}" data-price="${price}" data-weight="${weight}">
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px;">
                        <div>
                            <strong style="color:var(--text-primary); font-size:13px;">${prod.title}</strong>
                            <div style="color:var(--text-secondary); font-size:11px;">⚖️ ${weight.toFixed(0)}g • ⏱️ ${hours.toFixed(1)}h</div>
                        </div>
                        <div style="color:var(--success); font-weight:700; font-size:13px; white-space:nowrap;">
                            $ ${price.toFixed(2)}
                        </div>
                    </div>
                `;
                productListBox.appendChild(item);
            });
        }
    }
    
    modal.classList.add('active');
};

window.filterOrderProducts = function(query) {
    const q = (query || '').toLowerCase().trim();
    const items = document.querySelectorAll('#order-product-list .order-product-item');
    let visibleCount = 0;
    items.forEach(item => {
        const title = (item.dataset.title || '').toLowerCase();
        if (!q || title.includes(q)) {
            item.style.display = 'flex';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });
    
    let noResultsEl = document.getElementById('order-product-no-results');
    if (visibleCount === 0 && items.length > 0) {
        if (!noResultsEl) {
            noResultsEl = document.createElement('div');
            noResultsEl.id = 'order-product-no-results';
            noResultsEl.style.cssText = 'color:var(--text-secondary); font-size:12px; padding:16px; text-align:center;';
            noResultsEl.textContent = 'No se encontraron productos con ese nombre.';
            const list = document.getElementById('order-product-list');
            if (list) list.appendChild(noResultsEl);
        }
        noResultsEl.style.display = 'block';
    } else if (noResultsEl) {
        noResultsEl.style.display = 'none';
    }
};

window.closeNewOrderModal = function() {
    const modal = document.getElementById('modal-new-order');
    if (modal) modal.classList.remove('active');
};

window.saveNewOrder = function() {
    const clientName = document.getElementById('order-client').value.trim();
    if (!clientName) {
        alert('Por favor, ingresa el nombre del cliente.');
        return;
    }
    
    const checkboxes = document.querySelectorAll('.order-prod-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('Por favor, selecciona al menos un producto para el pedido.');
        return;
    }
    
    const products = [];
    let totalPrice = 0;
    
    checkboxes.forEach(cb => {
        products.push(cb.value);
        const priceNum = parseFloat(cb.dataset.price) || 0;
        totalPrice += priceNum;
    });
    
    const payment = document.getElementById('order-payment').value;
    const date = document.getElementById('order-delivery-date').value;
    
    const newOrder = {
        id: `order_${Date.now()}`,
        clientName,
        products,
        totalPrice,
        status: 'En Cola',
        payment,
        date,
        filamentDeducted: false
    };
    
    if (!appState.orders) appState.orders = [];
    appState.orders.push(newOrder);
    
    saveStateToStorage();
    renderOrdersTable();
    updateDashboardData();
    closeNewOrderModal();
    if (typeof pushOrderToCloud === 'function') pushOrderToCloud(newOrder);
};

window.renderOrdersTable = function() {
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!appState.orders || appState.orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center;color:var(--text-secondary);padding:40px;">
                    No hay pedidos registrados en el sistema. Haz clic en "Nuevo Pedido" para comenzar.
                </td>
            </tr>
        `;
        return;
    }
    
    appState.orders.forEach(order => {
        const tr = document.createElement('tr');
        
        const statusOptions = ['En Cola', 'Laminando', 'Imprimiendo', 'Terminado', 'Entregado'];
        let statusSelectHtml = `<select onchange="updateOrderStatus('${order.id}', 'status', this.value)" style="padding: 4px; font-size:12px; width:auto; border-radius:4px; background:rgba(10, 12, 16, 0.8); color: white; border: 1px solid var(--border-color);">`;
        statusOptions.forEach(opt => {
            const selected = order.status === opt ? 'selected' : '';
            statusSelectHtml += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
        statusSelectHtml += `</select>`;
        
        const paymentOptions = ['Pendiente', 'Seña Pagada', 'Pagado Completo'];
        let paymentSelectHtml = `<select onchange="updateOrderStatus('${order.id}', 'payment', this.value)" style="padding: 4px; font-size:12px; width:auto; border-radius:4px; background:rgba(10, 12, 16, 0.8); color: white; border: 1px solid var(--border-color);">`;
        paymentOptions.forEach(opt => {
            const selected = order.payment === opt ? 'selected' : '';
            paymentSelectHtml += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
        paymentSelectHtml += `</select>`;
        
        let formattedDate = 'Sin fecha';
        if (order.date) {
            const dateParts = order.date.split('-');
            if (dateParts.length === 3) {
                formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            } else {
                formattedDate = order.date;
            }
        }
        
        tr.innerHTML = `
            <td><strong>#${order.id.slice(-4)}</strong></td>
            <td>${order.clientName}</td>
            <td style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${order.products.join(', ')}">
                ${order.products.join(', ')}
            </td>
            <td><strong>$ ${order.totalPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></td>
            <td>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="badge ${getPrintBadgeClass(order.status)}">${order.status}</span>
                    ${statusSelectHtml}
                </div>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="badge ${getPaymentBadgeClass(order.payment)}">${order.payment}</span>
                    ${paymentSelectHtml}
                </div>
            </td>
            <td>${formattedDate}</td>
            <td style="text-align: center;">
                <button class="btn btn-secondary btn-small" onclick="deleteOrder('${order.id}')" style="background:transparent; color:var(--danger); border:1px solid rgba(239,68,68,0.2); width:auto;">
                    Eliminar
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
};

window.updateOrderStatus = function(id, field, value) {
    const order = appState.orders.find(o => o.id === id);
    if (order) {
        order[field] = value;
        
        if (field === 'status' && (value === 'Terminado' || value === 'Entregado')) {
            deductFilamentForOrder(order);
        }
        
        saveStateToStorage();
        renderOrdersTable();
        updateDashboardData();
        if (typeof pushOrderToCloud === 'function') pushOrderToCloud(order);
    }
};

window.deleteOrder = function(id) {
    if (confirm('¿Estás seguro de que deseas eliminar este pedido?')) {
        appState.orders = appState.orders.filter(o => o.id !== id);
        saveStateToStorage();
        renderOrdersTable();
        updateDashboardData();
        if (typeof deleteOrderFromCloud === 'function') deleteOrderFromCloud(id);
    }
};

function getPrintBadgeClass(status) {
    switch (status) {
        case 'En Cola': return 'badge-print-pending';
        case 'Laminando': return 'badge-print-slicing';
        case 'Imprimiendo': return 'badge-print-printing';
        case 'Terminado': return 'badge-print-finished';
        case 'Entregado': return 'badge-print-delivered';
        default: return 'badge-print-pending';
    }
}

function getPaymentBadgeClass(payment) {
    switch (payment) {
        case 'Pendiente': return 'badge-pay-pending';
        case 'Seña Pagada': return 'badge-pay-deposit';
        case 'Pagado Completo': return 'badge-pay-paid';
        default: return 'badge-pay-pending';
    }
}

function parsePriceStringToFloat(priceStr) {
    if (!priceStr) return 0;
    let cleanStr = priceStr.replace(/[^0-9,\.]/g, '').trim();
    if (cleanStr.includes(',') && cleanStr.includes('.')) {
        if (cleanStr.indexOf(',') > cleanStr.indexOf('.')) {
            cleanStr = cleanStr.replace(/,/g, '');
        } else {
            cleanStr = cleanStr.replace(/\./g, '').replace(/,/g, '.');
        }
    } else if (cleanStr.includes(',')) {
        const parts = cleanStr.split(',');
        if (parts.length === 2 && parts[1].length === 2) {
            cleanStr = cleanStr.replace(/,/g, '.');
        } else {
            cleanStr = cleanStr.replace(/,/g, '');
        }
    } else if (cleanStr.includes('.')) {
        const parts = cleanStr.split('.');
        if (parts.length === 2 && parts[1].length === 2) {
            // Decimal dot, keep
        } else {
            cleanStr = cleanStr.replace(/\./g, '');
        }
    }
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

function deductFilamentForOrder(order) {
    if (order.filamentDeducted) return;
    
    let totalGramsToDeduct = 0;
    order.products.forEach(prodTitle => {
        const internalProd = (appState.internalProducts || []).find(p => p.title === prodTitle);
        if (internalProd && internalProd.weightGrams) {
            totalGramsToDeduct += parseFloat(internalProd.weightGrams) || 0;
        } else {
            const prod = (appState.products || []).find(p => p.title === prodTitle);
            if (prod) {
                const match = prod.description ? prod.description.match(/(\d+(?:\.\d+)?)\s*g(?:grams|ramos)?/i) : null;
                if (match) {
                    totalGramsToDeduct += parseFloat(match[1]);
                } else {
                    totalGramsToDeduct += 50;
                }
            } else {
                totalGramsToDeduct += 50;
            }
        }
    });
    
    if (totalGramsToDeduct > 0 && appState.inventory && appState.inventory.length > 0) {
        const spool = appState.inventory[0];
        if (spool) {
            spool.remainingGrams = Math.max(0, spool.remainingGrams - totalGramsToDeduct);
            order.filamentDeducted = true;
            console.log(`Auto-deducted ${totalGramsToDeduct}g from spool ${spool.brand} ${spool.color}. Remaining: ${spool.remainingGrams}g`);
            renderInventoryGrid();
        }
    }
}

// --- DASHBOARD SYNC LOGIC ---
window.updateDashboardData = function() {
    const dateHeader = document.getElementById('dashboard-date');
    if (dateHeader) {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateHeader.textContent = now.toLocaleDateString('es-AR', options);
    }
    
    let totalRevenue = 0;
    let activeOrdersCount = 0;
    let totalFilamentGrams = 0;
    
    if (appState.orders) {
        appState.orders.forEach(o => {
            totalRevenue += o.totalPrice;
            if (o.status !== 'Entregado') {
                activeOrdersCount++;
            }
        });
    }
    
    if (appState.inventory) {
        appState.inventory.forEach(s => {
            totalFilamentGrams += s.remainingGrams;
        });
    }
    
    const totalFilamentKg = totalFilamentGrams / 1000;
    const productsCount = appState.products ? appState.products.length : 0;
    
    const kpiRevenue = document.getElementById('kpi-revenue');
    if (kpiRevenue) kpiRevenue.textContent = `$ ${totalRevenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const kpiActive = document.getElementById('kpi-orders-active');
    if (kpiActive) kpiActive.textContent = activeOrdersCount;
    
    const kpiFilament = document.getElementById('kpi-filament-stock');
    if (kpiFilament) kpiFilament.textContent = `${totalFilamentKg.toFixed(2)} kg`;
    
    const kpiProducts = document.getElementById('kpi-products');
    if (kpiProducts) kpiProducts.textContent = productsCount;
    
    const dashTable = document.getElementById('dashboard-orders-table');
    if (dashTable) {
        dashTable.innerHTML = '';
        const activeOrders = (appState.orders || []).filter(o => o.status !== 'Entregado').slice(0, 5);
        
        if (activeOrders.length === 0) {
            dashTable.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;color:var(--text-secondary);padding:30px;">
                        No hay pedidos activos en cola.
                    </td>
                </tr>
            `;
        } else {
            activeOrders.forEach(o => {
                const tr = document.createElement('tr');
                
                let formattedDate = 'Sin fecha';
                if (o.date) {
                    const dateParts = o.date.split('-');
                    if (dateParts.length === 3) {
                        formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                    } else {
                        formattedDate = o.date;
                    }
                }
                
                tr.innerHTML = `
                    <td><strong>${o.clientName}</strong></td>
                    <td style="max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${o.products.join(', ')}">
                        ${o.products.join(', ')}
                    </td>
                    <td><span class="badge ${getPrintBadgeClass(o.status)}">${o.status}</span></td>
                    <td>${formattedDate}</td>
                `;
                dashTable.appendChild(tr);
            });
        }
    }
    
    const dashFilList = document.getElementById('dashboard-filament-list');
    if (dashFilList) {
        dashFilList.innerHTML = '';
        
        if (!appState.inventory || appState.inventory.length === 0) {
            dashFilList.innerHTML = `
                <div style="text-align:center;color:var(--text-secondary);padding:30px;">
                    No hay insumos registrados en el sistema.
                </div>
            `;
        } else {
            appState.inventory.slice(0, 4).forEach(spool => {
                const percentage = Math.max(0, Math.min(100, (spool.remainingGrams / spool.weightGrams) * 100));
                
                let progressColor = 'var(--success)';
                if (percentage < 20) progressColor = '#ef4444';
                else if (percentage < 50) progressColor = '#f59e0b';
                
                const div = document.createElement('div');
                div.className = 'spool-row';
                div.innerHTML = `
                    <div class="spool-row-info">
                        <span class="spool-title">${spool.brand} ${spool.material} (${spool.color})</span>
                        <span class="spool-qty">${spool.remainingGrams.toFixed(0)}g / ${spool.weightGrams}g</span>
                    </div>
                    <div class="spool-gauge-container">
                        <div class="spool-gauge-bar" style="width: ${percentage}%; background-color: ${progressColor};"></div>
                    </div>
                `;
                dashFilList.appendChild(div);
            });
        }
    }
};

// Automatically run auth check on startup
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initAuth === 'function') initAuth();
    });
} else {
    if (typeof initAuth === 'function') initAuth();
}

