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
const SETTING_KEYS = {
  autoplay:          's-autoplay',
  autoSkipIntro:     's-autoSkipIntro',
  playbackMem:       's-playbackMem',
  useAniSkip:        's-useAniSkip',
  notifications:     's-notifications',
  animeSkipClientId: 's-animeSkipClientId',
};

// Storage key mapping: popup id → chrome.storage.local key
// The content script stores settings under these keys via GM_setValue
const STORAGE_MAP = {
  's-autoplay':          'aw_autoplay',
  's-autoSkipIntro':     'aw_autoSkipIntro',
  's-playbackMem':       'aw_playbackMem',
  's-useAniSkip':        'useAniSkip',
  's-notifications':     'aw_notifications',
  's-animeSkipClientId': 'animeSkipClientId',
};

const DEFAULTS = {
  'aw_autoplay':       true,
  'aw_autoSkipIntro':  true,
  'aw_playbackMem':    true,
  'useAniSkip':        true,
  'aw_notifications':  true,
  'animeSkipClientId': '',
};

async function loadSettings() {
  const storageKeys = Object.values(STORAGE_MAP);
  const data = await chrome.storage.local.get(storageKeys);

  for (const [elId, storageKey] of Object.entries(STORAGE_MAP)) {
    const el = document.getElementById(elId);
    if (!el) continue;
    const val = data[storageKey] !== undefined ? data[storageKey] : DEFAULTS[storageKey];
    if (el.type === 'checkbox') {
      el.checked = !!val;
    } else {
      el.value = val || '';
    }
  }
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const toSave = {};
  for (const [elId, storageKey] of Object.entries(STORAGE_MAP)) {
    const el = document.getElementById(elId);
    if (!el) continue;
    toSave[storageKey] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  await chrome.storage.local.set(toSave);

  const hint = document.getElementById('saveHint');
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 2000);
});

loadSettings();

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
