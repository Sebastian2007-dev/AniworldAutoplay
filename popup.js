// ─────────────────────────────────────────────────────────────────────────────
// Popup script — settings + live log viewer
// ─────────────────────────────────────────────────────────────────────────────

// ── Translations ──────────────────────────────────────────────────────────────
const TRANSLATIONS = {
  de: {
    'status.loading': 'Lädt...',
    'status.active': 'Aktiv',
    'status.inactive': 'Nicht aktiv',
    'status.noTab': 'Kein Tab',
    'tab.logs': '📋 Logs',
    'tab.aniskip': '⏭️ AniSkip',
    'tab.settings': '⚙️ Einstellungen',
    'logs.all': 'Alle',
    'logs.log': 'Log',
    'logs.warn': 'Warn',
    'logs.error': 'Error',
    'logs.autoscroll': 'Auto-scroll',
    'logs.clear': 'Löschen',
    'logs.empty': 'Noch keine Logs — öffne eine Aniworld- oder S.to-Seite.',
    'aniskip.editTitle': 'Skip-Zeiten bearbeiten',
    'aniskip.editIntro': '✎ Intro',
    'aniskip.editOutro': '✎ Outro',
    'aniskip.editHint': 'Öffnet den Dialog zum Korrigieren oder Einreichen von Skip-Zeiten für die aktuelle Episode. Funktioniert nur wenn AniSkip-Daten für die Folge geladen wurden.',
    'aniskip.cacheTitle': 'Cache',
    'aniskip.cacheLabel': '„No data"-Cache leeren',
    'aniskip.cacheDesc': 'APIs sofort erneut abfragen statt gecachtes „keine Daten" zu verwenden',
    'aniskip.cacheClear': 'Leeren',
    'aniskip.noSkip': 'Kein AniSkip',
    'settings.language': 'Sprache / Language',
    'settings.playback': 'Wiedergabe',
    'settings.aniskipSuffix': '(nur Aniworld.to)',
    'settings.localSkip': 'Lokale Skip-Zeiten',
    'setting.language.label': 'Sprache',
    'setting.language.desc': 'Sprache der Benutzeroberfläche',
    'setting.autoplay.label': 'Autoplay',
    'setting.autoplay.desc': 'Nächste Episode automatisch abspielen',
    'setting.skipIntro.label': 'Intro automatisch überspringen',
    'setting.skipIntro.desc': 'Intro wird beim Erkennen sofort übersprungen',
    'setting.playbackMem.label': 'Wiedergabeposition merken',
    'setting.playbackMem.desc': 'Fortschritt beim Reload wiederherstellen',
    'setting.useAniSkip.label': 'AniSkip API verwenden',
    'setting.useAniSkip.desc': 'Intro-Timestamps automatisch abrufen',
    'setting.notifications.label': 'Benachrichtigungen',
    'setting.notifications.desc': 'AniSkip-Status als Popup anzeigen',
    'setting.clientId.label': 'AnimeSkip Client-ID',
    'setting.clientId.desc': 'Kostenlos auf anime-skip.com → Settings → Client Apps',
    'setting.clientId.placeholder': 'Leer = Test-ID (rate-limited)',
    'setting.skipLimit.label': 'Max. gespeicherte Einträge',
    'setting.skipLimit.desc': 'Älteste werden gelöscht wenn das Limit überschritten wird',
    'setting.skipEntries.label': 'Gespeicherte Einträge',
    'setting.skipEntries.loading': 'Wird geladen…',
    'setting.skipEntries.count': n => `${n} Einträge aktuell gespeichert`,
    'setting.skipEntries.deleted': n => `${n} gelöscht`,
    'setting.skipEntries.clearBtn': 'Alle löschen',
    'setting.cacheCleared': n => `${n} geleert!`,
    'save.btn': 'Speichern',
    'save.hint': '✓ Gespeichert',
  },
  en: {
    'status.loading': 'Loading...',
    'status.active': 'Active',
    'status.inactive': 'Not active',
    'status.noTab': 'No tab',
    'tab.logs': '📋 Logs',
    'tab.aniskip': '⏭️ AniSkip',
    'tab.settings': '⚙️ Settings',
    'logs.all': 'All',
    'logs.log': 'Log',
    'logs.warn': 'Warn',
    'logs.error': 'Error',
    'logs.autoscroll': 'Auto-scroll',
    'logs.clear': 'Clear',
    'logs.empty': 'No logs yet — open an Aniworld or S.to page.',
    'aniskip.editTitle': 'Edit skip times',
    'aniskip.editIntro': '✎ Intro',
    'aniskip.editOutro': '✎ Outro',
    'aniskip.editHint': 'Opens the dialog to correct or submit skip times for the current episode. Only works when AniSkip data has been loaded for the episode.',
    'aniskip.cacheTitle': 'Cache',
    'aniskip.cacheLabel': 'Clear "no data" cache',
    'aniskip.cacheDesc': 'Re-query APIs immediately instead of using cached "no data" responses',
    'aniskip.cacheClear': 'Clear',
    'aniskip.noSkip': 'No AniSkip',
    'settings.language': 'Language / Sprache',
    'settings.playback': 'Playback',
    'settings.aniskipSuffix': '(Aniworld.to only)',
    'settings.localSkip': 'Local skip times',
    'setting.language.label': 'Language',
    'setting.language.desc': 'User interface language',
    'setting.autoplay.label': 'Autoplay',
    'setting.autoplay.desc': 'Automatically play the next episode',
    'setting.skipIntro.label': 'Auto-skip intro',
    'setting.skipIntro.desc': 'Skip intro immediately when detected',
    'setting.playbackMem.label': 'Remember playback position',
    'setting.playbackMem.desc': 'Restore progress on reload',
    'setting.useAniSkip.label': 'Use AniSkip API',
    'setting.useAniSkip.desc': 'Automatically fetch intro timestamps',
    'setting.notifications.label': 'Notifications',
    'setting.notifications.desc': 'Show AniSkip status as a popup',
    'setting.clientId.label': 'AnimeSkip Client ID',
    'setting.clientId.desc': 'Free at anime-skip.com → Settings → Client Apps',
    'setting.clientId.placeholder': 'Empty = Test ID (rate-limited)',
    'setting.skipLimit.label': 'Max. stored entries',
    'setting.skipLimit.desc': 'Oldest entries are deleted when the limit is exceeded',
    'setting.skipEntries.label': 'Stored entries',
    'setting.skipEntries.loading': 'Loading…',
    'setting.skipEntries.count': n => `${n} entries currently stored`,
    'setting.skipEntries.deleted': n => `${n} deleted`,
    'setting.skipEntries.clearBtn': 'Delete all',
    'setting.cacheCleared': n => `${n} cleared!`,
    'save.btn': 'Save',
    'save.hint': '✓ Saved',
  },
};

