// =============================================================================
// GM_* Compatibility Shim for Chrome Extensions
// =============================================================================
// Replaces all Tampermonkey/Greasemonkey APIs with Chrome Extension equivalents.
//
// Architecture:
//  - GM_getValue / GM_setValue / etc  →  chrome.storage.local  (with in-memory
//    cache so all reads are synchronous after init)
//  - GM_addValueChangeListener        →  chrome.storage.onChanged  (fires in ALL
//    frames of the same tab, just like GM storage cross-frame sharing)
//  - GM_xmlhttpRequest                →  message to background.js which does
//    a real fetch() with the extension's host_permissions
//  - GM_addStyle                      →  inject a <style> element into the DOM
//  - unsafeWindow                     →  window  (content scripts can access
//    window directly in Chrome Extensions)
//  - GM_info                          →  hardcoded metadata object
// =============================================================================

const GMCompat = (() => {
  // -------------------------------------------------------------------------
  // In-memory cache — keeps all chrome.storage.local values accessible
  // synchronously so the existing synchronous GM_getValue() calls work.
  // -------------------------------------------------------------------------
  const _cache = Object.create(null);

  // Registry for GM_addValueChangeListener callbacks
  // Map<key: string, Map<listenerId: number, callback: Function>>
  const _listeners = new Map();
  let _listenerIdCounter = 0;

  // -------------------------------------------------------------------------
  // Public init — MUST be awaited before any GM_getValue call
  // -------------------------------------------------------------------------
  async function init() {
    // Load everything from persistent storage into the sync cache
    const data = await chrome.storage.local.get(null);
    Object.assign(_cache, data);

    // Start intercepting console output for the popup log viewer
    _interceptConsole();

    // Keep the cache in sync with any changes (own tab or other tabs)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
        if (newValue === undefined) {
          delete _cache[key];
        } else {
          _cache[key] = newValue;
        }

        // Fire registered listeners for this key
        const keyListeners = _listeners.get(key);
        if (keyListeners) {
          for (const cb of keyListeners.values()) {
            try {
              // Matches GM_addValueChangeListener callback signature:
              // (name, oldValue, newValue, remote)
              cb(key, oldValue, newValue, false);
            } catch (e) {
              console.error('[GMCompat] Listener error:', e);
            }
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Console interception — forwards tagged log lines to the popup via background
  // -------------------------------------------------------------------------
  const LOG_BATCH_MS = 200;
  const LOG_PREFIXES = ['[AniSkip]', '[AnimeSkip]', '[CommLink]', '[GMCompat]', '[Autoplay]', '[Init]', '[AgeGateBlocker]'];
  let _logBatch = [];
  let _logTimer = null;

  function _flushLogs() {
    _logTimer = null;
    if (_logBatch.length === 0) return;
    const entries = _logBatch.splice(0);
    try {
      chrome.runtime.sendMessage({ type: 'LOGS', entries });
    } catch (_) { /* extension context invalidated */ }
  }

  function _scheduledFlush() {
    if (_logTimer === null) {
      _logTimer = setTimeout(_flushLogs, LOG_BATCH_MS);
    }
  }

  function _interceptConsole() {
    const methods = { log: 'log', warn: 'warn', error: 'error', info: 'info' };
    for (const [method, level] of Object.entries(methods)) {
      const orig = console[method].bind(console);
      console[method] = (...args) => {
        orig(...args);
        try {
          const msg = args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (_) { return String(a); }
          }).join(' ');

          // Only forward tagged messages (to avoid flooding with unrelated page output)
          const shouldForward =
            level === 'error' ||
            level === 'warn' ||
            LOG_PREFIXES.some(p => msg.includes(p));

          if (!shouldForward) return;

          // Extract tag as src if present
          let src = '';
          const tagMatch = msg.match(/^\[([^\]]+)\]/);
          if (tagMatch) src = tagMatch[1];

          const now = new Date();
          const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

          _logBatch.push({ ts, src, level, msg });
          _scheduledFlush();
        } catch (_) { /* never break the page */ }
      };
    }
  }

  return {
    init,
    _cache,
    _listeners,
    get listenerIdCounter() { return ++_listenerIdCounter; },
    interceptConsole: _interceptConsole,
  };
})();

// =============================================================================
// GM_* globals — assigned to window so the main script finds them
// =============================================================================

function GM_getValue(key, defaultValue) {
  const val = GMCompat._cache[key];
  return val !== undefined ? val : defaultValue;
}

function GM_setValue(key, value) {
  GMCompat._cache[key] = value;
  try { chrome.storage.local.set({ [key]: value }); } catch (_) {}
}

function GM_deleteValue(key) {
  delete GMCompat._cache[key];
  try { chrome.storage.local.remove(key); } catch (_) {}
}

function GM_listValues() {
  return Object.keys(GMCompat._cache);
}

function GM_addValueChangeListener(key, callback) {
  const id = GMCompat.listenerIdCounter;
  if (!GMCompat._listeners.has(key)) {
    GMCompat._listeners.set(key, new Map());
  }
  GMCompat._listeners.get(key).set(id, callback);
  return id;
}

function GM_removeValueChangeListener(listenerId) {
  for (const [key, map] of GMCompat._listeners) {
    if (map.has(listenerId)) {
      map.delete(listenerId);
      if (map.size === 0) GMCompat._listeners.delete(key);
      return;
    }
  }
}

function GM_addStyle(css) {
  const style = document.createElement('style');
  style.textContent = css;
  // Append to head if available, otherwise to documentElement
  (document.head || document.documentElement).appendChild(style);
}

// Routes through background.js which has unrestricted fetch access
function GM_xmlhttpRequest(options) {
  try {
    chrome.runtime.sendMessage(
      {
        type: 'GM_XMLHTTPREQUEST',
        url: options.url,
        method: options.method || 'GET',
        headers: options.headers || {},
        data: options.data || null,
        timeout: options.timeout || 0,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          const err = { error: true, statusText: chrome.runtime.lastError.message };
          if (options.onerror) options.onerror(err);
          return;
        }
        if (!response) {
          const err = { error: true, statusText: 'No response from background' };
          if (options.onerror) options.onerror(err);
          return;
        }
        if (response.error) {
          if (response.isTimeout && options.ontimeout) options.ontimeout(response);
          else if (options.onerror) options.onerror(response);
        } else {
          if (options.onload) options.onload(response);
        }
      }
    );
  } catch (e) {
    // Extension context invalidated (e.g. after reload) — call onerror so callers don't hang
    if (options.onerror) options.onerror({ error: true, statusText: e.message });
  }
}

// Async variant used in a couple of places in the script
const GM = {
  getValue: (key, defaultValue) => Promise.resolve(GM_getValue(key, defaultValue)),
  setValue: (key, value) => { GM_setValue(key, value); return Promise.resolve(); },
};

// unsafeWindow is just window in Chrome Extensions content scripts
const unsafeWindow = window;

// GM_info — provides script metadata the original code references
const GM_info = {
  script: {
    name: 'Aniworld.to & S.to Autoplay',
    version: '4.13.6',
    grant: [
      'GM_addStyle',
      'GM_addValueChangeListener',
      'GM_deleteValue',
      'GM_getValue',
      'GM_listValues',
      'GM_removeValueChangeListener',
      'GM_setValue',
      'GM.getValue',
      'unsafeWindow',
      'GM_xmlhttpRequest',
    ],
  },
};
