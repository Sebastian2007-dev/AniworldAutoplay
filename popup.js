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
    'tab.advanced': '🔧 Erweitert',
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
    'settings.skipSizes': 'Skip-Größen',
    'settings.aniskipSuffix': '(nur Aniworld.to)',
    'settings.localSkip': 'Lokale Skip-Zeiten',
    'settings.behavior': 'Verhalten',
    'settings.timing': 'Timing',
    'settings.hotkeys': 'Tastenkürzel',
    'settings.defaults': 'Standard-Werte',
    'settings.network': 'Netzwerk',
    'setting.language.label': 'Sprache',
    'setting.language.desc': 'Sprache der Benutzeroberfläche',
    'setting.autoplay.label': 'Autoplay',
    'setting.autoplay.desc': 'Nächste Episode automatisch abspielen',
    'setting.skipIntro.label': 'Intro automatisch überspringen',
    'setting.skipIntro.desc': 'Intro wird beim Erkennen sofort übersprungen',
    'setting.playbackMem.label': 'Wiedergabeposition merken',
    'setting.playbackMem.desc': 'Fortschritt beim Reload wiederherstellen',
    'setting.mutedAutoplay.label': 'Stummgeschaltetes Autoplay',
    'setting.mutedAutoplay.desc': 'Autoplay stumm starten wenn der Browser es blockiert',
    'setting.autoSkipStart.label': 'Am Anfang überspringen',
    'setting.autoSkipStart.desc': 'Automatisch am Anfang jeder Episode überspringen',
    'setting.skipSecondsStart.label': 'Sekunden am Anfang',
    'setting.skipSecondsStart.desc': 'Sekunden die am Anfang übersprungen werden',
    'setting.introSkipSize.label': 'Intro-Skipgröße, Sek',
    'setting.introSkipSize.desc': 'Sekunden beim manuellen Intro-Skip',
    'setting.outroThreshold.label': 'Outro-Schwelle, Sek',
    'setting.outroThreshold.desc': 'Autoplay startet wenn weniger als diese Sekunden übrig sind',
    'setting.showSkipBtn.label': 'Skip-Intro-Button anzeigen',
    'setting.showSkipBtn.desc': 'Button zum manuellen Intro-Überspringen einblenden',
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
    'setting.playOnSkip.label': 'Abspielen nach Skip',
    'setting.playOnSkip.desc': 'Video abspielen nachdem Intro übersprungen wurde',
    'setting.highlightEpisodes.label': 'Besuchte Episoden hervorheben',
    'setting.highlightEpisodes.desc': 'Gesehene Episoden farblich markieren',
    'setting.preloadProviders.label': 'Andere Provider vorladen',
    'setting.preloadProviders.desc': 'Alternative Anbieter im Hintergrund laden',
    'setting.skipBtnSeconds.label': 'Skip-Button Anzeige, Sek',
    'setting.skipBtnSeconds.desc': 'Sekunden für die der Skip-Button sichtbar bleibt',
    'setting.markWatched.label': 'Als gesehen markieren, Sek',
    'setting.markWatched.desc': 'Episode nach dieser Zeit als gesehen markieren (0 = aus)',
    'setting.positionExpiry.label': 'Position ablaufen, Tage',
    'setting.positionExpiry.desc': 'Gespeicherte Wiedergabeposition nach X Tagen löschen',
    'setting.skipCooldown.label': 'Skip-Abklingzeit, ms',
    'setting.skipCooldown.desc': 'Mindestzeit zwischen zwei Skips',
    'setting.keyPlayPause.label': 'Play/Pause',
    'setting.keyPlayPause.desc': 'Taste zum Starten/Pausieren',
    'setting.keyPip.label': 'Bild-in-Bild',
    'setting.keyPip.desc': 'Taste zum Umschalten von Bild-in-Bild',
    'setting.keyEditIntro.label': 'Intro-Zeiten',
    'setting.keyEditIntro.desc': 'Taste zum Anzeigen/Einreichen der Intro-Zeiten',
    'setting.keyEditOutro.label': 'Outro-Zeiten',
    'setting.keyEditOutro.desc': 'Taste zum Anzeigen/Einreichen der Outro-Zeiten',
    'setting.keySkip10Back.label': '10s zurück',
    'setting.keySkip10Back.desc': 'Taste zum Zurückspulen um 10 Sekunden',
    'setting.keySkip10Forward.label': '10s vor',
    'setting.keySkip10Forward.desc': 'Taste zum Vorspulen um 10 Sekunden',
    'setting.keyBackward.label': 'Schnell zurück',
    'setting.keyBackward.desc': 'Taste zum Rückspulen',
    'setting.keyForward.label': 'Schnell vor',
    'setting.keyForward.desc': 'Taste zum Vorspulen',
    'setting.keyFullscreen.label': 'Vollbild',
    'setting.keyFullscreen.desc': 'Taste für Vollbildmodus',
    'setting.keyLargeSkip.label': 'Großer Skip',
    'setting.keyLargeSkip.desc': 'Taste für Intro-Skip',
    'setting.defaultIntroSkip.label': 'Standard Intro-Skip, Sek',
    'setting.defaultIntroSkip.desc': 'Standard-Intro-Skipgröße für neue Serien',
    'setting.defaultOutroThresh.label': 'Standard Outro-Schwelle, Sek',
    'setting.defaultOutroThresh.desc': 'Standard-Outro-Schwelle für neue Serien',
    'setting.fastFwdSize.label': 'Schnellvorlauf, Sek',
    'setting.fastFwdSize.desc': 'Sekunden beim Schnellvorlauf',
    'setting.corsProxy.label': 'CORS-Proxy',
    'setting.corsProxy.desc': 'URL des CORS-Proxy-Servers',
    'setting.corsProxy.placeholder': 'https://...',
    'setting.commlinkInterval.label': 'Commlink Intervall, ms',
    'setting.commlinkInterval.desc': 'Polling-Intervall für iframe-Kommunikation',
    'settings.autoplayForce': 'Autoplay mit Ton erzwingen (Registry)',
    'autoplayForce.warning': '⚠ Erstellt eine Windows-Registry-Datei, die Chromes Autoplay-Sperre für die unten gelisteten Domains dauerhaft umgeht (Richtlinie „AutoplayAllowlist"). Die Extension kann die Registry nicht selbst ändern — du musst die heruntergeladene .reg-Datei manuell per Doppelklick ausführen und bestätigen. Die Änderung gilt für alle Chrome-Profile deines Windows-Kontos und erfordert einen Chrome-Neustart. Mit „Entfernen" kannst du sie wieder rückgängig machen.',
    'autoplayForce.domains': domains => `Betroffene Domains: ${domains.join(', ')}`,
    'autoplayForce.enableBtn': '⬇ Aktivieren (.reg)',
    'autoplayForce.disableBtn': '⬇ Entfernen (.reg)',
    'save.btn': 'Speichern',
    'save.hint': '✓ Gespeichert',
    'save.reset': 'Auf Standard zurücksetzen',
    'save.resetDone': '✓ Zurückgesetzt',
  },
  en: {
    'status.loading': 'Loading...',
    'status.active': 'Active',
    'status.inactive': 'Not active',
    'status.noTab': 'No tab',
    'tab.logs': '📋 Logs',
    'tab.aniskip': '⏭️ AniSkip',
    'tab.settings': '⚙️ Settings',
    'tab.advanced': '🔧 Advanced',
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
    'settings.skipSizes': 'Skip sizes',
    'settings.aniskipSuffix': '(Aniworld.to only)',
    'settings.localSkip': 'Local skip times',
    'settings.behavior': 'Behavior',
    'settings.timing': 'Timing',
    'settings.hotkeys': 'Hotkeys',
    'settings.defaults': 'Default values',
    'settings.network': 'Network',
    'setting.language.label': 'Language',
    'setting.language.desc': 'User interface language',
    'setting.autoplay.label': 'Autoplay',
    'setting.autoplay.desc': 'Automatically play the next episode',
    'setting.skipIntro.label': 'Auto-skip intro',
    'setting.skipIntro.desc': 'Skip intro immediately when detected',
    'setting.playbackMem.label': 'Remember playback position',
    'setting.playbackMem.desc': 'Restore progress on reload',
    'setting.mutedAutoplay.label': 'Muted autoplay',
    'setting.mutedAutoplay.desc': 'Start autoplay muted if the browser blocks it',
    'setting.autoSkipStart.label': 'Skip at start',
    'setting.autoSkipStart.desc': 'Automatically skip at the beginning of each episode',
    'setting.skipSecondsStart.label': 'Seconds at start',
    'setting.skipSecondsStart.desc': 'Seconds to skip at the beginning',
    'setting.introSkipSize.label': 'Intro skip size, sec',
    'setting.introSkipSize.desc': 'Seconds skipped on manual intro skip',
    'setting.outroThreshold.label': 'Outro threshold, sec',
    'setting.outroThreshold.desc': 'Autoplay starts when fewer than these seconds remain',
    'setting.showSkipBtn.label': 'Show skip intro button',
    'setting.showSkipBtn.desc': 'Show button for manual intro skipping',
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
    'setting.playOnSkip.label': 'Play after skip',
    'setting.playOnSkip.desc': 'Play video after intro is skipped',
    'setting.highlightEpisodes.label': 'Highlight visited episodes',
    'setting.highlightEpisodes.desc': 'Mark watched episodes with a color',
    'setting.preloadProviders.label': 'Preload other providers',
    'setting.preloadProviders.desc': 'Load alternative providers in the background',
    'setting.skipBtnSeconds.label': 'Skip button display, sec',
    'setting.skipBtnSeconds.desc': 'Seconds the skip button remains visible',
    'setting.markWatched.label': 'Mark watched, sec',
    'setting.markWatched.desc': 'Mark episode as watched after this many seconds (0 = off)',
    'setting.positionExpiry.label': 'Position expiry, days',
    'setting.positionExpiry.desc': 'Delete saved playback position after X days',
    'setting.skipCooldown.label': 'Skip cooldown, ms',
    'setting.skipCooldown.desc': 'Minimum time between two skips',
    'setting.keyPlayPause.label': 'Play/Pause',
    'setting.keyPlayPause.desc': 'Key to play/pause',
    'setting.keyPip.label': 'Picture-in-Picture',
    'setting.keyPip.desc': 'Key to toggle Picture-in-Picture',
    'setting.keyEditIntro.label': 'Intro times',
    'setting.keyEditIntro.desc': 'Key to view/submit intro times',
    'setting.keyEditOutro.label': 'Outro times',
    'setting.keyEditOutro.desc': 'Key to view/submit outro times',
    'setting.keySkip10Back.label': '10s back',
    'setting.keySkip10Back.desc': 'Key to rewind 10 seconds',
    'setting.keySkip10Forward.label': '10s forward',
    'setting.keySkip10Forward.desc': 'Key to skip ahead 10 seconds',
    'setting.keyBackward.label': 'Fast backward',
    'setting.keyBackward.desc': 'Key to rewind',
    'setting.keyForward.label': 'Fast forward',
    'setting.keyForward.desc': 'Key to fast forward',
    'setting.keyFullscreen.label': 'Fullscreen',
    'setting.keyFullscreen.desc': 'Key for fullscreen mode',
    'setting.keyLargeSkip.label': 'Large skip',
    'setting.keyLargeSkip.desc': 'Key for intro skip',
    'setting.defaultIntroSkip.label': 'Default intro skip, sec',
    'setting.defaultIntroSkip.desc': 'Default intro skip size for new series',
    'setting.defaultOutroThresh.label': 'Default outro threshold, sec',
    'setting.defaultOutroThresh.desc': 'Default outro threshold for new series',
    'setting.fastFwdSize.label': 'Fast forward size, sec',
    'setting.fastFwdSize.desc': 'Seconds per fast forward',
    'setting.corsProxy.label': 'CORS proxy',
    'setting.corsProxy.desc': 'URL of the CORS proxy server',
    'setting.corsProxy.placeholder': 'https://...',
    'setting.commlinkInterval.label': 'Commlink interval, ms',
    'setting.commlinkInterval.desc': 'Polling interval for iframe communication',
    'settings.autoplayForce': 'Force autoplay with sound (registry)',
    'autoplayForce.warning': '⚠ Generates a Windows registry file that permanently bypasses Chrome\'s autoplay-with-sound block for the domains listed below (the "AutoplayAllowlist" policy). The extension cannot modify the registry itself — you have to run the downloaded .reg file manually (double-click + confirm). The change applies to every Chrome profile on your Windows account and requires a Chrome restart. Use "Remove" to undo it.',
    'autoplayForce.domains': domains => `Affected domains: ${domains.join(', ')}`,
    'autoplayForce.enableBtn': '⬇ Enable (.reg)',
    'autoplayForce.disableBtn': '⬇ Remove (.reg)',
    'save.btn': 'Save',
    'save.hint': '✓ Saved',
    'save.reset': 'Reset to defaults',
    'save.resetDone': '✓ Reset',
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
  updateAutoplayForceDomainsText();
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
  // coreSettings
  { elId: 's-autoplay',           storeKey: 'coreSettings',     prop: 'isAutoplayEnabled',              default: true  },
  { elId: 's-autoSkipIntro',      storeKey: 'coreSettings',     prop: 'autoSkipIntro',                  default: true  },
  { elId: 's-autoSkipStart',      storeKey: 'coreSettings',     prop: 'shouldAutoSkipOnStart',          default: true  },
  { elId: 's-skipSecondsStart',   storeKey: 'coreSettings',     prop: 'autoSkipSecondsOnStart',         default: 0     },
  { elId: 's-introSkipSize',      storeKey: 'coreSettings',     prop: 'currentLargeSkipSizeS',          default: 87    },
  { elId: 's-outroThreshold',     storeKey: 'coreSettings',     prop: 'currentOutroSkipThresholdS',     default: 90    },
  // mainSettings
  { elId: 's-playbackMem',        storeKey: 'mainSettings',     prop: 'playbackPositionMemory',         default: true  },
  { elId: 's-mutedAutoplay',      storeKey: 'mainSettings',     prop: 'shouldAutoplayMuted',            default: true  },
  { elId: 's-highlightEpisodes',  storeKey: 'mainSettings',     prop: 'highlightVisitedEpisodes',       default: true  },
  // advancedSettings
  { elId: 's-useAniSkip',         storeKey: 'advancedSettings', prop: 'useAniSkip',                     default: true  },
  { elId: 's-notifications',      storeKey: 'advancedSettings', prop: 'showAniSkipNotifications',       default: true  },
  { elId: 's-showSkipBtn',        storeKey: 'advancedSettings', prop: 'showSkipIntroButton',            default: true  },
  { elId: 's-playOnSkip',         storeKey: 'advancedSettings', prop: 'playOnLargeSkip',                default: true  },
  { elId: 's-preloadProviders',   storeKey: 'advancedSettings', prop: 'preloadOtherProviders',          default: true  },
  { elId: 's-skipBtnSeconds',     storeKey: 'advancedSettings', prop: 'showSkipIntroButtonSeconds',     default: 240   },
  { elId: 's-markWatched',        storeKey: 'advancedSettings', prop: 'markWatchedAfterS',              default: 0     },
  { elId: 's-positionExpiry',     storeKey: 'advancedSettings', prop: 'playbackPositionExpirationDays', default: 30    },
  { elId: 's-skipCooldown',       storeKey: 'advancedSettings', prop: 'largeSkipCooldownMs',            default: 300   },
  { elId: 's-defaultIntroSkip',   storeKey: 'advancedSettings', prop: 'defaultLargeSkipSizeS',          default: 87    },
  { elId: 's-defaultOutroThresh', storeKey: 'advancedSettings', prop: 'defaultOutroSkipThresholdS',     default: 90    },
  { elId: 's-fastFwdSize',        storeKey: 'advancedSettings', prop: 'fastForwardSizeS',               default: 10    },
  { elId: 's-corsProxy',          storeKey: 'advancedSettings', prop: 'corsProxy',                      default: 'https://aniworld-to-cors-proxy.fly.dev/' },
  { elId: 's-commlinkInterval',   storeKey: 'advancedSettings', prop: 'commlinkPollingIntervalMs',      default: 40    },
  // hotkeysSettings
  { elId: 's-keyPlayPause',       storeKey: 'hotkeysSettings',  prop: 'playPause',                      default: 'space' },
  { elId: 's-keyPip',             storeKey: 'hotkeysSettings',  prop: 'pip',                             default: 'p'     },
  { elId: 's-keyEditIntro',       storeKey: 'hotkeysSettings',  prop: 'editIntro',                       default: 'i'     },
  { elId: 's-keyEditOutro',       storeKey: 'hotkeysSettings',  prop: 'editOutro',                       default: 'o'     },
  { elId: 's-keySkip10Back',      storeKey: 'hotkeysSettings',  prop: 'skip10Back',                      default: 'j'     },
  { elId: 's-keySkip10Forward',   storeKey: 'hotkeysSettings',  prop: 'skip10Forward',                   default: 'l'     },
  { elId: 's-keyBackward',        storeKey: 'hotkeysSettings',  prop: 'fastBackward',                   default: 'left'  },
  { elId: 's-keyForward',         storeKey: 'hotkeysSettings',  prop: 'fastForward',                    default: 'right' },
  { elId: 's-keyFullscreen',      storeKey: 'hotkeysSettings',  prop: 'fullscreen',                     default: 'f'     },
  { elId: 's-keyLargeSkip',       storeKey: 'hotkeysSettings',  prop: 'largeSkip',                      default: 'v'     },
];

