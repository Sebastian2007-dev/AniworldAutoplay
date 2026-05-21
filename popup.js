// ─────────────────────────────────────────────────────────────────────────────
// Popup script — settings + live log viewer
// ─────────────────────────────────────────────────────────────────────────────

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach(p =>
      p.classList.toggle('active', p.id === `panel-${target}`)
    );
  });
});

// ── Status dot ────────────────────────────────────────────────────────────────
const statusDot   = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) { statusLabel.textContent = 'Kein Tab'; return; }
  const url = tab.url || '';
  const isAniworld = /^https?:\/\/(aniworld\.to|s\.to|serienstream\.to)/.test(url);
  if (isAniworld) {
    statusDot.classList.add('active');
    statusLabel.textContent = 'Aktiv';
  } else {
    statusLabel.textContent = 'Nicht aktiv';
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
// Settings stored as properties inside DataStore JSON objects in chrome.storage.local.
// storeKey = the chrome.storage key holding the JSON blob
// prop     = the property inside that JSON blob
// default  = fallback value when the store doesn't exist yet
const NESTED_SETTINGS = [
  { elId: 's-autoplay',      storeKey: 'coreSettings',     prop: 'isAutoplayEnabled',    default: false },
  { elId: 's-autoSkipIntro', storeKey: 'coreSettings',     prop: 'autoSkipIntro',         default: true  },
  { elId: 's-playbackMem',   storeKey: 'mainSettings',     prop: 'playbackPositionMemory',default: true  },
  { elId: 's-useAniSkip',    storeKey: 'advancedSettings', prop: 'useAniSkip',            default: true  },
  { elId: 's-notifications', storeKey: 'advancedSettings', prop: 'showAniSkipNotifications', default: true },
];

// Flat settings stored directly as top-level chrome.storage.local keys
const FLAT_SETTINGS = [
  { elId: 's-animeSkipClientId', storageKey: 'animeSkipClientId',      default: ''  },
  { elId: 's-skipTimesLimit',    storageKey: 'aw_local_skiptimes_limit', default: 500 },
];

async function loadSettings() {
  const storeKeys = [...new Set(NESTED_SETTINGS.map(s => s.storeKey)), ...FLAT_SETTINGS.map(s => s.storageKey)];
  const data = await chrome.storage.local.get(storeKeys);

  for (const { elId, storeKey, prop, default: def } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    let storeObj = {};
    try { storeObj = JSON.parse(data[storeKey]) || {}; } catch (_) {}
    const val = prop in storeObj ? storeObj[prop] : def;
    el.checked = !!val;
  }

  for (const { elId, storageKey, default: def } of FLAT_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    const val = data[storageKey] !== undefined ? data[storageKey] : def;
    el.value = el.type === 'number' ? Number(val) : (val || '');
  }

  // Show current local skip-times entry count
  const allKeys = await chrome.storage.local.get(null);
  const count = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::')).length;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = `${count} Einträge aktuell gespeichert`;
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const storeKeys = [...new Set(NESTED_SETTINGS.map(s => s.storeKey))];
  const data = await chrome.storage.local.get(storeKeys);

  // Update each nested JSON blob
  const toSave = {};
  for (const { elId, storeKey, prop } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    if (!toSave[storeKey]) {
      try { toSave[storeKey] = JSON.parse(data[storeKey]) || {}; } catch (_) { toSave[storeKey] = {}; }
    }
    toSave[storeKey][prop] = el.checked;
  }
  // Serialize back to JSON strings
  for (const key of Object.keys(toSave)) {
    toSave[key] = JSON.stringify(toSave[key]);
  }

  // Flat settings
  for (const { elId, storageKey } of FLAT_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    toSave[storageKey] = el.type === 'number' ? Number(el.value) : el.value.trim();
  }

  await chrome.storage.local.set(toSave);

  const hint = document.getElementById('saveHint');
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 2000);
});

loadSettings();

