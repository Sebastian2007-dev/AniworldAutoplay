// Background Service Worker

// ── Ad-popup tab blocker ───────────────────────────────────────────────────────
// Video players (VOE etc.) call window.open() to open ad tabs when the user
// clicks inside them.  If a new tab is opened from an aniworld/s.to tab and
// its destination is NOT aniworld/s.to itself, it is an ad — close it.
const PLAYER_ORIGIN_RE = /^https?:\/\/(aniworld\.to|s\.to|serienstream\.to)(\/|$)/i;

chrome.tabs.onCreated.addListener(tab => {
  if (!tab.openerTabId) return;

  chrome.tabs.get(tab.openerTabId, opener => {
    if (chrome.runtime.lastError) return;
    if (!PLAYER_ORIGIN_RE.test(opener.url || '')) return;

    // Opener is an aniworld/s.to tab — check the new tab's destination.
    function closeIfAd(url) {
      if (!url || url.startsWith('chrome:') || url.startsWith('about:') || url === '') return;
      if (PLAYER_ORIGIN_RE.test(url)) return; // legit navigation on the same site
      chrome.tabs.remove(tab.id, () => { chrome.runtime.lastError; /* suppress */ });
      console.log('[AdTabBlocker] Closed ad tab:', url);
    }

    const immediateUrl = tab.pendingUrl || tab.url || '';
    if (immediateUrl) {
      closeIfAd(immediateUrl);
      return;
    }

    // URL not known yet — watch for the first navigation update
    function listener(tabId, changeInfo) {
      if (tabId !== tab.id) return;
      const url = changeInfo.url || '';
      if (!url) return;
      chrome.tabs.onUpdated.removeListener(listener);
      closeIfAd(url);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
});
// ──────────────────────────────────────────────────────────────────────────────


// Handles cross-origin fetch requests on behalf of content scripts,
// since content scripts are subject to CORS restrictions but the
// background worker is not (given host_permissions in manifest.json).
// Also routes console logs from content scripts to the popup.

// ── Log buffer ────────────────────────────────────────────────────────────────
const LOG_MAX = 500;
const logBuffer = [];   // {ts, src, level, msg}

/** Connected popup ports */
const popupPorts = new Set();

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'popup') return;

  popupPorts.add(port);

  // Send existing buffer on connect
  port.postMessage({ type: 'INIT_LOGS', entries: [...logBuffer] });

  port.onDisconnect.addListener(() => popupPorts.delete(port));
});

function pushLogs(entries) {
  for (const e of entries) {
    logBuffer.push(e);
    if (logBuffer.length > LOG_MAX) logBuffer.shift();
  }
  if (popupPorts.size > 0) {
    const msg = { type: 'NEW_LOGS', entries };
    for (const port of popupPorts) {
      try { port.postMessage(msg); } catch (_) { /* port already closed */ }
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Log forwarding from content scripts ──
  if (message.type === 'LOGS') {
    pushLogs(message.entries);
    return false;
  }

  // ── Clear log buffer (requested by popup) ──
  if (message.type === 'CLEAR_LOGS') {
    logBuffer.length = 0;
    return false;
  }

  // ── Clear AniSkip no-data cache in active tab ──
  if (message.type === 'CLEAR_NODATA_CACHE') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) { sendResponse({ cleared: 0 }); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_NODATA_CACHE' }, (res) => {
        sendResponse(res || { cleared: 0 });
      });
    });
    return true; // async
  }

  // ── Cross-origin XHR proxy ──
  if (message.type !== 'GM_XMLHTTPREQUEST') return false;

  const { url, method = 'GET', headers = {}, data = null, timeout = 0 } = message;

  const controller = new AbortController();
  let timeoutId = null;

  if (timeout > 0) {
    timeoutId = setTimeout(() => controller.abort('timeout'), timeout);
  }

  const fetchOptions = {
    method,
    headers,
    signal: controller.signal,
  };

  // Only attach body for non-GET/HEAD requests
  if (data && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = data;
  }

  fetch(url, fetchOptions)
    .then(async (response) => {
      if (timeoutId) clearTimeout(timeoutId);
      const responseText = await response.text();
      sendResponse({
        status: response.status,
        statusText: response.statusText,
        responseText,
        response: responseText,
        finalUrl: response.url,
        error: false,
        isTimeout: false,
      });
    })
    .catch((err) => {
      if (timeoutId) clearTimeout(timeoutId);
      const isTimeout = err.message === 'timeout' || err.name === 'AbortError';
      sendResponse({
        error: true,
        isTimeout,
        status: 0,
        statusText: err.message,
        responseText: '',
        response: '',
        finalUrl: url,
      });
    });

  // Return true to keep the message channel open for the async response
  return true;
});