const FLAT_SETTINGS = [
  { elId: 's-language',          storageKey: 'popup_language',           default: 'de'  },
  { elId: 's-animeSkipClientId', storageKey: 'animeSkipClientId',        default: ''    },
  { elId: 's-skipTimesLimit',    storageKey: 'aw_local_skiptimes_limit', default: 500   },
];

function applyToEl(el, val) {
  if (el.type === 'checkbox') el.checked = !!val;
  else if (el.type === 'number') el.value = Number(val);
  else el.value = val != null ? String(val) : '';
}

function readFromEl(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Number(el.value);
  return el.value.trim();
}

async function loadSettings() {
  const storeKeys = [...new Set(NESTED_SETTINGS.map(s => s.storeKey)), ...FLAT_SETTINGS.map(s => s.storageKey)];
  const data = await chrome.storage.local.get(storeKeys);

  for (const { elId, storeKey, prop, default: def } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    let storeObj = {};
    try { storeObj = JSON.parse(data[storeKey]) || {}; } catch (_) {}
    const val = prop in storeObj ? storeObj[prop] : def;
    applyToEl(el, val);
  }

  for (const { elId, storageKey, default: def } of FLAT_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    const val = data[storageKey] !== undefined ? data[storageKey] : def;
    applyToEl(el, val);
  }

  const allKeys = await chrome.storage.local.get(null);
  const count = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::')).length;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = t('setting.skipEntries.count', count);
}