let currentLang = 'de';
let currentStatusKey = 'status.loading';

function t(key, arg) {
  const val = (TRANSLATIONS[currentLang] ?? TRANSLATIONS['de'])[key] ?? TRANSLATIONS['de'][key] ?? key;
  return typeof val === 'function' ? val(arg) : val;
}

function applyLanguage(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  statusLabel.textContent = t(currentStatusKey);
}

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
  if (!tab) {
    currentStatusKey = 'status.noTab';
    statusLabel.textContent = t(currentStatusKey);
    return;
  }
  const url = tab.url || '';
  const isAniworld = /^https?:\/\/(aniworld\.to|s\.to|serienstream\.to)/.test(url);
  if (isAniworld) {
    statusDot.classList.add('active');
    currentStatusKey = 'status.active';
  } else {
    currentStatusKey = 'status.inactive';
  }
  statusLabel.textContent = t(currentStatusKey);
});

// ── Settings ──────────────────────────────────────────────────────────────────
const NESTED_SETTINGS = [
  { elId: 's-autoplay',      storeKey: 'coreSettings',     prop: 'isAutoplayEnabled',       default: true  },
  { elId: 's-autoSkipIntro', storeKey: 'coreSettings',     prop: 'autoSkipIntro',            default: true  },
  { elId: 's-playbackMem',   storeKey: 'mainSettings',     prop: 'playbackPositionMemory',   default: true  },
  { elId: 's-useAniSkip',    storeKey: 'advancedSettings', prop: 'useAniSkip',               default: true  },
  { elId: 's-notifications', storeKey: 'advancedSettings', prop: 'showAniSkipNotifications', default: true  },
];

const FLAT_SETTINGS = [
  { elId: 's-language',          storageKey: 'popup_language',              default: 'de' },
  { elId: 's-animeSkipClientId', storageKey: 'animeSkipClientId',           default: ''   },
  { elId: 's-skipTimesLimit',    storageKey: 'aw_local_skiptimes_limit',    default: 500  },
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

  const allKeys = await chrome.storage.local.get(null);
  const count = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::')).length;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = t('setting.skipEntries.count', count);
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const storeKeys = [...new Set(NESTED_SETTINGS.map(s => s.storeKey))];
  const data = await chrome.storage.local.get(storeKeys);

  const toSave = {};
  for (const { elId, storeKey, prop } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    if (!toSave[storeKey]) {
      try { toSave[storeKey] = JSON.parse(data[storeKey]) || {}; } catch (_) { toSave[storeKey] = {}; }
    }
    toSave[storeKey][prop] = el.checked;
  }
  for (const key of Object.keys(toSave)) {
    toSave[key] = JSON.stringify(toSave[key]);
  }

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

// Language changes apply immediately without needing to click Save
document.getElementById('s-language').addEventListener('change', async e => {
  const lang = e.target.value;
  await chrome.storage.local.set({ popup_language: lang });
  applyLanguage(lang);
  const allKeys = await chrome.storage.local.get(null);
  const count = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::')).length;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = t('setting.skipEntries.count', count);
});

// ── Edit skip times ───────────────────────────────────────────────────────────
function openSkipTimesDialog(dialogType) {
  const btnId = dialogType === 'outro' ? 'editOutroTimes' : 'editIntroTimes';
  const btn = document.getElementById(btnId);
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SKIP_TIMES_DIALOG', dialogType }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        const orig = btn.textContent;
        btn.textContent = t('aniskip.noSkip');
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
  chrome.runtime.sendMessage({ type: 'CLEAR_NODATA_CACHE' }, (res) => {
    const count = res?.cleared ?? '?';
    const orig = btn.textContent;
    btn.textContent = t('setting.cacheCleared', count);
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

// ── Log rendering ─────────────────────────────────────────────────────────────
const logContainer = document.getElementById('log-container');
const logEmpty     = document.getElementById('log-empty');
let allLogs        = [];
let activeFilter   = 'all';
let autoScroll     = true;

document.getElementById('autoScroll').addEventListener('change', e => {
  autoScroll = e.target.checked;
});

document.getElementById('clearLogs').addEventListener('click', () => {
  allLogs = [];
  renderLogs();
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
  btn.textContent = t('setting.skipEntries.deleted', keysToDelete.length);
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = t('setting.skipEntries.count', 0);
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
    setTimeout(connectToBackground, 1000);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const data = await chrome.storage.local.get('popup_language');
  currentLang = data.popup_language || 'de';
  applyLanguage(currentLang);
  await loadSettings();
  connectToBackground();
})();
