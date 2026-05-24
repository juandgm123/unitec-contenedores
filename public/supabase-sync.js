     1|/**
     2| * UNITEC Supabase Sync Shim
     3| * --------------------------------------------------------------
     4| * Intercepta llamadas a localStorage y sincroniza con Supabase
     5| * de forma transparente. Hidrata al cargar, replica al escribir.
     6| *
     7| * El HTML legacy NO requiere cambios — sigue usando
     8| * localStorage.setItem/getItem/removeItem como siempre.
     9| *
    10| * Tabla destino: app_state (workspace, key, value JSONB, updated_at)
    11| * Scope actual: workspace compartido "unitec" (multi-usuario, sin auth)
    12| * --------------------------------------------------------------
    13| */
    14|(function () {
    15|  'use strict';
    16|
    17|  const WORKSPACE = 'unitec';
    18|  // Keys que SÍ sincronizamos con Supabase (el resto queda solo en localStorage)
    19|  const SYNC_KEYS = ['bi_containers_v70'];
    20|  const DEBOUNCE_MS = 800;
    21|
    22|  // Estado interno
    23|  let supabaseClient = null;
    24|  let ready = false;
    25|  let pendingWrites = new Map();        // key -> { value, timer }
    26|  const originalSetItem = Storage.prototype.setItem;
    27|  const originalGetItem = Storage.prototype.getItem;
    28|  const originalRemoveItem = Storage.prototype.removeItem;
    29|
    30|  // UI overlay para indicar estado de sync
    31|  function showStatus(msg, isError = false) {
    32|    let el = document.getElementById('__supabase_sync_status__');
    33|    if (!el) {
    34|      el = document.createElement('div');
    35|      el.id = '__supabase_sync_status__';
    36|      el.style.cssText = `
    37|        position:fixed;bottom:12px;right:12px;z-index:99999;
    38|        font-family:system-ui,sans-serif;font-size:12px;
    39|        background:rgba(11,86,158,0.95);color:white;
    40|        padding:8px 14px;border-radius:6px;
    41|        box-shadow:0 4px 14px rgba(0,0,0,0.4);
    42|        transition:opacity .3s;pointer-events:none;
    43|      `;
    44|      document.body.appendChild(el);
    45|    }
    46|    el.textContent = msg;
    47|    el.style.background = isError ? 'rgba(219,14,22,0.95)' : 'rgba(11,86,158,0.95)';
    48|    el.style.opacity = '1';
    49|    clearTimeout(el._fadeTimer);
    50|    el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
    51|  }
    52|
    53|  async function loadSupabaseLib() {
    54|    if (window.supabase && window.supabase.createClient) return window.supabase;
    55|    return new Promise((resolve, reject) => {
    56|      const s = document.createElement('script');
    57|      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
    58|      s.onload = () => resolve(window.supabase);
    59|      s.onerror = () => reject(new Error('No se pudo cargar Supabase SDK'));
    60|      document.head.appendChild(s);
    61|    });
    62|  }
    63|
    64|  async function fetchConfig() {
    65|    // El endpoint /api/supabase-config corre fuera del iframe.
    66|    // Como este HTML vive en /public y es servido por el mismo dominio Vercel,
    67|    // un fetch relativo funciona perfecto.
    68|    const r = await fetch('/api/supabase-config', { cache: 'no-store' });
    69|    if (!r.ok) throw new Error('No se pudo obtener config Supabase');
    70|    return r.json();
    71|  }
    72|
    73|  async function hydrate() {
    74|    showStatus('☁️  Sincronizando datos…');
    75|    const { data, error } = await supabaseClient
    76|      .from('app_state')
    77|      .select('key,value')
    78|      .eq('workspace', WORKSPACE)
    79|      .in('key', SYNC_KEYS);
    80|    if (error) {
    81|      console.error('[SupabaseSync] hydrate error:', error);
    82|      showStatus('⚠️ Error sincronizando — usando datos locales', true);
    83|      return;
    84|    }
    85|    let restored = 0;
    86|    for (const row of data || []) {
    87|      // Solo restauramos si Supabase tiene algo más nuevo / si local está vacío
    88|      const localRaw = originalGetItem.call(localStorage, row.key);
    89|      const remoteRaw = JSON.stringify(row.value);
    90|      if (localRaw !== remoteRaw) {
    91|        originalSetItem.call(localStorage, row.key, remoteRaw);
    92|        restored++;
    93|      }
    94|    }
    95|    showStatus(restored > 0 ? `✅ ${restored} datasets restaurados` : '✅ Datos sincronizados');
    96|  }
    97|
    98|  function schedulePush(key, value) {
    99|    if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key).timer);
   100|    const timer = setTimeout(() => doPush(key, value), DEBOUNCE_MS);
   101|    pendingWrites.set(key, { value, timer });
   102|  }
   103|
   104|  async function doPush(key, rawValue) {
   105|    pendingWrites.delete(key);
   106|    let parsedValue;
   107|    try { parsedValue = JSON.parse(rawValue); }
   108|    catch { parsedValue = rawValue; }
   109|
   110|    const { error } = await supabaseClient
   111|      .from('app_state')
   112|      .upsert(
   113|        { workspace: WORKSPACE, key, value: parsedValue, updated_at: new Date().toISOString() },
   114|        { onConflict: 'workspace,key' }
   115|      );
   116|    if (error) {
   117|      console.error('[SupabaseSync] push error', key, error);
   118|      showStatus(`⚠️ Error guardando ${key}`, true);
   119|    } else {
   120|      showStatus(`💾 ${key} guardado`);
   121|    }
   122|  }
   123|
   124|  async function doDelete(key) {
   125|    pendingWrites.delete(key);
   126|    const { error } = await supabaseClient
   127|      .from('app_state')
   128|      .delete()
   129|      .eq('workspace', WORKSPACE)
   130|      .eq('key', key);
   131|    if (error) console.error('[SupabaseSync] delete error', key, error);
   132|  }
   133|
   134|  // Monkey-patch localStorage
   135|  Storage.prototype.setItem = function (key, value) {
   136|    originalSetItem.apply(this, arguments);
   137|    if (this === window.localStorage && ready && SYNC_KEYS.includes(key)) {
   138|      schedulePush(key, value);
   139|    }
   140|  };
   141|  Storage.prototype.removeItem = function (key) {
   142|    originalRemoveItem.apply(this, arguments);
   143|    if (this === window.localStorage && ready && SYNC_KEYS.includes(key)) {
   144|      doDelete(key);
   145|    }
   146|  };
   147|  // getItem no se intercepta — los datos ya están en localStorage tras hydrate()
   148|
   149|  // Bootstrap
   150|  (async function init() {
   151|    try {
   152|      const [cfg, lib] = await Promise.all([fetchConfig(), loadSupabaseLib()]);
   153|      supabaseClient = lib.createClient(cfg.url, cfg.anonKey, {
   154|        auth: { persistSession: false, autoRefreshToken: false }
   155|      });
   156|      await hydrate();
   157|      ready = true;
   158|      window.__supabaseSync = { client: supabaseClient, hydrate, doPush, status: () => ready };
   159|      console.log('[SupabaseSync] activo — workspace:', WORKSPACE);
   160|    } catch (e) {
   161|      console.error('[SupabaseSync] init falló:', e);
   162|      showStatus('⚠️ Sin sync — datos solo locales', true);
   163|    }
   164|  })();
   165|
   166|  // Auto-resync cada 60s si la pestaña está visible (refleja cambios de otros dispositivos)
   167|  setInterval(() => {
   168|    if (ready && document.visibilityState === 'visible' && pendingWrites.size === 0) {
   169|      hydrate().catch(() => {});
   170|    }
   171|  }, 60000);
   172|
   173|  // Forzar flush al cerrar la página
   174|  window.addEventListener('beforeunload', () => {
   175|    for (const [key, { value }] of pendingWrites.entries()) {
   176|      navigator.sendBeacon &&
   177|        supabaseClient && // sendBeacon fallback for last-second saves
   178|        doPush(key, value);
   179|    }
   180|  });
   181|})();
   182|