async function doSaveSettings() {
  const storeKeys = [...new Set(NESTED_SETTINGS.map(s => s.storeKey))];
  const data = await chrome.storage.local.get(storeKeys);

  const toSave = {};
  for (const { elId, storeKey, prop } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    if (!toSave[storeKey]) {
      try { toSave[storeKey] = JSON.parse(data[storeKey]) || {}; } catch (_) { toSave[storeKey] = {}; }
    }
    toSave[storeKey][prop] = readFromEl(el);
  }
  for (const key of Object.keys(toSave)) {
    toSave[key] = JSON.stringify(toSave[key]);
  }

  for (const { elId, storageKey } of FLAT_SETTINGS) {
    const el = document.getElementById(elId);
    if (!el) continue;
    toSave[storageKey] = readFromEl(el);
  }

  await chrome.storage.local.set(toSave);
}

function showHint(hintId, textKey) {
  const hint = document.getElementById(hintId);
  if (!hint) return;
  hint.textContent = t(textKey);
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 2000);
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  await doSaveSettings();
  showHint('saveHint', 'save.hint');
});

document.getElementById('saveSettingsAdv').addEventListener('click', async () => {
  await doSaveSettings();
  showHint('saveHintAdv', 'save.hint');
});

document.getElementById('resetSettings').addEventListener('click', async () => {
  for (const { elId, default: def } of NESTED_SETTINGS) {
    const el = document.getElementById(elId);
    if (el) applyToEl(el, def);
  }
  for (const { elId, default: def } of FLAT_SETTINGS) {
    const el = document.getElementById(elId);
    if (el) applyToEl(el, def);
  }
  await doSaveSettings();
  showHint('saveHintAdv', 'save.resetDone');
  const allKeys = await chrome.storage.local.get(null);
  const count = Object.keys(allKeys).filter(k => k.startsWith('aw_local_skiptimes::')).length;
  const countEl = document.getElementById('skipTimesCount');
  if (countEl) countEl.textContent = t('setting.skipEntries.count', count);
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

// ── Force autoplay with sound (Windows registry policy) ───────────────────────
// Reads the real site domains straight from the manifest's content_scripts
// matches, so this stays correct if domains are ever added/removed there.
function getAutoplayForceDomains() {
  const matches = chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? [];
  const domains = new Set();
  for (const pattern of matches) {
    const m = pattern.match(/^[a-z*]+:\/\/([^/]+)\//i);
    if (!m) continue;
    const host = m[1];
    if (!host || host.includes('*') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue; // skip wildcards/IPs
    domains.add(host);
  }
  return [...domains];
}

function updateAutoplayForceDomainsText() {
  const el = document.getElementById('autoplayForceDomains');
  if (el) el.textContent = t('autoplayForce.domains', getAutoplayForceDomains());
}

function buildAutoplayAllowlistReg(domains, { remove } = {}) {
  const key = 'HKEY_CURRENT_USER\\SOFTWARE\\Policies\\Google\\Chrome\\AutoplayAllowlist';
  if (remove) {
    return `Windows Registry Editor Version 5.00\r\n\r\n[-${key}]\r\n`;
  }
  const entries = domains.map((d, i) => `"${i + 1}"="${d}"`).join('\r\n');
  return `Windows Registry Editor Version 5.00\r\n\r\n[${key}]\r\n${entries}\r\n`;
}

function downloadRegFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('downloadAutoplayRegEnable').addEventListener('click', () => {
  const domains = getAutoplayForceDomains();
  downloadRegFile('aniworld-autoplay-allow.reg', buildAutoplayAllowlistReg(domains));
});
document.getElementById('downloadAutoplayRegDisable').addEventListener('click', () => {
  downloadRegFile('aniworld-autoplay-allow-remove.reg', buildAutoplayAllowlistReg([], { remove: true }));
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
