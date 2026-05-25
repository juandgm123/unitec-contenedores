/**
 * UNITEC Supabase Sync Shim — Contenedores
 * --------------------------------------------------------------
 * Intercepta llamadas a localStorage y sincroniza con Supabase
 * de forma transparente. Hidrata al cargar, replica al escribir.
 *
 * El HTML legacy NO requiere cambios — sigue usando
 * localStorage.setItem/getItem/removeItem como siempre.
 *
 * Tabla destino: app_state (workspace, key, value JSONB, updated_at)
 * Scope actual: workspace compartido "unitec" (multi-usuario, sin auth)
 * --------------------------------------------------------------
 */
(function () {
  'use strict';

  const WORKSPACE = 'unitec';
  // Keys que SÍ sincronizamos con Supabase (el resto queda solo en localStorage)
  const SYNC_KEYS = ['bi_containers_v70'];
  const DEBOUNCE_MS = 800;

  // Estado interno
  let supabaseClient = null;
  let ready = false;
  let pendingWrites = new Map();        // key -> { value, timer }
  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  // UI overlay para indicar estado de sync
  function showStatus(msg, isError = false) {
    let el = document.getElementById('__supabase_sync_status__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__supabase_sync_status__';
      el.style.cssText = `
        position:fixed;bottom:12px;right:12px;z-index:99999;
        font-family:system-ui,sans-serif;font-size:12px;
        background:rgba(11,86,158,0.95);color:white;
        padding:8px 14px;border-radius:6px;
        box-shadow:0 4px 14px rgba(0,0,0,0.4);
        transition:opacity .3s;pointer-events:none;
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? 'rgba(219,14,22,0.95)' : 'rgba(11,86,158,0.95)';
    el.style.opacity = '1';
    clearTimeout(el._fadeTimer);
    el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  }

  async function loadSupabaseLib() {
    if (window.supabase && window.supabase.createClient) return window.supabase;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('No se pudo cargar Supabase SDK'));
      document.head.appendChild(s);
    });
  }

  async function fetchConfig() {
    const r = await fetch('/api/supabase-config', { cache: 'no-store' });
    if (!r.ok) throw new Error('No se pudo obtener config Supabase');
    return r.json();
  }

  async function hydrate() {
    showStatus('☁️  Sincronizando datos…');
    const { data, error } = await supabaseClient
      .from('app_state')
      .select('key,value')
      .eq('workspace', WORKSPACE)
      .in('key', SYNC_KEYS);
    if (error) {
      console.error('[SupabaseSync] hydrate error:', error);
      showStatus('⚠️ Error sincronizando — usando datos locales', true);
      return;
    }
    let restored = 0;
    const changedKeys = [];
    for (const row of data || []) {
      const localRaw = originalGetItem.call(localStorage, row.key);
      const remoteRaw = JSON.stringify(row.value);
      if (localRaw !== remoteRaw) {
        originalSetItem.call(localStorage, row.key, remoteRaw);
        restored++;
        changedKeys.push(row.key);
      }
    }
    // Avisar a la app que llegaron cambios remotos para que re-renderice
    if (changedKeys.length > 0) {
      window.dispatchEvent(new CustomEvent('supabaseRemoteChange', {
        detail: { keys: changedKeys }
      }));
    }
    showStatus(restored > 0 ? `✅ ${restored} datasets restaurados` : '✅ Datos sincronizados');
  }

  function schedulePush(key, value) {
    if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key).timer);
    const timer = setTimeout(() => doPush(key, value), DEBOUNCE_MS);
    pendingWrites.set(key, { value, timer });
  }

  async function doPush(key, rawValue) {
    pendingWrites.delete(key);
    let parsedValue;
    try { parsedValue = JSON.parse(rawValue); }
    catch { parsedValue = rawValue; }

    const { error } = await supabaseClient
      .from('app_state')
      .upsert(
        { workspace: WORKSPACE, key, value: parsedValue, updated_at: new Date().toISOString() },
        { onConflict: 'workspace,key' }
      );
    if (error) {
      console.error('[SupabaseSync] push error', key, error);
      showStatus(`⚠️ Error guardando ${key}`, true);
    } else {
      showStatus(`💾 ${key} guardado`);
    }
  }

  async function doDelete(key) {
    pendingWrites.delete(key);
    const { error } = await supabaseClient
      .from('app_state')
      .delete()
      .eq('workspace', WORKSPACE)
      .eq('key', key);
    if (error) console.error('[SupabaseSync] delete error', key, error);
  }

  // Monkey-patch localStorage
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.apply(this, arguments);
    if (this === window.localStorage && ready && SYNC_KEYS.includes(key)) {
      schedulePush(key, value);
    }
  };
  Storage.prototype.removeItem = function (key) {
    originalRemoveItem.apply(this, arguments);
    if (this === window.localStorage && ready && SYNC_KEYS.includes(key)) {
      doDelete(key);
    }
  };

  // Bootstrap
  (async function init() {
    try {
      const [cfg, lib] = await Promise.all([fetchConfig(), loadSupabaseLib()]);
      // Defensive trim — env vars en Vercel a veces vienen con whitespace
      // que rompe los fetch del SDK ("TypeError: Failed to fetch")
      const cleanUrl = (cfg.url || '').trim();
      const cleanKey = (cfg.anonKey || '').trim();
      supabaseClient = lib.createClient(cleanUrl, cleanKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      await hydrate();
      ready = true;
      window.__supabaseSync = { client: supabaseClient, hydrate, doPush, status: () => ready };
      console.log('[SupabaseSync] activo — workspace:', WORKSPACE);
      window.dispatchEvent(new CustomEvent('supabaseSyncReady'));
    } catch (e) {
      console.error('[SupabaseSync] init falló:', e);
      showStatus('⚠️ Sin sync — datos solo locales', true);
      // Avisar igual para que la app pueda renderizar con localStorage solo
      window.dispatchEvent(new CustomEvent('supabaseSyncReady', { detail: { failed: true } }));
    }
  })();

  // Auto-resync cada 60s si la pestaña está visible
  setInterval(() => {
    if (ready && document.visibilityState === 'visible' && pendingWrites.size === 0) {
      hydrate().catch(() => {});
    }
  }, 60000);

  // Forzar flush al cerrar la página
  window.addEventListener('beforeunload', () => {
    for (const [key, { value }] of pendingWrites.entries()) {
      navigator.sendBeacon &&
        supabaseClient &&
        doPush(key, value);
    }
  });
})();