// ── Edit skip times ───────────────────────────────────────────────────────────
function openSkipTimesDialog(dialogType) {
  const btnId = dialogType === 'outro' ? 'editOutroTimes' : 'editIntroTimes';
  const btn = document.getElementById(btnId);
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SKIP_TIMES_DIALOG', dialogType }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        const orig = btn.textContent;
        btn.textContent = 'Kein AniSkip';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      }
    });
  });
}
document.getElementById('editIntroTimes').addEventListener('click', () => openSkipTimesDialog('intro'));
document.getElementById('editOutroTimes').addEventListener('click', () => openSkipTimesDialog('outro'));

// ── Clear AniSkip no-data cache ───────────────────────────────────────────────
document.getElementById('clearNoDataCache').addEventListener('click', async () => {
  const btn = document.getElementById('clearNoDataCache');

  // Tell background to forward the clear request to the active tab's content script
  chrome.runtime.sendMessage({ type: 'CLEAR_NODATA_CACHE' }, (res) => {
    const count = res?.cleared ?? '?';
    const orig = btn.textContent;
    btn.textContent = `${count} geleert!`;
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

// ── Log rendering ─────────────────────────────────────────────────────────────
const logContainer = document.getElementById('log-container');
const logEmpty     = document.getElementById('log-empty');
let allLogs        = [];   // {ts, src, level, msg}
let activeFilter   = 'all';
let autoScroll     = true;

document.getElementById('autoScroll').addEventListener('change', e => {
  autoScroll = e.target.checked;
});

document.getElementById('clearLogs').addEventListener('click', () => {
  allLogs = [];
  renderLogs();
  // Also tell background to clear its buffer
  chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
});

document.querySelectorAll('.log-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.level;
    renderLogs();
  });
});

function renderLogs() {
  const filtered = activeFilter === 'all'
    ? allLogs
    : allLogs.filter(e => e.level === activeFilter);

  if (filtered.length === 0) {
    logContainer.innerHTML = '';
    logEmpty.style.display = 'block';
    logContainer.appendChild(logEmpty);
    return;
  }

  logEmpty.style.display = 'none';

  // Build fragment for performance
  const frag = document.createDocumentFragment();
  for (const entry of filtered) {
    frag.appendChild(buildEntryEl(entry));
  }
  logContainer.innerHTML = '';
  logContainer.appendChild(frag);

  if (autoScroll) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

function appendLogs(entries) {
  const filtered = activeFilter === 'all'
    ? entries
    : entries.filter(e => e.level === activeFilter);

  if (allLogs.length === 0 && entries.length > 0) {
    logEmpty.style.display = 'none';
  }

  allLogs.push(...entries);

  for (const entry of filtered) {
    logContainer.appendChild(buildEntryEl(entry));
  }

  if (filtered.length > 0 && autoScroll) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

function buildEntryEl(entry) {
  const div = document.createElement('div');
  div.className = `log-entry level-${entry.level}`;

  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = entry.ts;

  const src = document.createElement('span');
  src.className = 'src';
  src.textContent = entry.src ? `[${entry.src}]` : '';

  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = entry.msg;

  div.appendChild(ts);
  if (entry.src) div.appendChild(src);
  div.appendChild(msg);
  return div;
}

// ── Clear local skip times ────────────────────────────────────────────────────
document.getElementById('clearLocalSkipTimes').addEventListener('click', async () => {
  const btn = document.getElementById('clearLocalSkipTimes');
  const allKeys = await chrome.storage.local.get(null);
  const keysToDelete = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::'));
  if (keysToDelete.length > 0) await chrome.storage.local.remove(keysToDelete);
  const orig = btn.textContent;
  btn.textContent = `${keysToDelete.length} gelöscht`;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = '0 Einträge aktuell gespeichert';
  setTimeout(() => { btn.textContent = orig; }, 2000);
});

// ── Connect to background for live logs ───────────────────────────────────────
function connectToBackground() {
  const port = chrome.runtime.connect({ name: 'popup' });

  port.onMessage.addListener(msg => {
    if (msg.type === 'INIT_LOGS') {
      allLogs = [];
      renderLogs();
      appendLogs(msg.entries);
    } else if (msg.type === 'NEW_LOGS') {
      appendLogs(msg.entries);
    }
  });

  port.onDisconnect.addListener(() => {
    // Reconnect after a short delay if popup is still open
    setTimeout(connectToBackground, 1000);
  });
}

connectToBackground();
