(async function() {
    'use strict';

    // Only run on allowed domains (top-level frame check).
    // Iframes are still allowed on any domain to support embedded video players (voe.sx etc.).
    const ALLOWED_HOSTS = ['aniworld.to', 's.to', 'serienstream.to'];
    if (window === window.top) {
        const host = location.hostname.replace(/^www\./, '');
        if (!ALLOWED_HOSTS.some(d => host === d || host.endsWith('.' + d))) {
            return;
        }
    }

    // Wait for chrome.storage.local to be fully loaded into the sync cache
    await GMCompat.init();

    const MANUAL_EPISODE_NAV_KEY = 'aw_manual_episode_nav_pending';
    const MANUAL_EPISODE_NAV_SESSION_KEY = 'aw_manual_episode_nav_pending';
    const MANUAL_EPISODE_NAV_TTL_MS = 30 * 1000;

    function readManualEpisodeNavigationEntry() {
        try {
            const sessionRaw = sessionStorage.getItem(MANUAL_EPISODE_NAV_SESSION_KEY);
            if (sessionRaw) {
                return JSON.parse(sessionRaw);
            }
        } catch {}

        return GM_getValue(MANUAL_EPISODE_NAV_KEY, null);
    }

    function clearManualEpisodeNavigationEntry() {
        try {
            sessionStorage.removeItem(MANUAL_EPISODE_NAV_SESSION_KEY);
        } catch {}
        GM_deleteValue(MANUAL_EPISODE_NAV_KEY);
    }

    function markManualEpisodeNavigation(href = '') {
        const entry = {
            href,
            _createdAt: Date.now(),
        };
        try {
            sessionStorage.setItem(MANUAL_EPISODE_NAV_SESSION_KEY, JSON.stringify(entry));
        } catch {}
        GM_setValue(MANUAL_EPISODE_NAV_KEY, entry);
    }

    function consumeManualEpisodeNavigation() {
        const entry = readManualEpisodeNavigationEntry();
        if (!entry) return false;

        clearManualEpisodeNavigationEntry();

        if (!entry._createdAt) return false;
        if ((Date.now() - entry._createdAt) > MANUAL_EPISODE_NAV_TTL_MS) return false;

        return true;
    }

    function setupManualEpisodeNavigationTracking() {
        if (window !== window.top) return;
        if (window.__awManualEpisodeNavTrackingInstalled) return;
        window.__awManualEpisodeNavTrackingInstalled = true;

        const markIfEpisodeNavigation = (event) => {
            if (!event.isTrusted) return;
            if (typeof event.button === 'number' && event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const episodeLink = event.target.closest(
                [
                    '#episode-nav a[href*="/episode-"]',
                    '#episode-nav .nav-link[href*="/episode-"]',
                    'div#stream.hosterSiteDirectNav a[data-episode-id]',
                    'div#stream.hosterSiteDirectNav a[href*="/episode-"]',
                    'a.watchEpisode[href*="/episode-"]',
                    'a.btn-link[href*="/episode-"]',
                    // Catch-all for episode overview page: any trusted click on an episode link
                    'a[href*="/episode-"]',
                ].join(', ')
            );
            if (!episodeLink) return;

            markManualEpisodeNavigation(episodeLink.href || '');
            console.log('[Autoplay] Marked manual episode navigation:', episodeLink.href || '(no href)');
        };

        document.addEventListener('pointerdown', markIfEpisodeNavigation, true);
        document.addEventListener('click', markIfEpisodeNavigation, true);
    }

    // Listen for popup commands (only in top frame to avoid duplicates)
    if (window === window.top) {
        chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
            if (msg.type === 'CLEAR_NODATA_CACHE') {
                const keys = GM_listValues().filter(k =>
                    k.startsWith('aw_nodata::') || k.startsWith('aw_animeskip::')
                );
                keys.forEach(k => GM_deleteValue(k));
                console.log(`[AniSkip] Cleared ${keys.length} cache entries (nodata + animeskip)`);
                sendResponse({ cleared: keys.length });
            }

            if (msg.type === 'OPEN_SKIP_TIMES_DIALOG') {
                const available = GM_getValue('_aniSkipAvailable', 0);
                console.log('[AniSkip] OPEN_SKIP_TIMES_DIALOG received — available:', !!available);
                if (available) {
                    // Trigger the listener registered in the video-player iframe
                    GM_setValue('aw_open_skip_dialog', { ts: Date.now(), type: msg.dialogType || 'intro' });
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false });
                }
                return true;
            }
        });
    }

    // ============================================================
    // Age Gate Blocker — runs in every frame (top + iframes)
    // Automatically clicks "Confirm"/"OK" on 18+ age-check overlays
    // from embedded video providers (VOE, Doodstream, Filemoon, etc.)
    // ============================================================
    (function installAgeGateBlocker() {
        // Text patterns for age gates, gambling ads and generic promotional popups
        const POPUP_TEXT = /\b18\+|are\s+you\s+18|age\s+verif|altersverif|shop\s*now|jetzt\s+kauf|verkauf|buy\s+now|special\s+offer|sonderangebot|raffle|lottery|don'?t\s+miss|try\s+your\s+luck|miss\s+your\s+chance|free\s+spin|spin\s+to\s+win|claim\s+(now|your)|exclusive\s+(deal|offer|prize)|limited\s+(time\s+)?offer|gewinnspiel|gl[üu]cksspiel|jetzt\s+gewinnen|sicher\s+dir|hol\s+dir\s+deinen/i;

        // Domains that should never appear as iframes in a video player context
        const AD_DOMAIN_RE = /betvip\.|bet-vip\.|betway\.|bet365\.|betsson\.|unibet\.|bwin\.|888casino\.|casino|raffle\.|lottery\.|adnxs\.com|doubleclick\.net|googlesyndication\.com|popads\.net|popcash\.net|adsterra\.com|trafficjunky\.|exoclick\.com|juicyads\.|hilltopads\.|plugrush\.|adspyglass\.|tsyndicate\.|realsrv\.|adhese\.|adtelligent\.|mgid\.|outbrain\.|taboola\.|propellerads\./i;

        function isAdSrc(src) {
            if (!src || src === 'about:blank' || src.startsWith('blob:') || src.startsWith('data:')) return false;
            try { return AD_DOMAIN_RE.test(new URL(src).hostname); }
            catch (_) { return AD_DOMAIN_RE.test(src); }
        }

        function looksLikeAgeGate(el) {
            return POPUP_TEXT.test(el.innerText || el.textContent || '');
        }

        function dismissAgeGate(el) {
            // 1. Try clicking an X / close button first
            const closeBtn = el.querySelector(
                '[class*="close"], [class*="dismiss"], [aria-label*="close"], [aria-label*="Close"], button[title*="close"]'
            );
            if (closeBtn) {
                console.log('[AgeGateBlocker] Clicking close/X button');
                closeBtn.click();
                return;
            }
            // 2. Try clicking an X text node (bare × or ✕ character)
            const allBtns = el.querySelectorAll('button, [role="button"], a, span, div');
            for (const b of allBtns) {
                if (/^[×✕✖xX]$/.test((b.textContent || '').trim())) {
                    console.log('[AgeGateBlocker] Clicking × button');
                    b.click();
                    return;
                }
            }
            // 3. Try to click any confirm/ok/yes/close button inside the overlay
            const buttons = el.querySelectorAll(
                'button, [role="button"], input[type="button"], input[type="submit"], a, .btn, [class*="btn"], [class*="button"]'
            );
            for (const btn of buttons) {
                if (/confirm|ok|yes|accept|bestätig|weiter|continue|close|dismiss|no\s+thanks|nein\s+danke/i.test(btn.textContent || btn.value || '')) {
                    console.log('[AgeGateBlocker] Clicking confirm button:', (btn.textContent || btn.value).trim());
                    btn.click();
                    return;
                }
            }
            // Fallback: hide the overlay — but never hide <body> or <html>
            if (el === document.body || el === document.documentElement) {
                console.log('[AgeGateBlocker] No button found in body — skipping hide to avoid breaking the page');
                return;
            }
            console.log('[AgeGateBlocker] Hiding overlay:', el.tagName, el.id || el.className);
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
        }

        /**
         * Remove a popup-overlay iframe permanently.
         * If the player re-creates it the MutationObserver will catch it again.
         */
        function removePopupIframe(iframe, reason) {
            const src = iframe.src || '(no src)';
            console.log(`[AgeGateBlocker] Removing popup iframe — ${reason} (src=${src})`);
            iframe.remove();
        }

        /**
         * Check a newly added iframe. Signals checked in order:
         *   0. Known ad domain in src → remove immediately (works cross-origin)
         *   1. Style heuristic (border-radius + box-shadow, or fixed+high-z) → remove immediately
         *   2. Content check for same-origin readable docs → remove on load
         *   3. Watch src attribute changes (lazy-loaded ad iframes)
         */
        function checkNewIframe(iframe) {
            // Signal 0: known ad/gambling domain
            if (isAdSrc(iframe.src)) {
                removePopupIframe(iframe, 'ad-domain');
                return;
            }

            const s = iframe.style;
            const zIndex = parseInt(s.zIndex || '0', 10);

            // Signal 1: popup-like styling
            const hasStyleSignal = !!(s.borderRadius && s.boxShadow)
                || (s.position === 'fixed'    && zIndex > 1000)
                || (s.position === 'absolute' && zIndex > 9000);
            if (hasStyleSignal) {
                removePopupIframe(iframe, 'style-heuristic');
                return;
            }

            // Signal 2: content check for same-origin iframes
            const check = () => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (doc && looksLikeAgeGate(doc.body || doc.documentElement)) {
                        removePopupIframe(iframe, 'content-match');
                        return;
                    }
                    // Also check for ad domains loaded dynamically into about:blank iframes
                    const loc = iframe.contentWindow?.location?.href;
                    if (loc && isAdSrc(loc)) {
                        removePopupIframe(iframe, 'content-ad-domain');
                    }
                } catch (_) { /* cross-origin — skip */ }
            };

            if (iframe.contentDocument?.readyState === 'complete') {
                check();
            } else {
                iframe.addEventListener('load', check, { once: true });
            }

            // Signal 3: watch src changes (some players set src after insertion)
            const srcObserver = new MutationObserver(() => {
                if (isAdSrc(iframe.src)) {
                    removePopupIframe(iframe, 'src-mutated-to-ad');
                    srcObserver.disconnect();
                }
            });
            srcObserver.observe(iframe, { attributes: true, attributeFilter: ['src'] });
        }

        function scanAndDismiss(root) {
            // 1. Named-selector scan (catches standard overlay patterns)
            const candidates = root.querySelectorAll(
                '.modal, .overlay, .popup, .dialog, [class*="age"], [class*="gate"], ' +
                '[class*="confirm"], [class*="adult"], [class*="verify"], ' +
                '[class*="raffle"], [class*="promo"], [class*="offer"], [class*="reward"], ' +
                '[id*="age"], [id*="gate"], [id*="confirm"], [id*="adult"], ' +
                '[id*="raffle"], [id*="promo"], [id*="offer"]'
            );
            for (const el of candidates) {
                if (looksLikeAgeGate(el)) dismissAgeGate(el);
            }

            // 2. Broad body-level check: only in about:blank frames where the
            //    entire document IS the popup (injected by the video player).
            //    Never run this on real pages to avoid false positives.
            if (root === document.body && location.href === 'about:blank' && looksLikeAgeGate(document.body)) {
                dismissAgeGate(document.body);
                return;
            }

            // 3. Check for overlay iframes injected into the current frame
            for (const iframe of root.querySelectorAll('iframe')) {
                checkNewIframe(iframe);
            }
        }

        const startObserver = () => {
            if (document.body) scanAndDismiss(document.body);
            const observer = new MutationObserver((mutations) => {
                for (const mut of mutations) {
                    for (const node of mut.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        if (node.tagName === 'IFRAME') {
                            checkNewIframe(node);
                        } else if (looksLikeAgeGate(node)) {
                            dismissAgeGate(node);
                        } else {
                            scanAndDismiss(node);
                        }
                    }
                }
            });
            observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true,
            });
        };

        if (document.body) {
            startObserver();
        } else {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        }
    }());

    // ============================================================
    // Click-Ad Blocker — prevents video players (VOE, Doodstream,
    // etc.) from opening ad tabs when the user clicks inside them.
    // Runs in every frame (top page + all iframes).
    // ============================================================
    (function installClickAdBlocker() {
        // Inject into page context (content scripts run in isolated world
        // and cannot override window.open for the page's own JS).
        const s = document.createElement('script');
        s.textContent = `(function(){
            try {
                var _open = window.open;
                window.open = function(url, target, features) {
                    var t = (target || '').trim();
                    // Block all new-tab/popup opens — these are always ads in video players
                    if (!t || t === '_blank' || t === '_top' || t === '_parent') {
                        console.log('[ClickAdBlocker] Blocked popup:', url);
                        return { closed: true, close: function(){}, focus: function(){}, blur: function(){} };
                    }
                    return _open.apply(this, arguments);
                };
            } catch (e) {}
            // Also block <a target="_blank/_top/_parent"> clicks that bypass window.open
            document.addEventListener('click', function(e) {
                try {
                    var a = e.target && e.target.closest && e.target.closest('a[target]');
                    if (!a) return;
                    var t = (a.target || '').trim();
                    if (t !== '_blank' && t !== '_top' && t !== '_parent') return;
                    var href = a.href || '';
                    // Allow legitimate aniworld/s.to same-site links
                    if (/^https?:\\/\\/(aniworld\\.to|s\\.to|serienstream\\.to)([\\/\\?#]|$)/.test(href)) return;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    console.log('[ClickAdBlocker] Blocked link:', href);
                } catch (e) {}
            }, true);
        })();`;
        try {
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch (e) {}
    }());

    // ============================================================
    // AniSkip Integration Module
    // ============================================================
    const AniSkipModule = {
        gmFetchJson(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url,
                    headers: { "Accept": "application/json" },
                    timeout: 8000,
                    onload: (res) => {
                        try {
                            const json = JSON.parse(res.responseText);
                            if (res.status < 200 || res.status >= 300) {
                                reject(new Error(`[HTTP ${res.status}] ${json?.message || res.statusText || 'Request failed'}`));
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            reject(new Error(`Invalid JSON response from ${url}: ${e.message}`));
                        }
                    },
                    onerror: (err) => reject(new Error(err?.statusText || err?.error || 'Network error')),
                    ontimeout: () => reject(new Error(`Request timed out: ${url}`)),
                });
            });
        },

        gmPostJson(url, body, extraHeaders = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        ...extraHeaders,
                    },
                    data: JSON.stringify(body),
                    timeout: 8000,
                    onload: (res) => {
                        try {
                            const json = JSON.parse(res.responseText);
                            if (res.status < 200 || res.status >= 300) {
                                reject(new Error(`[HTTP ${res.status}] ${json?.message || res.statusText || 'Request failed'}`));
                                return;
                            }
                            if (Array.isArray(json?.errors) && json.errors.length) {
                                reject(new Error(json.errors[0]?.message || 'GraphQL request failed'));
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            reject(new Error(`Invalid JSON response from ${url}: ${e.message}`));
                        }
                    },
                    onerror: (err) => reject(new Error(err?.statusText || err?.error || 'Network error')),
                    ontimeout: () => reject(new Error(`Request timed out: ${url}`)),
                });
            });
        },

        candidateTitles(result) {
            const synonyms = [
                ...(Array.isArray(result?.title_synonyms) ? result.title_synonyms : []),
                ...(Array.isArray(result?.synonyms) ? result.synonyms : []),
            ];
            return [
                typeof result?.title === 'string' ? result.title : null,
                result?.title_english,
                result?.title_japanese,
                result?.title?.romaji,
                result?.title?.english,
                result?.title?.native,
                ...synonyms,
            ].filter(Boolean);
        },

        rawTokenSet(s) {
            const normalized = String(s || "")
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/&/g, " and ")
                .replace(/[_/-]/g, " ")
                .replace(/['".:!?()[\]{}]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            return new Set(normalized.split(" ").filter(Boolean));
        },

        getTitleFromPage() {
            const h1 = document.querySelector("h1");
            return h1 ? h1.textContent.trim() : null;
        },

        getSlugFromUrl() {
            const m = location.pathname.match(/^\/anime\/stream\/([^/]+)/);
            return m ? m[1] : null;
        },

        getEpisodeFromUrl() {
            const m = location.pathname.match(/\/episode-(\d+)\b/i);
            return m ? parseInt(m[1], 10) : null;
        },

        getSeasonFromUrl() {
            const m = location.pathname.match(/\/staffel-(\d+)\b/i);
            return m ? parseInt(m[1], 10) : null;
        },

        normalizeTitle(s) {
            return (s || "")
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/&/g, " and ")
                .replace(/[_/-]/g, " ")
                .replace(/['".:!?()[\]{}]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/\b(staffel|season|cour|part|folge|episode|ova|movie|film|specials?)\b/g, "")
                .replace(/\s+/g, " ")
                .trim();
        },

        tokenSet(s) {
            return new Set(this.normalizeTitle(s).split(" ").filter(Boolean));
        },

        overlapScore(a, b) {
            const A = this.tokenSet(a), B = this.tokenSet(b);
            if (!A.size || !B.size) return 0;
            let inter = 0;
            for (const t of A) if (B.has(t)) inter++;
            const union = A.size + B.size - inter;
            return (inter / union) * 100;
        },

        seasonHintTokens(season) {
            if (!Number.isFinite(season) || season <= 1) return new Set();

            const romanMap = {
                2: 'ii',
                3: 'iii',
                4: 'iv',
                5: 'v',
                6: 'vi',
                7: 'vii',
                8: 'viii',
                9: 'ix',
                10: 'x',
            };
            const ordinalMap = {
                2: ['2nd', 'second'],
                3: ['3rd', 'third'],
                4: ['4th', 'fourth'],
                5: ['5th', 'fifth'],
                6: ['6th', 'sixth'],
                7: ['7th', 'seventh'],
                8: ['8th', 'eighth'],
                9: ['9th', 'ninth'],
                10: ['10th', 'tenth'],
            };

            return new Set([String(season), romanMap[season], ...(ordinalMap[season] || [])].filter(Boolean));
        },

        seasonMatchScore(result, season) {
            const seasonHints = this.seasonHintTokens(season);
            if (!seasonHints.size) return 0;

            let score = 0;
            for (const title of this.candidateTitles(result)) {
                const tokens = this.rawTokenSet(title);
                for (const hint of seasonHints) {
                    if (tokens.has(hint)) {
                        score = Math.max(score, 20);
                    }
                }

                const rawTitle = String(title || "").toLowerCase();
                if (season >= 4 && rawTitle.includes('final season')) {
                    score = Math.max(score, 12);
                }
            }

            return score;
        },

        pickBestMatch(results, targetTitle, season = null) {
            let best = null;
            let bestScore = -Infinity;
            let bestTextScore = -Infinity;

            for (const [index, result] of results.entries()) {
                const candTitles = this.candidateTitles(result);
                let textScore = 0;
                for (const t of candTitles) {
                    textScore = Math.max(textScore, this.overlapScore(targetTitle, t));
                }

                const score = textScore
                    + this.seasonMatchScore(result, season)
                    + Math.max(0, 10 - index);

                if (score > bestScore) {
                    best = result;
                    bestScore = score;
                    bestTextScore = textScore;
                }
            }

            return { best, bestScore, bestTextScore };
        },

        makeSkipCacheKey(malId, episode, episodeLength = 0) {
            const roundedLength = Number.isFinite(episodeLength) && episodeLength > 0
                ? Math.round(episodeLength)
                : 0;
            return `aw_aniskip::${malId}::${episode}::len${roundedLength}`;
        },

        async searchAniListCandidates(searchTitle) {
            const query = `
                query ($search: String!, $perPage: Int!) {
                    Page(page: 1, perPage: $perPage) {
                        media(search: $search, type: ANIME, isAdult: false) {
                            idMal
                            title {
                                romaji
                                english
                                native
                            }
                            synonyms
                            format
                            seasonYear
                            startDate {
                                year
                            }
                        }
                    }
                }
            `;

            let json;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    json = await this.gmPostJson('https://graphql.anilist.co', {
                        query,
                        variables: {
                            search: searchTitle,
                            perPage: 15,
                        },
                    });
                    break;
                } catch (err) {
                    if (attempt === 2) throw err;
                    await new Promise((resolve) => setTimeout(resolve, 350));
                }
            }

            return json?.data?.Page?.media ?? [];
        },

        async getMalId(title, slug, season = null) {
            if (!title || !slug) return null;

            // Include season in cache key to avoid conflicts between seasons
            const malCacheKey = season && season > 1
                ? `aw_mal_id::${slug}::s${season}`
                : `aw_mal_id::${slug}`;
            const cachedRaw = localStorage.getItem(malCacheKey);
            if (cachedRaw) {
                try {
                    const cacheData = JSON.parse(cachedRaw);
                    if (cacheData && cacheData._cachedAt && cacheData.malId) {
                        const cacheAge = Date.now() - cacheData._cachedAt;
                        const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
                        if (cacheAge < CACHE_TTL) {
                            return cacheData.malId;
                        } else {
                            localStorage.removeItem(malCacheKey);
                        }
                    } else {
                        // Old format (plain string) - clear it so it gets re-fetched with proper matching
                        localStorage.removeItem(malCacheKey);
                    }
                } catch (e) {
                    // Old format was a plain string, not JSON - clear it
                    localStorage.removeItem(malCacheKey);
                }
            }

            try {
                const searchQueries = [
                    season && season > 1 ? `${title} season ${season}` : null,
                    title,
                ].filter((query, index, arr) => query && arr.indexOf(query) === index);

                let selectedMatch = null;
                let lastError = null;

                for (const searchTitle of searchQueries) {
                    try {
                        const q = encodeURIComponent(searchTitle);
                        const url = `https://api.jikan.moe/v4/anime?q=${q}&limit=15`;
                        let json;
                        for (let attempt = 1; attempt <= 2; attempt++) {
                            try {
                                json = await this.gmFetchJson(url);
                                break;
                            } catch (err) {
                                lastError = err;
                                if (attempt === 2) throw err;
                                await new Promise((resolve) => setTimeout(resolve, 350));
                            }
                        }
                        const results = json?.data ?? [];
                        const match = this.pickBestMatch(results, title, season);

                        if (!selectedMatch || match.bestScore > selectedMatch.bestScore) {
                            selectedMatch = { ...match, searchTitle };
                        }
                    } catch (err) {
                        lastError = err;
                        console.warn('[AniSkip] Jikan query failed:', err?.message || err, { searchTitle, title, season });
                        continue;
                    }
                }

                if (selectedMatch?.best?.mal_id && selectedMatch.bestTextScore >= 25) {
                    console.log('[AniSkip] Jikan match:', {
                        query: selectedMatch.searchTitle,
                        requestedTitle: title,
                        season,
                        matchedTitle: selectedMatch.best.title,
                        malId: selectedMatch.best.mal_id,
                        score: selectedMatch.bestScore,
                        textScore: selectedMatch.bestTextScore,
                    });

                    const malId = String(selectedMatch.best.mal_id);
                    localStorage.setItem(malCacheKey, JSON.stringify({ malId, _cachedAt: Date.now() }));
                    return malId;
                }

                if (lastError && !selectedMatch) {
                    console.warn('[AniSkip] Falling back to AniList MAL lookup:', lastError?.message || lastError, { title, season });
                }

                if (!selectedMatch?.best?.mal_id || selectedMatch.bestTextScore < 25) {
                    let aniListMatch = null;
                    let aniListLastError = null;

                    for (const searchTitle of searchQueries) {
                        try {
                            const results = await this.searchAniListCandidates(searchTitle);
                            const normalizedResults = results
                                .filter((result) => Number.isFinite(result?.idMal))
                                .map((result) => ({
                                    ...result,
                                    mal_id: result.idMal,
                                }));

                            const match = this.pickBestMatch(normalizedResults, title, season);
                            if (!aniListMatch || match.bestScore > aniListMatch.bestScore) {
                                aniListMatch = { ...match, searchTitle };
                            }
                        } catch (err) {
                            aniListLastError = err;
                            console.warn('[AniSkip] AniList query failed:', err?.message || err, { searchTitle, title, season });
                        }
                    }

                    if (aniListMatch?.best?.mal_id && aniListMatch.bestTextScore >= 25) {
                        const matchedTitle = this.candidateTitles(aniListMatch.best)[0] || '(unknown)';
                        console.log('[AniSkip] AniList match:', {
                            query: aniListMatch.searchTitle,
                            requestedTitle: title,
                            season,
                            matchedTitle,
                            malId: aniListMatch.best.mal_id,
                            score: aniListMatch.bestScore,
                            textScore: aniListMatch.bestTextScore,
                        });

                        const malId = String(aniListMatch.best.mal_id);
                        localStorage.setItem(malCacheKey, JSON.stringify({ malId, _cachedAt: Date.now() }));
                        return malId;
                    }

                    if (aniListLastError && !aniListMatch) {
                        throw aniListLastError;
                    }
                }
            } catch (e) {
                console.error('[AniSkip] Failed to fetch MAL ID:', e?.message || e, { title, slug, season });
            }
            return null;
        },

        async getSkipTimes(malId, episode, episodeLength = 0) {
            if (!malId || !episode) return null;
            const skipCacheKey = this.makeSkipCacheKey(malId, episode, episodeLength);
            const cached = localStorage.getItem(skipCacheKey);

            if (cached) {
                try {
                    const cacheData = JSON.parse(cached);
                    // Support both old format (raw array) and new format (with timestamp)
                    if (cacheData && cacheData._cachedAt) {
                        const cacheAge = Date.now() - cacheData._cachedAt;
                        const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
                        if (cacheAge < CACHE_TTL) {
                            return cacheData.results;
                        } else {
                            localStorage.removeItem(skipCacheKey);
                        }
                    } else if (Array.isArray(cacheData)) {
                        // Old format without timestamp - use it but re-cache with timestamp on next fetch
                        localStorage.removeItem(skipCacheKey);
                    }
                }
                catch (e) { console.error('[AniSkip] Failed to parse cached skip times:', e); }
            }

            try {
                const epLen = Number.isFinite(episodeLength) && episodeLength > 0 ? episodeLength : 0;
                const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${epLen}`;
                console.log('[AniSkip] API URL:', url);
                const json = await this.gmFetchJson(url);
                console.log('[AniSkip] API Response:', json);

                if (json?.found && json.results && json.results.length > 0) {
                    const results = json.results;
                    localStorage.setItem(skipCacheKey, JSON.stringify({ results, _cachedAt: Date.now() }));
                    return results;
                }

                // Log why we didn't get results
                if (json?.found === false) {
                    console.log('[AniSkip] API returned found: false');
                } else if (json?.results?.length === 0) {
                    console.log('[AniSkip] API returned empty results array');
                }
            } catch (e) {
                console.error('[AniSkip] Failed to fetch skip times:', e);
            }
            return null;
        },

        parseSkipTimes(results, actualEpisodeLength = 0) {
            if (!results || !results.length) return null;

            const parsed = { intro: null, outro: null, recap: null };

            // Group results by type, picking the one with the closest episodeLength
            const bestByType = {};

            for (const r of results) {
                const typ = r.skip_type ?? r.skipType;
                const interval = r.interval ?? {};
                const startTime = interval.start_time ?? interval.startTime ?? r.start_time ?? r.startTime;
                const endTime = interval.end_time ?? interval.endTime ?? r.end_time ?? r.endTime;

                const start = Number.parseFloat(startTime);
                const end = Number.parseFloat(endTime);

                if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

                const category = (typ === 'op' || typ === 'mixed-op') ? 'intro'
                               : (typ === 'ed' || typ === 'mixed-ed') ? 'outro'
                               : (typ === 'recap') ? 'recap'
                               : null;
                if (!category) continue;

                const resultEpLen = r.episode_length ?? r.episodeLength ?? 0;
                const distance = actualEpisodeLength > 0 ? Math.abs(resultEpLen - actualEpisodeLength) : 0;

                if (!bestByType[category] || distance < bestByType[category].distance) {
                    bestByType[category] = { start, end, type: typ, distance };
                }
            }

            if (bestByType.intro) {
                parsed.intro = { start: bestByType.intro.start, end: bestByType.intro.end, type: bestByType.intro.type };
            }
            if (bestByType.outro) {
                parsed.outro = { start: bestByType.outro.start, end: bestByType.outro.end, type: bestByType.outro.type };
            }
            if (bestByType.recap) {
                parsed.recap = { start: bestByType.recap.start, end: bestByType.recap.end, type: bestByType.recap.type };
            }

            return parsed;
        },

        async submitSkipTimes(malId, episode, episodeLength, introStart, introEnd) {
            if (!malId || !episode) return { success: false, error: 'Missing MAL ID or episode' };

            if (!Number.isFinite(introStart) || !Number.isFinite(introEnd)) {
                return { success: false, error: 'Invalid times' };
            }

            if (introEnd <= introStart) {
                return { success: false, error: 'End must be greater than start' };
            }

            try {
                // AniSkip API requires POST to /v2/skip-times/{malId}/{episodeNumber}
                const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}`;

                // Generate a UUID for submitterId (v4 UUID format)
                const generateUUID = () => {
                    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0;
                        const v = c === 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                };

                const payload = {
                    skipType: 'op',
                    startTime: introStart,
                    endTime: introEnd,
                    episodeLength: episodeLength,
                    providerName: 'Aniworld',
                    submitterId: generateUUID()
                };

                console.log('[AniSkip] Submitting:', payload, 'to URL:', url);

                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: url,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        data: JSON.stringify(payload),
                        onload: (response) => {
                            console.log('[AniSkip] Submit response:', response);
                            resolve(response);
                        },
                        onerror: (error) => {
                            console.error('[AniSkip] Submit error:', error);
                            reject(error);
                        }
                    });
                });

                if (response.status >= 200 && response.status < 300) {
                    return { success: true };
                } else {
                    const errorMsg = response.responseText || `Server returned ${response.status}`;
                    return { success: false, error: errorMsg };
                }
            } catch (e) {
                console.error('[AniSkip] Submit failed:', e);
                return { success: false, error: e.message };
            }
        },

        // Save intro/outro times locally (chrome.storage.local via GM_setValue)
        // intro/outro: { start, end } or null to leave unchanged
        saveLocalSkipTimes(slug, season, episode, intro, outro) {
            const key = `aw_local_skiptimes::${slug}::s${season ?? 1}::e${episode}`;
            const existing = GM_getValue(key, null) || {};
            const updated = {
                intro: intro !== undefined ? intro : (existing.intro || null),
                outro: outro !== undefined ? outro : (existing.outro || null),
                _savedAt: Date.now()
            };
            GM_setValue(key, updated);
            console.log('[AniSkip] Saved locally:', updated);
            this.pruneLocalSkipTimes();
        },

        pruneLocalSkipTimes() {
            const limit = GM_getValue('aw_local_skiptimes_limit', 500);
            const keys = GM_listValues().filter(k => k.startsWith('aw_local_skiptimes::'));
            if (keys.length <= limit) return;
            const sorted = keys
                .map(k => ({ k, t: (GM_getValue(k, null)?._savedAt ?? 0) }))
                .sort((a, b) => a.t - b.t);
            sorted.slice(0, keys.length - limit).forEach(({ k }) => GM_deleteValue(k));
        },

        // Get locally saved skip times for an episode
        getLocalSkipTimes(slug, season, episode) {
            const key = `aw_local_skiptimes::${slug}::s${season ?? 1}::e${episode}`;
            return GM_getValue(key, null);
        },

        // Submit outro (ED) times to AniSkip API
        async submitOutroTimes(malId, episode, episodeLength, outroStart, outroEnd) {
            if (!malId || !episode) return { success: false, error: 'Missing MAL ID or episode' };
            if (!Number.isFinite(outroStart) || !Number.isFinite(outroEnd)) {
                return { success: false, error: 'Invalid times' };
            }
            if (outroEnd <= outroStart) {
                return { success: false, error: 'End must be greater than start' };
            }
            try {
                const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}`;
                const generateUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                });
                const payload = {
                    skipType: 'ed',
                    startTime: outroStart,
                    endTime: outroEnd,
                    episodeLength: episodeLength,
                    providerName: 'Aniworld',
                    submitterId: generateUUID()
                };
                console.log('[AniSkip] Submitting outro:', payload, 'to URL:', url);
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: url,
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify(payload),
                        onload: (response) => resolve(response),
                        onerror: (error) => reject(error)
                    });
                });
                if (response.status >= 200 && response.status < 300) {
                    return { success: true };
                } else {
                    return { success: false, error: response.responseText || `Server returned ${response.status}` };
                }
            } catch (e) {
                console.error('[AniSkip] Outro submit failed:', e);
                return { success: false, error: e.message };
            }
        }
    };

    // ============================================================
    // AnimeSkip Module (anime-skip.com) — Fallback for AniSkip
    // ============================================================
    const AnimeSkipModule = {
        API_URL: 'https://api.anime-skip.com/graphql',

        // Users can set their own client ID in settings (key: 'animeSkipClientId').
        // Falls back to the public test ID which is heavily rate-limited.
        getClientId() {
            return GM_getValue('animeSkipClientId') || 'ZGfO0sMF3eCwLYf8yMSCJjlynwNGRXWE';
        },

        graphqlFetch(query, variables = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: this.API_URL,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Client-ID': this.getClientId(),
                        'Accept': 'application/json',
                    },
                    data: JSON.stringify({ query, variables }),
                    timeout: 8000,
                    onload: (res) => {
                        if (res.status === 401 || res.status === 403) {
                            reject(new Error(`[AnimeSkip] Auth error ${res.status} — invalid/missing Client-ID. Get one free at anime-skip.com → Settings → Client Apps`));
                            return;
                        }
                        if (res.status < 200 || res.status >= 300) {
                            reject(new Error(`[AnimeSkip] HTTP ${res.status}: ${res.statusText} — ${res.responseText?.slice(0, 300)}`));
                            return;
                        }
                        try {
                            const json = JSON.parse(res.responseText);
                            if (json.errors?.length) {
                                reject(new Error('[AnimeSkip] GraphQL error: ' + json.errors[0].message));
                            } else {
                                resolve(json.data);
                            }
                        } catch (e) { reject(e); }
                    },
                    onerror: (e) => reject(new Error('[AnimeSkip] Network error: ' + (e.statusText || 'unknown'))),
                    ontimeout: () => reject(new Error('[AnimeSkip] Request timed out')),
                });
            });
        },

        normalizeTitle(s) {
            return (s || '')
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/&/g, ' and ')
                .replace(/[_/-]/g, ' ')
                .replace(/['".:!?()[\]{}]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        },

        titleSimilarity(a, b) {
            const wordsA = new Set(this.normalizeTitle(a).split(' ').filter(Boolean));
            const wordsB = new Set(this.normalizeTitle(b).split(' ').filter(Boolean));
            if (!wordsA.size || !wordsB.size) return 0;
            let inter = 0;
            for (const w of wordsA) if (wordsB.has(w)) inter++;
            return inter / (wordsA.size + wordsB.size - inter);
        },

        seasonMatchScore(showTitle, season) {
            const seasonHints = AniSkipModule.seasonHintTokens(season);
            if (!seasonHints.size) return 0;

            const tokens = AniSkipModule.rawTokenSet(showTitle);
            let score = 0;
            for (const hint of seasonHints) {
                if (tokens.has(hint)) {
                    score = 1;
                    break;
                }
            }

            if (!score && season >= 4 && String(showTitle || '').toLowerCase().includes('final season')) {
                score = 0.6;
            }

            return score;
        },

        async getSkipTimes(title, episode, episodeLength = 0, season = null) {
            if (!title || !episode) return null;

            const cacheKey = `aw_animeskip::${this.normalizeTitle(title).replace(/\s/g, '_')}::s${season ?? 1}::${episode}`;
            const cached = GM_getValue(cacheKey, null);
            if (cached) {
                if (cached._cachedAt && (Date.now() - cached._cachedAt) < 7 * 24 * 60 * 60 * 1000) {
                    console.log('[AnimeSkip] Cache hit:', cacheKey, '→', cached.result ? 'has data' : 'null (no data)');
                    return cached.result;
                }
                GM_deleteValue(cacheKey);
            }

            console.log('[AnimeSkip] Searching for:', title, 'ep', episode, 'season', season);
            try {
                // Step 1: search for the show by title
                const searchData = await this.graphqlFetch(`
                    query SearchShows($search: String!) {
                        searchShows(search: $search, limit: 10) {
                            id
                            name
                        }
                    }
                `, { search: season && season > 1 ? `${title} season ${season}` : title });

                const shows = searchData?.searchShows ?? [];
                console.log('[AnimeSkip] Shows found:', shows.map(s => s.name));
                if (!shows.length) {
                    console.log('[AnimeSkip] No shows found for title:', title);
                    return null;
                }

                // Pick the closest title match, but reject season mismatches.
                let bestShow = shows[0];
                let bestScore = -Infinity;
                let bestTitleScore = 0;
                let bestSeasonScore = 0;
                for (const [index, show] of shows.entries()) {
                    const titleScore = this.titleSimilarity(title, show.name);
                    const seasonScore = this.seasonMatchScore(show.name, season);
                    const score = titleScore + seasonScore + Math.max(0, 5 - index) * 0.02;
                    if (score > bestScore) {
                        bestScore = score;
                        bestShow = show;
                        bestTitleScore = titleScore;
                        bestSeasonScore = seasonScore;
                    }
                }
                console.log('[AnimeSkip] Best match:', bestShow.name, '| score:', bestScore.toFixed(2), '| title score:', bestTitleScore.toFixed(2), '| season score:', bestSeasonScore.toFixed(2));
                if (bestTitleScore < 0.15) {
                    console.log('[AnimeSkip] Score too low, skipping');
                    return null;
                }
                if (season && season > 1 && bestSeasonScore <= 0) {
                    console.log('[AnimeSkip] Rejecting fallback match because no season marker matched:', bestShow.name, '| requested season:', season);
                    return null;
                }

                // Step 2: fetch episodes for the show
                // Try the v2 API shape first (episodes field on the show), then fall back to findEpisodesByShowId
                let episodes = [];
                try {
                    const epData = await this.graphqlFetch(`
                        query FindEpisodes($showId: ID!) {
                            findEpisodesByShowId(showId: $showId) {
                                id
                                number
                                baseDuration
                                timestamps {
                                    at
                                    type { name }
                                }
                            }
                        }
                    `, { showId: bestShow.id });
                    episodes = epData?.findEpisodesByShowId ?? [];
                } catch (epErr) {
                    console.warn('[AnimeSkip] findEpisodesByShowId failed:', epErr.message);
                    // Try alternate field name
                    try {
                        const epData2 = await this.graphqlFetch(`
                            query FindEpisodes($showId: ID!) {
                                episodes(showId: $showId) {
                                    id
                                    number
                                    baseDuration
                                    timestamps {
                                        at
                                        type { name }
                                    }
                                }
                            }
                        `, { showId: bestShow.id });
                        episodes = epData2?.episodes ?? [];
                    } catch (epErr2) {
                        console.warn('[AnimeSkip] episodes() fallback also failed:', epErr2.message);
                    }
                }

                console.log('[AnimeSkip] Episodes in DB:', episodes.length, '| Looking for ep:', episode);
                const epNum = parseFloat(episode);
                const matchingEpisodes = episodes.filter(e =>
                    parseFloat(e.number) === epNum || e.number === String(episode)
                );

                if (!matchingEpisodes.length) {
                    console.log('[AnimeSkip] Episode', episode, 'not found. Available:', episodes.map(e => e.number).slice(0, 10));
                    return null;
                }

                const pickEpisode = () => {
                    const scored = matchingEpisodes.map((candidate, index) => {
                        const hasTimestamps = Array.isArray(candidate.timestamps) && candidate.timestamps.length > 0;
                        const duration = Number(candidate.baseDuration) || 0;
                        const durationDistance = episodeLength > 0 && duration > 0
                            ? Math.abs(duration - episodeLength)
                            : Number.MAX_SAFE_INTEGER;

                        return {
                            candidate,
                            index,
                            hasTimestamps,
                            duration,
                            durationDistance,
                        };
                    });

                    scored.sort((a, b) => {
                        if (a.hasTimestamps !== b.hasTimestamps) {
                            return a.hasTimestamps ? -1 : 1;
                        }
                        if (a.durationDistance !== b.durationDistance) {
                            return a.durationDistance - b.durationDistance;
                        }
                        return a.index - b.index;
                    });

                    return scored[0]?.candidate ?? null;
                };

                const ep = pickEpisode();
                console.log('[AnimeSkip] Matching episode candidates:', matchingEpisodes.length, matchingEpisodes.map(e => ({
                    id: e.id,
                    number: e.number,
                    hasTimestamps: !!e.timestamps?.length,
                    baseDuration: e.baseDuration ?? null,
                })));

                if (!ep.timestamps?.length) {
                    console.log('[AnimeSkip] Episode found but no timestamps');
                    return null;
                }

                console.log('[AnimeSkip] Timestamps:', ep.timestamps.map(t => `${t.type?.name}@${t.at}s`));
                const result = this._parseTimestamps(ep.timestamps, ep.baseDuration || episodeLength);
                console.log('[AnimeSkip] Parsed result:', result);
                GM_setValue(cacheKey, { result, _cachedAt: Date.now() });
                return result;
            } catch (e) {
                console.error('[AnimeSkip] Error:', e.message);
                return null;
            }
        },

        _parseTimestamps(timestamps, duration) {
            if (!timestamps?.length) return null;

            // anime-skip timestamps are section START markers, sorted by time.
            // End of a section = start of the next marker (or duration as fallback).
            const sorted = [...timestamps].sort((a, b) => a.at - b.at);
            let intro = null, outro = null;

            // Type names observed from anime-skip.com API:
            // "New Intro", "Intro", "op", "mixed-op"  → opening / intro
            // "New Credits", "Credits", "ed"           → ending / outro
            // "Recap"                                  → recap
            const INTRO_TYPES = new Set(['op', 'mixed-op', 'intro', 'new intro', 'opening']);
            const OUTRO_TYPES = new Set(['ed', 'credits', 'new credits', 'ending', 'outro']);

            for (let i = 0; i < sorted.length; i++) {
                const typeName = (sorted[i].type?.name ?? '').toLowerCase();
                const start = sorted[i].at;
                const end = sorted[i + 1]?.at ?? Math.min(start + 120, duration || start + 120);

                if (INTRO_TYPES.has(typeName) && !intro) {
                    intro = { start, end, type: typeName };
                }
                if (OUTRO_TYPES.has(typeName) && !outro) {
                    outro = { start, end, type: typeName };
                }
            }

            return (intro || outro) ? { intro, outro } : null;
        },
    };

    // Localization setup — reads from extension settings (popup_language), falls back to browser language
    let userLang = navigator.language.startsWith('de') ? 'de' : 'en';
    chrome.storage.local.get('popup_language').then(data => {
        if (data.popup_language) userLang = data.popup_language;
    });

    // Global storage for AniSkip data (accessible by all functions)
    let globalAniSkipData = null;


    // Session storage for submit dialog values (resets on page reload)
    let submitDialogValues = { introStart: null, introEnd: null, outroStart: null, outroEnd: null };

    const localizations = {
        en: {
            firstRunInfoTitle: `${GM_info.script.name} info`,
            firstRunInfoText: (isMobile, largeSkipKey) => `${isMobile ? 'Hold-release' : 'Right click'} the toggle button to open autoplay settings. ${isMobile ? '' : `Press "${largeSkipKey}" when an intro starts to skip it. `}Fullscreen is scrollable, allowing to switch providers on the go`,
            ok: 'Okay',
            loading: 'Loading',
            vidmolyNotReady: 'Vidmoly not ready yet.',
            couldNotLoad: 'Could not load',
            hotkeysGuide: 'Hotkeys Guide',
            close: 'Close',
            errorSaving: 'There was an error when trying to save the',
            reportBug: '. The value would reset upon player reload. Please, report the bug, with a mention of a URL of the page you\'re currently on',
            autoplayError: 'The script got an error trying autoplay. Try again, and if the problem persists, report the bug, or you can try switching video player providers if possible',
            lastAutoplayError: 'Last autoplay end up with an error, but you should be at the next episode page now. Try again, and if the problem persists, report the bug, or you can try switching video player providers if possible',
            preferences: 'Preferences',
            advanced: 'Advanced',
            apply: 'Apply',
            providersPriority: 'Providers priority',
            miscellaneous: 'Miscellaneous',
            persistentMutedAutoplay: 'Persistent muted autoplay',
            persistentMutedAutoplayTooltip: 'Seamless autoplay is not always available due to browser restrictions. This setting makes autoplay muted which in turn makes autoplay to be always available (autoplay should be enabled for this to work), but instead it requires user input (click or keypress) to unmute. Keypress works only if a video player is in focus',
            autoSkipAtStart: 'Auto-skip at start',
            autoSkipAtStartTooltip: 'Automatically skips the beginning of a video when it starts. Enable this to activate the skip feature.',
            playbackPositionMemory: 'Playback position memory',
            playbackPositionMemoryTooltip: 'Saves the last playback position and restores it whenever the video player is reloaded',
            skipSecondsOnStart: 'Skip seconds on start',
            skipSecondsOnStartTooltip: 'Number of seconds to skip from the beginning when auto-skip is enabled.',
            overrideDoubletapBehavior: 'Override double-tap behavior*',
            overrideDoubletapBehaviorTooltip: 'If enabled, default double-tap behavior (if any) is being overrided: double-tap right/left side of a video player to fast forward/rewind. Double-tap in a middle applies an intro skip. Page reload is required for this setting to take effect!',
            introSkipSize: 'Intro skip size, sec',
            introSkipSizeTooltip: 'Intro skip size. This is linked to the title and should stay the same across episodes',
            outroSkipThreshold: 'Outro skip threshold, sec',
            outroSkipThresholdTooltip: 'Autoplay triggers when the video player has fewer than THIS number of seconds left to play. It is linked to the title and should stay the same across episodes',
            resetToDefaults: 'Reset to defaults',
            hotkeys: 'Hotkeys',
            fastBackward: 'Fast backward*',
            fastBackwardTooltip: 'Hotkey for a fast backward. Page reload is required for this setting to take effect!',
            fastForward: 'Fast forward*',
            fastForwardTooltip: 'Hotkey for a fast forward. Page reload is required for this setting to take effect!',
            fullscreen: 'Fullscreen*',
            fullscreenTooltip: 'Hotkey for a fullscreen mode toggle. Page reload is required for this setting to take effect!',
            largeSkip: 'Intro skip*',
            largeSkipTooltip: 'Hotkey for an intro skip. Page reload is required for this setting to take effect!',
            defaultIntroSkipSize: 'Default intro skip size, sec',
            defaultIntroSkipSizeTooltip: 'Default intro skip size',
            defaultOutroSkipThreshold: 'Default outro skip threshold, sec',
            defaultOutroSkipThresholdTooltip: 'Default outro skip threshold',
            markWatchedAfter: 'Mark watched after, sec',
            markWatchedAfterTooltip: 'Number of seconds of approximate playback time after which a video is being marked as watched. Set to 0 to disable and mark only by a triggered autoplay',
            fastForwardSize: 'Fast forward size, sec',
            fastForwardSizeTooltip: 'Number of seconds to skip or rewind using double-taps or pressing a corresponding hotkeys',
            showSkipIntroButton: 'Show Skip Intro Button',
            showSkipIntroButtonTooltip: 'Toggle visibility of the Skip Intro button on supported players',
            showSkipIntroButtonSeconds: 'Show Skip Intro Button, sec',
            showSkipIntroButtonSecondsTooltip: 'How long (in seconds) the Skip Intro button stays visible after loading',
            highlightVisitedEpisodes: 'Highlight visited episodes',
            highlightVisitedEpisodesTooltip: 'Highlights previously visited episode links in yellow so you can easily see which episodes you have already opened',
            preloadOtherProviders: 'Preload other providers*',
            preloadOtherProvidersTooltip: 'Whether the script should try and built in a providers that are not built in by a default. Might impact network usage. Page reload is required for this setting to take effect!',
            playOnIntroSkip: 'Play on intro skip',
            playOnIntroSkipTooltip: 'Intro skip also starts playback',
            showDeviceSpecificSettings: 'Show device specific settings*',
            showDeviceSpecificSettingsTooltip: 'Show settings that usually have no use on your device. For example, if you\'re on mobile, hotkeys settings are hidden by default because there is no PC keyboard on mobile. Page reload is required for this setting to take effect!',
            doubleTapTimingThreshold: 'Double-tap timing threshold, ms*',
            doubleTapTimingThresholdTooltip: 'Adjusts the maximum time (in milliseconds) allowed between two taps for them to be recognized as a double-tap. A lower value requires faster taps, while a higher value allows more delay. Page reload is required for this setting to take effect!',
            doubleTapDistanceThreshold: 'Double-tap distance threshold, px*',
            doubleTapDistanceThresholdTooltip: 'Defines the maximum distance (in pixels) between two taps for them to be considered a double-tap. A smaller value requires taps to be closer together, while a larger value allows more separation. Page reload is required for this setting to take effect!',
            introSkipCooldown: 'Intro skip cooldown, ms*',
            introSkipCooldownTooltip: 'Cooldown for an intro skip hotkey, to prevent an accidental double skip. Page reload is required for this setting to take effect!',
            useAniSkip: 'Use AniSkip API',
            useAniSkipTooltip: 'Automatically fetch intro times from AniSkip API for accurate intro skipping. Falls back to manual intro skip size if no data is found.',
            showAniSkipNotifications: 'Show AniSkip notifications',
            showAniSkipNotificationsTooltip: 'Show notifications when AniSkip data is found or when skipping intro/outro using AniSkip times.',
            autoSkipIntro: 'Auto-skip intro',
            autoSkipIntroTooltip: 'Automatically skip the intro when it starts (uses AniSkip timing when available, otherwise uses manual intro skip size).',
            aniSkipNoIntroFound: 'AniSkip: No intro timestamp found',
            submitToAniSkip: 'Submit to AniSkip',
            submitIntroTimes: 'Submit Intro Times',
            submitIntroTimesDesc: 'Help the community by submitting intro timestamps for this episode!',
            introStartTime: 'Intro start (seconds)',
            introEndTime: 'Intro end (seconds)',
            submitButton: 'Submit',
            cancelButton: 'Cancel',
            submittingToAniSkip: 'Submitting to AniSkip...',
            submitSuccess: 'Successfully submitted! Thank you for contributing!',
            submitError: 'Failed to submit. Please try again.',
            invalidTimes: 'Invalid times. End must be greater than start.',
            aniSkipFetchSuccess: 'AniSkip: Using detected times',
            aniSkipFetchFailed: 'AniSkip: No data found, using fallback',
            aniSkipIntroDetected: 'Intro detected via AniSkip',
            aniSkipOutroDetected: 'Outro detected via AniSkip',
            usingFallbackTimes: 'Using manual skip times',
            playbackPositionExpiration: 'Playback position expiration',
            playbackPositionExpirationTooltip: 'How many DAYS need to pass before a playback position is removed from the memory',
            corsProxy: 'CORS proxy',
            corsProxyTooltip: 'To keep possible VOE-to-VOE unmuted autoplay working, the script needs to route a very small number of web requests through its own proxy server. Leave the input empty to disable this or set your own proxy',
            commlinkPollingInterval: 'Commlink polling interval, ms*',
            commlinkPollingIntervalTooltip: 'Reflects messaging responsiveness between a player and a top scope. Might impact CPU usage if set too low. 40 should be enough. Page reload is required for this setting to take effect!',
            skipIntro: 'Skip Intro',
            autoplayEnabled: 'Autoplay is enabled',
            autoplayDisabled: 'Autoplay is disabled'
        },
        de: {
            firstRunInfoTitle: `${GM_info.script.name} Info`,
            firstRunInfoText: (isMobile, largeSkipKey) => `${isMobile ? 'Halten und loslassen' : 'Rechtsklick'} Sie auf die Umschalttaste, um die Autoplay-Einstellungen zu öffnen. ${isMobile ? '' : `Drücken Sie "${largeSkipKey}", wenn ein Intro beginnt, um es zu überspringen. `}Der Vollbildmodus ist scrollbar, sodass Sie die Anbieter unterwegs wechseln können`,
            ok: 'Okay',
            loading: 'Wird geladen',
            vidmolyNotReady: 'Vidmoly ist noch nicht bereit.',
            couldNotLoad: 'Konnte nicht geladen werden',
            hotkeysGuide: 'Hotkeys-Anleitung',
            close: 'Schließen',
            errorSaving: 'Beim Speichern von ist ein Fehler aufgetreten',
            reportBug: '. Der Wert wird beim Neuladen des Players zurückgesetzt. Bitte melden Sie den Fehler unter Angabe der URL der aktuellen Seite',
            autoplayError: 'Das Skript hat beim Versuch des Autoplays einen Fehler erhalten. Versuchen Sie es erneut. Wenn das Problem weiterhin besteht, melden Sie den Fehler oder versuchen Sie, den Video-Player-Anbieter zu wechseln, falls möglich',
            lastAutoplayError: 'Das letzte Autoplay ist mit einem Fehler beendet, aber Sie sollten jetzt auf der Seite der nächsten Episode sein. Versuchen Sie es erneut. Wenn das Problem weiterhin besteht, melden Sie den Fehler oder versuchen Sie, den Video-Player-Anbieter zu wechseln, falls möglich',
            preferences: 'Einstellungen',
            advanced: 'Erweitert',
            apply: 'Anwenden',
            providersPriority: 'Anbieterpriorität',
            miscellaneous: 'Sonstiges',
            persistentMutedAutoplay: 'Dauerhaft stummgeschaltetes Autoplay',
            persistentMutedAutoplayTooltip: 'Nahtloses Autoplay ist aufgrund von Browsereinschränkungen nicht immer verfügbar. Diese Einstellung schaltet das Autoplay stumm, wodurch das Autoplay immer verfügbar ist (Autoplay muss dafür aktiviert sein), erfordert jedoch eine Benutzereingabe (Klick oder Tastendruck) zum Aufheben der Stummschaltung. Ein Tastendruck funktioniert nur, wenn ein Videoplayer im Fokus ist',
            autoSkipAtStart: 'Automatisches Überspringen am Anfang',
            autoSkipAtStartTooltip: 'Überspringt automatisch den Anfang eines Videos, wenn es startet. Aktivieren Sie dies, um die Überspringfunktion zu aktivieren.',
            playbackPositionMemory: 'Wiedergabepositionsspeicher',
            playbackPositionMemoryTooltip: 'Speichert die letzte Wiedergabeposition und stellt sie wieder her, wenn der Videoplayer neu geladen wird',
            skipSecondsOnStart: 'Sekunden am Anfang überspringen',
            skipSecondsOnStartTooltip: 'Anzahl der Sekunden, die vom Anfang an übersprungen werden sollen, wenn das automatische Überspringen aktiviert ist.',
            overrideDoubletapBehavior: 'Doppeltipp-Verhalten überschreiben*',
            overrideDoubletapBehaviorTooltip: 'Wenn aktiviert, wird das standardmäßige Doppeltipp-Verhalten (falls vorhanden) überschrieben: Doppeltippen Sie auf die rechte/linke Seite eines Videoplayers, um schnell vor- oder zurückzuspulen. Ein Doppeltipp in der Mitte wendet einen Intro-Skip an. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            introSkipSize: 'Intro-Skipgröße, Sek',
            introSkipSizeTooltip: 'Intro-Skipgröße. Dies ist mit dem Titel verknüpft und sollte über alle Episoden hinweg gleich bleiben',
            outroSkipThreshold: 'Outro-Skipschwelle, Sek',
            outroSkipThresholdTooltip: 'Autoplay wird ausgelöst, wenn der Videoplayer weniger als DIESE Anzahl von Sekunden zum Abspielen übrig hat. Es ist mit dem Titel verknüpft und sollte über alle Episoden hinweg gleich bleiben',
            resetToDefaults: 'Auf Standard zurücksetzen',
            hotkeys: 'Hotkeys',
            fastBackward: 'Schneller Rücklauf*',
            fastBackwardTooltip: 'Hotkey für einen schnellen Rücklauf. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            fastForward: 'Schneller Vorlauf*',
            fastForwardTooltip: 'Hotkey für einen schnellen Vorlauf. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            fullscreen: 'Vollbild*',
            fullscreenTooltip: 'Hotkey zum Umschalten des Vollbildmodus. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            largeSkip: 'Intro überspringen*',
            largeSkipTooltip: 'Hotkey für einen Intro-Skip. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            defaultIntroSkipSize: 'Standard-Intro-Skipgröße, Sek',
            defaultIntroSkipSizeTooltip: 'Standard-Intro-Skipgröße',
            defaultOutroSkipThreshold: 'Standard-Outro-Skipschwelle, Sek',
            defaultOutroSkipThresholdTooltip: 'Standard-Outro-Skipschwelle',
            markWatchedAfter: 'Als angesehen markieren nach, Sek',
            markWatchedAfterTooltip: 'Anzahl der Sekunden ungefährer Wiedergabezeit, nach der ein Video als angesehen markiert wird. Auf 0 setzen, um zu deaktivieren und nur durch ein ausgelöstes Autoplay zu markieren',
            fastForwardSize: 'Schnellvorlaufgröße, Sek',
            fastForwardSizeTooltip: 'Anzahl der Sekunden, die mit Doppeltipps oder durch Drücken einer entsprechenden Hotkey übersprungen oder zurückgespult werden sollen',
            showSkipIntroButton: 'Intro überspringen-Button anzeigen',
            showSkipIntroButtonTooltip: 'Sichtbarkeit des Intro überspringen-Buttons auf unterstützten Playern umschalten',
            showSkipIntroButtonSeconds: 'Intro überspringen-Button anzeigen, Sek',
            showSkipIntroButtonSecondsTooltip: 'Wie lange (in Sekunden) der Intro überspringen-Button nach dem Laden sichtbar bleibt',
            highlightVisitedEpisodes: 'Besuchte Episoden hervorheben',
            highlightVisitedEpisodesTooltip: 'Hebt zuvor besuchte Episodenlinks gelb hervor, damit Sie leicht erkennen können, welche Episoden Sie bereits geöffnet haben',
            preloadOtherProviders: 'Andere Anbieter vorladen*',
            preloadOtherProvidersTooltip: 'Ob das Skript versuchen soll, Anbieter zu integrieren, die nicht standardmäßig integriert sind. Kann die Netzwerknutzung beeinträchtigen. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            playOnIntroSkip: 'Bei Intro-Skip abspielen',
            playOnIntroSkipTooltip: 'Intro-Skip startet auch die Wiedergabe',
            showDeviceSpecificSettings: 'Gerätespezifische Einstellungen anzeigen*',
            showDeviceSpecificSettingsTooltip: 'Einstellungen anzeigen, die auf Ihrem Gerät normalerweise keine Verwendung haben. Wenn Sie beispielsweise auf einem Mobilgerät sind, sind die Hotkey-Einstellungen standardmäßig ausgeblendet, da auf Mobilgeräten keine PC-Tastatur vorhanden ist. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            doubleTapTimingThreshold: 'Doppeltipp-Timing-Schwelle, ms*',
            doubleTapTimingThresholdTooltip: 'Passt die maximale Zeit (in Millisekunden) an, die zwischen zwei Tipps erlaubt ist, damit sie als Doppeltipp erkannt werden. Ein niedrigerer Wert erfordert schnellere Tipps, während ein höherer Wert mehr Verzögerung zulässt. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            doubleTapDistanceThreshold: 'Doppeltipp-Distanzschwelle, px*',
            doubleTapDistanceThresholdTooltip: 'Definiert die maximale Entfernung (in Pixeln) zwischen zwei Tipps, damit sie als Doppeltipp betrachtet werden. Ein kleinerer Wert erfordert, dass die Tipps näher beieinander liegen, während ein größerer Wert mehr Abstand zulässt. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            introSkipCooldown: 'Intro-Skip-Abklingzeit, ms*',
            introSkipCooldownTooltip: 'Abklingzeit für einen Intro-Skip-Hotkey, um einen versehentlichen Doppelskip zu verhindern. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            useAniSkip: 'AniSkip-API verwenden',
            useAniSkipTooltip: 'Intro-Zeiten automatisch von der AniSkip-API abrufen für genaues Intro-Überspringen. Fällt auf manuelle Intro-Skip-Größe zurück, wenn keine Daten gefunden werden.',
            showAniSkipNotifications: 'AniSkip-Benachrichtigungen anzeigen',
            showAniSkipNotificationsTooltip: 'Benachrichtigungen anzeigen, wenn AniSkip-Daten gefunden werden oder beim Überspringen von Intro/Outro mit AniSkip-Zeiten.',
            autoSkipIntro: 'Intro automatisch überspringen',
            autoSkipIntroTooltip: 'Intro automatisch überspringen, wenn es startet (verwendet AniSkip-Timing wenn verfügbar, sonst manuelle Intro-Skip-Größe).',
            aniSkipNoIntroFound: 'AniSkip: Kein Intro-Zeitstempel gefunden',
            submitToAniSkip: 'An AniSkip senden',
            submitIntroTimes: 'Intro-Zeiten einreichen',
            submitIntroTimesDesc: 'Hilf der Community, indem du Intro-Zeitstempel für diese Episode einreichst!',
            introStartTime: 'Intro-Start (Sekunden)',
            introEndTime: 'Intro-Ende (Sekunden)',
            submitButton: 'Absenden',
            cancelButton: 'Abbrechen',
            submittingToAniSkip: 'Wird an AniSkip gesendet...',
            submitSuccess: 'Erfolgreich eingereicht! Danke für deinen Beitrag!',
            submitError: 'Fehler beim Senden. Bitte versuche es erneut.',
            invalidTimes: 'Ungültige Zeiten. Ende muss größer als Start sein.',
            aniSkipFetchSuccess: 'AniSkip: Erkannte Zeiten werden verwendet',
            aniSkipFetchFailed: 'AniSkip: Keine Daten gefunden, Fallback wird verwendet',
            aniSkipIntroDetected: 'Intro via AniSkip erkannt',
            aniSkipOutroDetected: 'Outro via AniSkip erkannt',
            usingFallbackTimes: 'Manuelle Skip-Zeiten werden verwendet',
            playbackPositionExpiration: 'Ablauf der Wiedergabeposition',
            playbackPositionExpirationTooltip: 'Wie viele TAGE müssen vergehen, bevor eine Wiedergabeposition aus dem Speicher entfernt wird',
            corsProxy: 'CORS-Proxy',
            corsProxyTooltip: 'Um ein mögliches VOE-zu-VOE ungestummtes Autoplay zu ermöglichen, muss das Skript eine sehr kleine Anzahl von Webanfragen über einen eigenen Proxyserver leiten. Lassen Sie das Eingabefeld leer, um dies zu deaktivieren oder Ihren eigenen Proxy festzulegen',
            commlinkPollingInterval: 'Commlink-Abfrageintervall, ms*',
            commlinkPollingIntervalTooltip: 'Spiegelt die Reaktionsfähigkeit der Nachrichtenübertragung zwischen einem Player und einem Top-Scope wider. Kann die CPU-Auslastung beeinträchtigen, wenn sie zu niedrig eingestellt ist. 40 sollten ausreichen. Ein Neuladen der Seite ist für diese Einstellung erforderlich!',
            skipIntro: 'Intro überspringen',
            autoplayEnabled: 'Autoplay ist aktiviert',
            autoplayDisabled: 'Autoplay ist deaktiviert'
        }
    };

    const i18n = localizations[userLang];

    // ============================================
    // SHARED THEME SYSTEM
    // ============================================
    // Default settings layout
const DEFAULT_SETTINGS_LAYOUT = {
  prefs: ['autoSkip', 'skip', 'defaults', 'display', 'aniskip'],
  adv: ['timing', 'behavior', 'playback', 'appearance', 'network', 'hotkeys']
};

    const BUILT_IN_THEMES = {
        classic: {
            name: 'Classic',
            builtIn: true,
            vars: {
                bgPrimary: 'rgba(10,10,15,1)',
                bgSecondary: 'rgba(18,18,26,1)',
                bgTertiary: 'rgba(26,26,37,1)',
                bgHover: 'rgba(255,255,255,0.02)',
                accentPrimary: 'rgba(255,51,102,1)',
                accentSecondary: 'rgba(124,58,237,1)',
                accentGlow: 'rgba(255,51,102,0.4)',
                accentGreen: 'rgba(34,197,94,1)',
                textPrimary: 'rgba(240,240,245,1)',
                textSecondary: 'rgba(160,160,184,1)',
                textMuted: 'rgba(144,144,168,1)',
                borderColor: 'rgba(255,255,255,0.06)',
                borderLight: 'rgba(255,255,255,0.1)',
                borderRadius: '16px',
                fontFamily: "'Space Grotesk', -apple-system, sans-serif",
                // Header colors
                headerBg: 'rgba(18,18,26,1)',
                headerText: 'rgba(240,240,245,1)',
                headerAccent1: 'rgba(255,51,102,1)',
                headerAccent2: 'rgba(68,173,243,1)',
                headerTag: 'rgba(144,144,168,1)',
                logoBg: 'rgba(255,51,102,1)',
                logoText: 'rgba(255,255,255,1)',
                // Submit button colors
                submitBtnBg1: 'rgba(255,51,102,1)',
                submitBtnBg2: 'rgba(124,58,237,1)',
                submitBtnText: 'rgba(255,255,255,1)'
            },
            settingsLayout: DEFAULT_SETTINGS_LAYOUT
        },
        aniworld: {
            name: 'AniWorld',
            builtIn: true,
            vars: {
                bgPrimary: 'rgba(18,28,34,1)',
                bgSecondary: 'rgba(26,42,51,1)',
                bgTertiary: 'rgba(36,55,67,1)',
                bgHover: 'rgba(45,68,79,1)',
                accentPrimary: 'rgba(99,124,249,1)',
                accentSecondary: 'rgba(99,124,249,1)',
                accentGlow: 'rgba(99,124,249,0.3)',
                accentGreen: 'rgba(99,208,43,1)',
                textPrimary: 'rgba(232,232,232,1)',
                textSecondary: 'rgba(192,212,222,1)',
                textMuted: 'rgba(168,192,204,1)',
                borderColor: 'rgba(45,68,79,1)',
                borderLight: 'rgba(58,85,101,1)',
                borderRadius: '12px',
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
                // Header colors
                headerBg: 'rgba(26,42,51,1)',
                headerText: 'rgba(232,232,232,1)',
                headerAccent1: 'rgba(99,124,249,1)',
                headerAccent2: 'rgba(68,173,243,1)',
                headerTag: 'rgba(168,192,204,1)',
                logoBg: 'rgba(99,124,249,1)',
                logoText: 'rgba(255,255,255,1)',
                // Submit button colors
                submitBtnBg1: 'rgba(99,124,249,1)',
                submitBtnBg2: 'rgba(139,92,246,1)',
                submitBtnText: 'rgba(255,255,255,1)'
            },
            settingsLayout: DEFAULT_SETTINGS_LAYOUT
        },
        yellow: {
            name: 'Yellow',
            builtIn: true,
            vars: {
                bgPrimary: 'rgba(45,42,46,1)',
                bgSecondary: 'rgba(34,31,34,1)',
                bgTertiary: 'rgba(64,62,65,1)',
                bgHover: 'rgba(91,89,92,1)',
                accentPrimary: 'rgba(255,216,102,1)',
                accentSecondary: 'rgba(252,152,103,1)',
                accentGlow: 'rgba(255,216,102,0.3)',
                accentGreen: 'rgba(169,220,118,1)',
                textPrimary: 'rgba(252,252,250,1)',
                textSecondary: 'rgba(193,192,192,1)',
                textMuted: 'rgba(147,146,147,1)',
                borderColor: 'rgba(64,62,65,1)',
                borderLight: 'rgba(91,89,92,1)',
                borderRadius: '8px',
                fontFamily: "'JetBrains Mono', monospace, sans-serif",
                // Header colors
                headerBg: 'rgba(34,31,34,1)',
                headerText: 'rgba(252,252,250,1)',
                headerAccent1: 'rgba(255,216,102,1)',
                headerAccent2: 'rgba(252,152,103,1)',
                headerTag: 'rgba(147,146,147,1)',
                logoBg: 'rgba(255,216,102,1)',
                logoText: 'rgba(45,42,46,1)',
                // Submit button colors
                submitBtnBg1: 'rgba(255,216,102,1)',
                submitBtnBg2: 'rgba(252,152,103,1)',
                submitBtnText: 'rgba(45,42,46,1)'
            },
            settingsLayout: DEFAULT_SETTINGS_LAYOUT
        }
    };

    // Get custom themes from storage
    const getCustomThemes = () => {
        try {
            return JSON.parse(GM_getValue('customThemes') || '{}');
        } catch {
            return {};
        }
    };

    // Save custom themes to storage
    const saveCustomThemes = (themes) => {
        GM_setValue('customThemes', JSON.stringify(themes));
    };

    // Get all themes (built-in + custom)
    const getAllThemes = () => {
        return { ...BUILT_IN_THEMES, ...getCustomThemes() };
    };

    // Get current theme variables (with fallback to classic)
    const getCurrentThemeVars = () => {
        const savedTheme = GM_getValue('uiTheme') || 'classic';
        const allThemes = getAllThemes();
        const theme = allThemes[savedTheme];
        // Fallback to classic if theme not found
        return theme?.vars || BUILT_IN_THEMES.classic.vars;
    };

    // Domains list the script should work for
    const TOP_SCOPE_DOMAINS = [
        'aniworld.to',
        's.to',
        'serienstream.to',
        '186.2.175.5',
    ];

    // S.to related domains (all use the new layout)
    const STO_DOMAINS = [
        's.to',
        'serienstream.to',
        '186.2.175.5',
    ];

    // Helper to detect if we're on the new S.to layout
    const isNewStoLayout = () => {
        return STO_DOMAINS.includes(location.hostname) && !!document.querySelector('#player-iframe');
    };

    // Needed for proper tracking of position memory
    const TOP_SCOPE_DOMAINS_IDS = {
        'aniworld.to': 'aniworld',
        's.to': 'sto',
        'serienstream.to': 'sto',
        '186.2.175.5': 'sto',
    };

    // Names should be the exact same as in the providers list of the website
    const VIDEO_PROVIDERS_MAP = {
        Vidmoly: 'Vidmoly',
        Vidoza: 'Vidoza',
        VOE: 'VOE',
    };
    const VIDEO_PROVIDERS_IDS = {
        '1': VIDEO_PROVIDERS_MAP.VOE,
        '3': VIDEO_PROVIDERS_MAP.Vidoza,
        '5': VIDEO_PROVIDERS_MAP.Vidmoly,
    };
    // Providers supported by the script, ordered by a default priority
    const VIDEO_PROVIDERS_DEFAULT_ORDER = [
        VIDEO_PROVIDERS_MAP.VOE,
        VIDEO_PROVIDERS_MAP.Vidmoly,
        VIDEO_PROVIDERS_MAP.Vidoza,
    ];
    const CORE_SETTINGS_MAP = {
        currentLargeSkipSizeS: 'currentLargeSkipSizeS',
        currentOutroSkipThresholdS: 'currentOutroSkipThresholdS',
        isAutoplayEnabled: 'isAutoplayEnabled',
        isMuted: 'isMuted',
        shouldAutoSkipOnStart: 'shouldAutoSkipOnStart',
        autoSkipSecondsOnStart: 'autoSkipSecondsOnStart',
        persistentVolumeLvl: 'persistentVolumeLvl',
        providersPriority: 'providersPriority',
        videoLanguagePreferredID: 'videoLanguagePreferredID',
        autoSkipIntro: 'autoSkipIntro',
    };
    // Note that defaults are applied only on a very first run of the script
    const CORE_SETTINGS_DEFAULTS = {
        // Default value doesn't matter because it fallbacks to
        // ADVANCED_SETTINGS_DEFAULTS.defaultLargeSkipSizeS anyway
        [CORE_SETTINGS_MAP.currentLargeSkipSizeS]: 87,
        [CORE_SETTINGS_MAP.currentOutroSkipThresholdS]: 90, // same logic
        [CORE_SETTINGS_MAP.shouldAutoSkipOnStart]: true,
        [CORE_SETTINGS_MAP.autoSkipSecondsOnStart]: 0,
        [CORE_SETTINGS_MAP.isAutoplayEnabled]: false,
        [CORE_SETTINGS_MAP.isMuted]: false,
        [CORE_SETTINGS_MAP.persistentVolumeLvl]: 0.5,
        [CORE_SETTINGS_MAP.providersPriority]: (
            VIDEO_PROVIDERS_DEFAULT_ORDER.map(name => Object.keys(VIDEO_PROVIDERS_IDS).find(
                key => VIDEO_PROVIDERS_IDS[key] === name
            ))
        ),
        [CORE_SETTINGS_MAP.videoLanguagePreferredID]: '1',
        [CORE_SETTINGS_MAP.autoSkipIntro]: true,
    };
    const HOTKEYS_SETTINGS_MAP = {
        fastBackward: 'fastBackward',
        fastForward: 'fastForward',
        fullscreen: 'fullscreen',
        largeSkip: 'largeSkip',
    };
    // Note that defaults are applied only on a very first run of the script
    const HOTKEYS_SETTINGS_DEFAULTS = {
        [HOTKEYS_SETTINGS_MAP.fastBackward]: 'left',
        [HOTKEYS_SETTINGS_MAP.fastForward]: 'right',
        [HOTKEYS_SETTINGS_MAP.fullscreen]: 'f',
        [HOTKEYS_SETTINGS_MAP.largeSkip]: 'v',
    };
    const MAIN_SETTINGS_MAP = {
        highlightVisitedEpisodes: 'highlightVisitedEpisodes',
        overrideDoubletapBehavior: 'overrideDoubletapBehavior',
        playbackPositionMemory: 'playbackPositionMemory',
        shouldAutoplayMuted: 'shouldAutoplayMuted',
    };
    // Note that defaults are applied only on a very first run of the script
    const MAIN_SETTINGS_DEFAULTS = {
        [MAIN_SETTINGS_MAP.highlightVisitedEpisodes]: true,
        [MAIN_SETTINGS_MAP.overrideDoubletapBehavior]: true,
        [MAIN_SETTINGS_MAP.playbackPositionMemory]: true,
        [MAIN_SETTINGS_MAP.shouldAutoplayMuted]: true,
    };
    const ADVANCED_SETTINGS_MAP = {
        commlinkPollingIntervalMs: 'commlinkPollingIntervalMs',
        corsProxy: 'corsProxy',
        defaultLargeSkipSizeS: 'defaultLargeSkipSizeS',
        defaultOutroSkipThresholdS: 'defaultOutroSkipThresholdS',
        doubletapDistanceThresholdPx: 'doubletapDistanceThresholdPx',
        doubletapTimingThresholdMs: 'doubletapTimingThresholdMs',
        fastForwardSizeS: 'fastForwardSizeS',
        largeSkipCooldownMs: 'largeSkipCooldownMs',
        markWatchedAfterS: 'markWatchedAfterS',
        playOnLargeSkip: 'playOnLargeSkip',
        playbackPositionExpirationDays: 'playbackPositionExpirationDays',
        preloadOtherProviders: 'preloadOtherProviders',
        showSkipIntroButton: 'showSkipIntroButton',
        showSkipIntroButtonSeconds: 'showSkipIntroButtonSeconds',
        showDeviceSpecificSettings: 'showDeviceSpecificSettings',
        useAniSkip: 'useAniSkip',
        showAniSkipNotifications: 'showAniSkipNotifications',
    };
    // Note that defaults are applied only on a very first run of the script
    const ADVANCED_SETTINGS_DEFAULTS = {
        [ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs]: 40,
        [ADVANCED_SETTINGS_MAP.corsProxy]: 'https://aniworld-to-cors-proxy.fly.dev/',
        [ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS]: 87,
        [ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS]: 90,
        [ADVANCED_SETTINGS_MAP.doubletapDistanceThresholdPx]: 50,
        [ADVANCED_SETTINGS_MAP.doubletapTimingThresholdMs]: 300,
        [ADVANCED_SETTINGS_MAP.fastForwardSizeS]: 10,
        [ADVANCED_SETTINGS_MAP.largeSkipCooldownMs]: 300,
        [ADVANCED_SETTINGS_MAP.markWatchedAfterS]: 0,
        [ADVANCED_SETTINGS_MAP.playOnLargeSkip]: true,
        [ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays]: 30,
        [ADVANCED_SETTINGS_MAP.preloadOtherProviders]: true,
        [ADVANCED_SETTINGS_MAP.showSkipIntroButton]: true,
        [ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds]: 240,
        [ADVANCED_SETTINGS_MAP.showDeviceSpecificSettings]: false,
        [ADVANCED_SETTINGS_MAP.useAniSkip]: true,
        [ADVANCED_SETTINGS_MAP.showAniSkipNotifications]: true,
    };
    const IS_MOBILE = (
        /Mobi|Android|iP(hone|[oa]d)/i.test(navigator.userAgent)
    );
    const IS_SAFARI = (
        navigator.userAgent.indexOf('Safari') > -1 && !/Chrome|CriOS/.test(navigator.userAgent)
    );
    // Can not handle nested objects
    class DataStore {
        constructor(uuid, defaultStorage = {}) {
            if (typeof uuid !== 'string' && typeof uuid !== 'number') {
                throw new Error('Expected uuid when creating DataStore');
            }

            this.__uuid = uuid;
            this.__storage = defaultStorage;
            try {
                this.__storage = JSON.parse(GM_getValue(uuid));
            } catch {
                GM_setValue(uuid, JSON.stringify(defaultStorage));
            }

            return new Proxy(this, {
                get: (obj, prop) => {
                    if (prop === 'destroy') return () => obj.__destroy();
                    if (prop === 'update') return updates => obj.__update(updates);

                    return obj.__storage[prop];
                },

                set: (obj, prop, value) => {
                    obj.__storage[prop] = value;
                    GM_setValue(obj.__uuid, JSON.stringify(obj.__storage));

                    return true;
                }
            });
        }

        __update(updates) {
            if (updates) {
                Object.assign(this.__storage, updates);
                GM_setValue(this.__uuid, JSON.stringify(this.__storage));
            } else {
                try {
                    this.__storage = JSON.parse(GM_getValue(this.__uuid)) || {};
                } catch {
                    this.__storage = {};
                }
            }
        }

        __destroy() {
            GM_deleteValue(this.__uuid);
            this.__storage = {};
        }
    }

    const advancedSettings = new DataStore('advancedSettings', ADVANCED_SETTINGS_DEFAULTS);
    const coreSettings = new DataStore('coreSettings', CORE_SETTINGS_DEFAULTS);
    const hotkeysSettings = new DataStore('hotkeysSettings', HOTKEYS_SETTINGS_DEFAULTS);
    const mainSettings = new DataStore('mainSettings', MAIN_SETTINGS_DEFAULTS);
    [
        [advancedSettings, ADVANCED_SETTINGS_DEFAULTS],
        [coreSettings, CORE_SETTINGS_DEFAULTS],
        [hotkeysSettings, HOTKEYS_SETTINGS_DEFAULTS],
        [mainSettings, MAIN_SETTINGS_DEFAULTS]
    ].forEach(([settings, defaults]) => {
        Object.entries(defaults).forEach(([key, value]) => (settings[key] ??= value));
    });
    if (
        Object.keys(VIDEO_PROVIDERS_IDS).sort().toString() !== [...coreSettings[CORE_SETTINGS_MAP.providersPriority]].sort().toString()
    ) {
        coreSettings[CORE_SETTINGS_MAP.providersPriority] = [
            ...CORE_SETTINGS_DEFAULTS[CORE_SETTINGS_MAP.providersPriority]
        ];
    }

    // -------------------------------------- /utils ---------------------------------------------

    const Notiflixx = (() => {
        GM_addStyle(`
  [id^=NotiflixBlockWrap], [id^=NotiflixConfirmWrap],
  [id^=NotiflixLoadingWrap], [id^=NotiflixNotifyWrap],
  [id^=NotiflixReportWrap] {
    -webkit-tap-highlight-color: #24242412;
  }

  div.notiflix-report-icon {
    width: 60px !important;
    height: 60px !important;
  }

  div.notiflix-report-content {
    max-width: 1010px !important;
    width: unset !important;
  }


  .notiflix-hotkeys-guide-modal {
    max-height: 70vh;
    overflow-y: auto;
    padding: 0 15px;
  }

  .notiflix-hotkeys-guide-modal h5 {
    font-size: 19px;
    margin: 25px 0 10px 0;
  }

  .notiflix-hotkeys-guide-modal h5:first-child {
    margin: 0 0 10px 0;
  }

  .notiflix-hotkeys-guide-modal div {
    color: black;
    margin-bottom: 5px;
  }

  .notiflix-hotkeys-guide-modal pre {
    background: #243743;
    border: none;
    display: inline-block;
    margin: 1px 0 1px 0;
    padding: 4px 8px;
    vertical-align: middle;
  }
  `);
        const notifyDefaultOptions = {
            closeButton: true,
            messageMaxLength: 500,
            plainText: false,
            position: 'left-top',
            zindex: 3222222,
        };
        const reportDefaultOptions = {
            titleMaxLength: 100,
            zindex: 3222223,
        };
        const disableBodyScroll = () => {
            // Order is important here
            document.body.style.paddingRight = (
                `${window.innerWidth - document.documentElement.clientWidth}px`
            );
            document.body.style.overflow = 'hidden';
        };

        const restoreBodyScroll = () => {
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        };

        const createNotifyHandler = (notifyType) => {
            return (message, customOptions = {}) => {
                Notiflix.Notify[notifyType](message, {
                    ...notifyDefaultOptions,
                    ...customOptions,
                });
            };
        };

        const createReportHandler = (reportType) => {
            return (titleText, messageText, btnText, customOptions = {}) => {
                disableBodyScroll();
                Notiflix.Report[reportType](titleText, messageText, btnText, () => {
                    restoreBodyScroll();
                }, {
                    ...reportDefaultOptions,
                    ...customOptions,
                });
                if (customOptions.backOverlayClickToClose) {
                    const backOverlay = document.querySelector(
                        '[id^=NotiflixReportWrap] > div[class*="-overlay"]'
                    );
                    backOverlay?.addEventListener('click', () => restoreBodyScroll());
                }

                if (customOptions.delayedButton) {
                    const closeBtn = document.querySelector('a#NXReportButton');
                    closeBtn.style.background = '#b2b2b2';
                    closeBtn.style.pointerEvents = 'none';

                    setTimeout(() => {
                        closeBtn.style.background = '#26c0d3';
                        closeBtn.style.pointerEvents = '';
                    }, 2000);
                }
            };
        };
        return {
            notify: {
                failure: createNotifyHandler('failure'),
                warning: createNotifyHandler('warning'),
            },

            report: {
                info: createReportHandler('info'),
                warning: createReportHandler('warning'),
            },
        };
    })();

    waitForElement('.inSiteWebStream', {
        existing: true
    }, function(container) {
        (function() {
            'use strict';

            const heightMap = {
                Vidmoly: '600px',
                Luluvdo: '480px',
                Filemoon: '480px'
            };
            let vidmolyIframe = null;
            let vidmolyUrl = null;
            let vidmolyReady = false;

            function log(...args) {
                console.log('%c[🔥 SmartLoader]', 'color: lime;', ...args);
            }

            function spoofVidmolyEnv() {
                window.adsbygoogle = window.adsbygoogle || [];
                window.vsd1 = {
                    skip: true,
                    adblock: true
                };
                document.cookie = 'molyast21=1; path=/; domain=.vidmoly.to';

                const patch = document.createElement('script');
                patch.src = chrome.runtime.getURL('src/vidmoly-patch.js');
                document.body.appendChild(patch);
            }

            function showLoader(type) {
                const old = document.querySelector('#loadingMessage');
                if (old) old.remove();
                const msg = document.createElement('div');
                msg.id = 'loadingMessage';
                msg.innerText = `⏳ ${i18n.loading} ${type}...`;
                Object.assign(msg.style, {
                    background: '#111',
                    color: '#fff',
                    fontFamily: 'sans-serif',
                    padding: '20px',
                    textAlign: 'center'
                });
                container.innerHTML = '';
                container.appendChild(msg);
            }

            function clearLoader() {
                const l = document.querySelector('#loadingMessage');
                if (l) l.remove();
            }

            function buildIframe(src, type) {
                const iframe = document.createElement('iframe');
                iframe.src = src;
                iframe.allowFullscreen = true;
                iframe.frameBorder = '0';
                iframe.width = '100%';
                iframe.height = heightMap[type] || '500px';
                Object.assign(iframe.style, {
                    display: 'block',
                    border: 'none',
                    position: 'relative',
                    margin: '0 auto'
                });
                return iframe;
            }

            function injectJWplayer(iframe) {
                try {
                    const win = iframe.contentWindow;
                    const tryInject = setInterval(() => {
                        try {
                            const player = win?.jwplayer?.();
                            if (player && typeof player.play === 'function') {
                                player.play();
                                clearInterval(tryInject);
                                log('▶️ JWPlayer play() called inside iframe');
                            }
                        } catch {}
                    }, 500);
                } catch (err) {
                    log('❌ JW inject failed:', err);
                }
            }

            function embedVidmoly() {
                if (!vidmolyReady || !vidmolyIframe || !vidmolyUrl) {
                    alert(i18n.vidmolyNotReady);
                    return;
                }
                container.innerHTML = '';
                const realIframe = buildIframe(vidmolyUrl, 'Vidmoly');
                container.appendChild(realIframe);
                injectJWplayer(realIframe);
            }

            function embedGeneric(url, type, attempt = 1) {
                showLoader(type);
                const iframe = buildIframe(url, type);
                container.innerHTML = '';
                container.appendChild(iframe);

                const timeout = setTimeout(() => {
                    if (!iframe.dataset.loaded && attempt < 2) {
                        log(`🔁 Retrying ${type}...`);
                        return setTimeout(() => embedGeneric(url, type, attempt + 1), 1000);
                    } else if (!iframe.dataset.loaded) {
                        clearLoader();
                        window.open(url, '_blank');
                    }
                }, 8000);

                iframe.onload = () => {
                    clearTimeout(timeout);
                    iframe.dataset.loaded = 'true';
                    clearLoader();
                    log(`✅ ${type} loaded`);
                };
            }

            async function preloadVidmoly(url) {
                spoofVidmolyEnv();
                vidmolyIframe = document.createElement('iframe');
                vidmolyIframe.src = url;
                vidmolyIframe.allowFullscreen = true;
                vidmolyIframe.frameBorder = '0';
                vidmolyIframe.width = '100%';
                vidmolyIframe.height = heightMap.Vidmoly;
                vidmolyIframe.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;';
                vidmolyIframe.onload = () => {
                    vidmolyReady = true;
                    log('✅ Vidmoly iframe preloaded.');
                };
                document.body.appendChild(vidmolyIframe);
            }

            async function detectVidmoly() {
                spoofVidmolyEnv();
                const anchor = [...document.querySelectorAll('a.watchEpisode')].find(a => {
                    return a.querySelector('i.icon.Vidmoly');
                });
                const href = anchor?.getAttribute('href');
                if (!href) return;

                const url = new URL(href, location.origin);
                vidmolyUrl = url.href;
                await preloadVidmoly(vidmolyUrl);
            }

            advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders] &&
                document.addEventListener('click', async function(e) {
                    const anchor = e.target.closest('a.watchEpisode');
                    if (!anchor) return;
                    const text =
                        anchor.innerText.toLowerCase();
                    const isVid = text.includes('vidmoly');
                    const isLulu = text.includes('luluvdo');
                    const isMoon = text.includes('filemoon');
                    if (!isVid && !isLulu && !isMoon) return;

                    e.preventDefault();
                    const href = anchor.getAttribute('href');
                    const type = isVid ? 'Vidmoly' : isLulu ? 'Luluvdo' : 'Filemoon';

                    const fullUrl = new URL(href, location.origin).href;
                    try {
                        if (type === 'Filemoon' && fullUrl.includes('/d/')) {
                            return embedGeneric(fullUrl.replace('/d/', '/e/'), type);
                        }
                        if (type === 'Vidmoly') {
                            vidmolyUrl = fullUrl;
                            return embedVidmoly();
                        }
                        return embedGeneric(fullUrl, type);
                    } catch (err) {
                        console.warn('❌ Failed to load:', err);
                        alert(`${i18n.couldNotLoad} ${type}`);
                    }
                });

            function waitForElement(selector, opts = {}, cb) {
                const {
                    interval = 50, timeout = 10000
                } = opts;
                const start = Date.now();
                const timer = setInterval(() => {
                    const el = document.querySelector(selector);
                    if (el) {
                        clearInterval(timer);
                        cb(el);
                    } else if (Date.now() - start > timeout) {
                        clearInterval(timer);
                        console.warn(`[SmartLoader] ❌ Timed out waiting for ${selector}`);
                    }
                }, interval);
            }

            // wait until .watchEpisode buttons are loaded
            advancedSettings[ADVANCED_SETTINGS_MAP.preloadOtherProviders] &&
                waitForElement('a.watchEpisode i.icon.Vidmoly', {
                    timeout: 10000
                }, () => {
                    log('🧠 Vidmoly <a> tag detected, calling detectVidmoly()');
                    detectVidmoly();
                });
            //  this will now run after .inSiteWebStream is ready!
            async function checkIframeForLoadXWarning() {
                const iframe = document.querySelector('.inSiteWebStream iframe');
                if (!iframe || !iframe.src) {
                    setTimeout(checkIframeForLoadXWarning, 1000);
                    return;
                }

                const proxyUrl = `https://aniworld-to-cors-proxy.fly.dev/${iframe.src.replace(/^\/+/, '')}`;
                try {
                    const response = await fetch(proxyUrl);
                    const html = await response.text();

                    const hasWarning = html.includes('<h1>Warning</h1>') && html.includes('The video is not ready yet.');
                    const has404 = html.includes('<h1>404</h1>') || html.toLowerCase().includes('no video found');

                    if (!(hasWarning || has404)) return;
                    let providerOrder = ['0', '1', '2', '3', '4'];
                    try {
                        const raw = await GM.getValue('coreSettings');
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            const dynamicOrder = parsed?.providersPriority;
                            if (Array.isArray(dynamicOrder) && dynamicOrder.length > 0) {
                                providerOrder = dynamicOrder;
                            }
                        }
                    } catch {}

                    const loadXIndex = providerOrder.indexOf('0');
                    if (loadXIndex === -1) return;

                    for (let i = loadXIndex + 1; i < providerOrder.length; i++) {
                        const providerId = providerOrder[i];
                        const providerName = getHosterName(providerId);

                        const button = [...document.querySelectorAll('a.watchEpisode')]
                            .find(a => a.href.includes('/redirect/') && a.innerText.includes(providerName))
                            ?.querySelector('.hosterSiteVideoButton');
                        if (button) {
                            button.click();
                            await new Promise(resolve => setTimeout(resolve, 3000));

                            const iframe = document.querySelector('.inSiteWebStream iframe');
                            if (!iframe || !iframe.src) continue;
                            const proxyUrl = `https://aniworld-to-cors-proxy.fly.dev/${iframe.src.replace(/^\/+/, '')}`;
                            const response = await fetch(proxyUrl);
                            const html = await response.text();
                            const hasWarning = html.includes('<h1>Warning</h1>') && html.includes('The video is not ready yet.');
                            const has404 = html.includes('<h1>404</h1>') || html.toLowerCase().includes('no video found');
                            if (!hasWarning && !has404) {
                                return;
                            }
                        }
                    }

                } catch {}
            }

            function getHosterName(id) {
                const map = {
                    '0': 'LoadX',
                    '1': 'VOE',
                    '2': 'SpeedFiles',
                    '3': 'Vidoza',
                    '4': 'Doodstream'
                };
                return map[id] || 'Unknown';
            }

            setTimeout(checkIframeForLoadXWarning, 150);

        })();
    });
    // Prevent volume scroll on player, allow page scroll, but still allow volume control
    window.addEventListener('wheel', function(e) {
        const volumeBar = e.target.closest('.vjs-volume-bar');
        const volumeIcon = e.target.closest('.vjs-mute-control');
        const playerWrapper = e.target.closest('.video-js');


        if ((volumeBar || volumeIcon)) return;

        if (playerWrapper) {
            e.stopImmediatePropagation();
        }
    }, {
        passive: false,
        capture: true
    });

    function detectDoubletap(element, callback, {
        maxIntervalMs = 300,
        tapsDistanceThresholdPx = 50,
        validPointerTypes = ['pen', 'touch'],
    } = {
        maxIntervalMs: 300,
        tapsDistanceThresholdPx: 50,
        validPointerTypes: ['pen', 'touch'],
    }) {
        let lastTapTime = 0;
        let lastTapX = 0;
        let lastTapY = 0;
        let tapped = false;
        element.addEventListener('pointerdown', (ev) => {
            if (!validPointerTypes.includes(ev.pointerType)) return;

            const currentTime = Date.now();
            const tapInterval = currentTime - lastTapTime;

            const distance = Math.sqrt(
                Math.pow(ev.clientX - lastTapX, 2) +
                Math.pow(ev.clientY - lastTapY, 2)
            );

            if (
                tapped &&
                tapInterval < maxIntervalMs &&
                distance <= tapsDistanceThresholdPx
            ) {
                callback(ev);
                tapped = false;
                lastTapTime = 0;
                lastTapX = 0;
                lastTapY = 0;
            } else {
                tapped = true;
                lastTapTime = currentTime;
                lastTapX = ev.clientX;
                lastTapY = ev.clientY;
            }
        });
    }

    function detectHold(element, callback, {
        holdTimeMs = 700,
        validPointerTypes = ['mouse', 'pen', 'touch'],
    } = {
        holdTimeMs: 700,
        validPointerTypes: ['mouse', 'pen', 'touch'],
    }) {
        let timer;
        const clearHold = () => clearTimeout(timer);
        const startHold = (ev) => {
            if (validPointerTypes.includes(ev.pointerType)) {
                timer = setTimeout(() => callback(), holdTimeMs);
            }
        };

        element.addEventListener('pointerdown', startHold);
        element.addEventListener('pointerup', clearHold);
        element.addEventListener('pointercancel', clearHold);
        element.addEventListener('pointerout', clearHold);
        element.addEventListener('pointerleave', clearHold);
    }

    function isEmbedded() {
        try {
            return window.top !== window.self;
        } catch {
            return true;
        }
    }

    function isNumeric(n) {
        return !isNaN(parseFloat(n)) && isFinite(n);
    }

    function makeId(length = 16) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';

        for (let i = 0; i < length; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return text;
    }

    async function sleep(ms = 0) {
        return new Promise(r => setTimeout(r, ms));
    }

    // Create "Skip intro" button
    function setupSkipIntroButton(player) {
        const SKIP_BTN_STYLE = `
    .SkipIntroBtn {
      position: fixed;
      bottom: 75px;
      right: 5px;
      padding: 10px;
      font-size: 16px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid gray;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SkipIntroBtn:hover {
      background-color: rgba(0, 0, 0, 1);
    }
    .SkipIntroBtn.invisible {
      opacity: 0;
      pointer-events: none;
    }
    .SubmitToAniSkipBtn {
        position: absolute;
        bottom: 57px;
        right: 80px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        z-index: 9999;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .SubmitToAniSkipBtn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .SubmitToAniSkipBtn.invisible {
        opacity: 0;
        pointer-events: none;
    }
  `;
        const button = document.createElement('button');
        button.className = 'SkipIntroBtn';
        button.textContent = i18n.skipIntro;
        button.addEventListener('click', () => {
            console.log('[Skip Button] Clicked. globalAniSkipData:', globalAniSkipData);

            // Check if we have AniSkip data for intro
            if (globalAniSkipData && globalAniSkipData.intro) {
                // Use AniSkip intro end time
                console.log('[Skip Button] Using AniSkip time:', globalAniSkipData.intro.end);
                player.currentTime = globalAniSkipData.intro.end;
            } else {
                // Fallback to manual skip size
                console.log('[Skip Button] Using fallback skip size:', coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]);
                player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
            }

            if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
                player.play();
            }
            button.remove();
        });
        GM_addStyle(SKIP_BTN_STYLE);

        const insertButton = () => {
            const loadX = document.querySelector('.jw-controlbar');
            const speedFiles = document.querySelector('#my-video');
            const voe = document.querySelector('.jw-controls');

            if (loadX) {
                loadX.appendChild(button);
            } else if (speedFiles || voe) {
                document.body.appendChild(button);
            }
        };

        const observeActivity = (container) => {
            new MutationObserver(() => {
                const isActive = (
                    container.classList.contains('jw-state-paused') ||
                    !container.classList.contains('jw-flag-user-inactive') ||
                    container.classList.contains('vjs-paused') ||
                    !container.classList.contains('vjs-user-inactive')
                );
                if (document.contains(button)) {
                    button.classList.toggle('invisible', !isActive || !advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton]);

                }
            }).observe(container, {
                attributes: true,
                attributeFilter: ['class'],
            });
        };

        waitForElement('.jw-controlbar, #my-video, .jw-controls', {
            existing: true,
            onceOnly: true
        }, insertButton);
        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = !!document.fullscreenElement;
            if (isFullscreen) {
                button.style.bottom = '80px';
            } else {
                button.style.bottom = '57px';
            }
        });


        const activityContainer = (
            document.querySelector('#player') ||
            document.querySelector('#my-video') ||
            document.querySelector('#a')
        );
        if (activityContainer) observeActivity(activityContainer);

        const hideAt = advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButtonSeconds];

        const timeCheckInterval = () => {
            // If we have AniSkip data, show button from start until intro ends
            if (globalAniSkipData && globalAniSkipData.intro) {
                const currentTime = player.currentTime;
                const introEnd = globalAniSkipData.intro.end;

                // Hide button only after intro ends
                if (currentTime >= introEnd) {
                    button.remove();
                    player.removeEventListener('timeupdate', timeCheckInterval);
                }
            } else {
                // Fallback to original time-based logic
                if (player.currentTime >= hideAt) {
                    button.remove();
                    player.removeEventListener('timeupdate', timeCheckInterval);
                }
            }
        };

        player.addEventListener('timeupdate', timeCheckInterval);
    }


    // Create "Skip ED" button — mirrors setupSkipIntroButton but for the outro
    function setupSkipEdButton(player, iframeInterface = null) {
        const ED_BTN_STYLE = `
    .SkipEdBtn {
      position: fixed;
      bottom: 75px;
      right: 5px;
      padding: 10px;
      font-size: 16px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid #ff4444;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SkipEdBtn:hover { background-color: rgba(80, 0, 0, 0.85); }
    .SkipEdBtn.invisible { opacity: 0; pointer-events: none; }
    .SubmitOutroEdBtn {
      position: fixed;
      bottom: 120px;
      right: 5px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid #ff4444;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SubmitOutroEdBtn:hover { background-color: rgba(80, 0, 0, 0.85); }
    .SubmitOutroEdBtn.invisible { opacity: 0; pointer-events: none; }
  `;
        GM_addStyle(ED_BTN_STYLE);

        const button = document.createElement('button');
        button.className = 'SkipEdBtn invisible';
        button.textContent = userLang === 'de' ? 'ED überspringen' : 'Skip ED';

        button.addEventListener('click', () => {
            if (globalAniSkipData && globalAniSkipData.outro) {
                player.currentTime = globalAniSkipData.outro.end;
                if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) player.play();
            }
            button.remove();
        });

        // "Submit Outro" button — shown alongside Skip ED so user can override times
        const submitBtn = document.createElement('button');
        submitBtn.className = 'SubmitOutroEdBtn invisible';
        submitBtn.textContent = userLang === 'de' ? '✎ Outro einreichen' : '✎ Submit Outro';
        submitBtn.addEventListener('click', () => {
            if (iframeInterface) {
                iframeInterface._openSkipTimesDialog(null, iframeInterface.episodeNumber, null, true, 'outro');
            }
        });

        const insertButton = () => {
            const loadX = document.querySelector('.jw-controlbar');
            const speedFiles = document.querySelector('#my-video');
            const voe = document.querySelector('.jw-controls');
            const container = loadX || (speedFiles && document.body) || (voe && document.body);
            if (loadX) {
                loadX.appendChild(button);
                if (iframeInterface) loadX.appendChild(submitBtn);
            } else if (speedFiles || voe) {
                document.body.appendChild(button);
                if (iframeInterface) document.body.appendChild(submitBtn);
            }
        };

        waitForElement('.jw-controlbar, #my-video, .jw-controls', {
            existing: true,
            onceOnly: true
        }, insertButton);

        document.addEventListener('fullscreenchange', () => {
            const fs = document.fullscreenElement;
            button.style.bottom = fs ? '80px' : '57px';
            submitBtn.style.bottom = fs ? '125px' : '102px';
        });

        // Show both buttons when ED is playing, hide when ED ends
        player.addEventListener('timeupdate', () => {
            if (!globalAniSkipData || !globalAniSkipData.outro) return;
            const t = player.currentTime;
            const { start, end } = globalAniSkipData.outro;
            const inEd = t >= start && t < end;
            button.classList.toggle('invisible', !inEd);
            submitBtn.classList.toggle('invisible', !inEd);
            if (t >= end) {
                if (document.contains(button)) button.remove();
                if (document.contains(submitBtn)) submitBtn.remove();
            }
        });
    }

    // Fallback "Skip Outro" button — shown 5 min before end when AniSkip has no outro data.
    // Skips forward 90 s; if that would go past the end, triggers autoplay immediately.
    // Also shows a "Submit Outro" button alongside it so the user can contribute times.
    function setupFallbackOutroSkipButton(player, messenger, iframeInterface = null) {
        const SKIP_DURATION_S = 90;
        const SHOW_BEFORE_END_S = 300; // 5 minutes

        GM_addStyle(`
    .SkipOutroFallbackBtn {
      position: fixed;
      bottom: 75px;
      right: 5px;
      padding: 10px;
      font-size: 16px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid #f5a623;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SkipOutroFallbackBtn:hover { background-color: rgba(80, 50, 0, 0.85); }
    .SkipOutroFallbackBtn.invisible { opacity: 0; pointer-events: none; }
    .SubmitOutroFallbackBtn {
      position: fixed;
      bottom: 120px;
      right: 5px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: bold;
      font-family: sans-serif;
      color: white;
      background-color: rgba(0, 0, 0, 0.55);
      border: 2px solid #f5a623;
      text-transform: uppercase;
      cursor: pointer;
      opacity: 1;
      transition: background-color 130ms, opacity 200ms;
      z-index: 9999;
    }
    .SubmitOutroFallbackBtn:hover { background-color: rgba(80, 50, 0, 0.85); }
    .SubmitOutroFallbackBtn.invisible { opacity: 0; pointer-events: none; }
  `);

        const button = document.createElement('button');
        button.className = 'SkipOutroFallbackBtn invisible';
        button.textContent = userLang === 'de' ? 'Outro überspringen' : 'Skip Outro';

        button.addEventListener('click', () => {
            const newTime = player.currentTime + SKIP_DURATION_S;
            if (!isFinite(player.duration) || newTime >= player.duration) {
                console.log('[Autoplay] Fallback outro skip — past end, firing AUTOPLAY_NEXT');
                messenger.sendMessage(IframeMessenger.messages.AUTOPLAY_NEXT);
            } else {
                console.log(`[Autoplay] Fallback outro skip — jumping to ${newTime.toFixed(1)}s`);
                player.currentTime = newTime;
            }
            button.remove();
        });

        // "Submit Outro" button — shown above the skip button so user can contribute times
        const submitBtn = document.createElement('button');
        submitBtn.className = 'SubmitOutroFallbackBtn invisible';
        submitBtn.textContent = userLang === 'de' ? '↑ Outro einreichen' : '↑ Submit Outro';
        submitBtn.addEventListener('click', () => {
            if (iframeInterface) {
                iframeInterface._openSkipTimesDialog(null, iframeInterface.episodeNumber, null, false, 'outro');
            }
        });

        const insertButton = () => {
            const loadX = document.querySelector('.jw-controlbar');
            const speedFiles = document.querySelector('#my-video');
            const voe = document.querySelector('.jw-controls');
            if (loadX) {
                loadX.appendChild(button);
                if (iframeInterface) loadX.appendChild(submitBtn);
            } else if (speedFiles || voe) {
                document.body.appendChild(button);
                if (iframeInterface) document.body.appendChild(submitBtn);
            }
        };

        waitForElement('.jw-controlbar, #my-video, .jw-controls', {
            existing: true,
            onceOnly: true,
        }, insertButton);

        document.addEventListener('fullscreenchange', () => {
            const fs = document.fullscreenElement;
            button.style.bottom = fs ? '80px' : '57px';
            submitBtn.style.bottom = fs ? '125px' : '102px';
        });

        player.addEventListener('timeupdate', () => {
            // If AniSkip has outro data the proper SkipEdBtn handles it — remove both buttons
            if (globalAniSkipData && globalAniSkipData.outro) {
                button.remove();
                submitBtn.remove();
                return;
            }
            const timeLeft = player.duration - player.currentTime;
            const shouldShow = isFinite(timeLeft) && timeLeft > 0 && timeLeft <= SHOW_BEFORE_END_S;
            button.classList.toggle('invisible', !shouldShow);
            submitBtn.classList.toggle('invisible', !shouldShow);
        });
    }

    // Add visual markers on timeline for intro/outro
    function createSubmitToAniSkipButton(player, iframeInterface) {
        console.log('[Submit Button] Creating submit button');
        const button = document.createElement('button');
        button.className = 'SubmitIntroBtn';
        button.textContent = i18n.submitToAniSkip;

        // Helper to convert MM:SS or SS to seconds
        function timeToSeconds(timeStr) {
            timeStr = String(timeStr).trim();

            // If it contains a colon, it's MM:SS format
            if (timeStr.includes(':')) {
                const parts = timeStr.split(':');
                if (parts.length === 2) {
                    const minutes = parseInt(parts[0]) || 0;
                    const seconds = parseInt(parts[1]) || 0;
                    return minutes * 60 + seconds;
                }
            }

            // Otherwise treat as seconds
            return parseFloat(timeStr) || 0;
        }

        // Helper to format seconds as MM:SS
        function secondsToTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        button.addEventListener('click', async () => {
            console.log('[Submit Button] Clicked');

            // Get current time as suggestion
            const currentTime = Math.floor(player.currentTime);
            const suggestedStart = secondsToTime(currentTime);
            const suggestedEnd = secondsToTime(currentTime + 90);

            // Step 1: Get intro start time
            const startInput = await new Promise((resolve) => {
                Notiflix.Report.prompt(
                    i18n.submitIntroTimes,
                    `${i18n.submitIntroTimesDesc}<br><br>${i18n.introStartTime} (MM:SS or seconds):`,
                    suggestedStart,
                    i18n.submitButton,
                    i18n.cancelButton,
                    (clientAnswer) => resolve(clientAnswer),
                    () => resolve(null)
                );
            });

            if (startInput === null) return;

            const introStart = timeToSeconds(startInput);
            console.log('[Submit Button] Intro start:', startInput, '→', introStart, 'seconds');

            // Step 2: Get intro end time
            const endInput = await new Promise((resolve) => {
                Notiflix.Report.prompt(
                    i18n.submitIntroTimes,
                    `${i18n.introEndTime} (MM:SS or seconds):`,
                    suggestedEnd,
                    i18n.submitButton,
                    i18n.cancelButton,
                    (clientAnswer) => resolve(clientAnswer),
                    () => resolve(null)
                );
            });

            if (endInput === null) return;

            const introEnd = timeToSeconds(endInput);
            console.log('[Submit Button] Intro end:', endInput, '→', introEnd, 'seconds');

            // Validate
            if (!Number.isFinite(introStart) || !Number.isFinite(introEnd) || introEnd <= introStart) {
                Notiflix.Notify.failure(i18n.invalidTimes, {
                    timeout: 3000,
                    position: 'right-bottom'
                });
                return;
            }

            // Get MAL ID
            const malId = await AniSkipModule.getMalId(iframeInterface.animeTitle, iframeInterface.animeSlug);
            if (!malId) {
                Notiflix.Notify.failure('Could not find MAL ID', {
                    timeout: 3000,
                    position: 'right-bottom'
                });
                return;
            }

            const episodeLength = player.duration ? Math.floor(player.duration) : 0;
            if (episodeLength <= 0) {
                Notiflix.Notify.failure(i18n.submitError, { timeout: 4000, position: 'right-bottom' });
                return;
            }

            console.log('[Submit Button] Submitting:', {
                malId,
                episode: iframeInterface.episodeNumber,
                episodeLength,
                introStart,
                introEnd
            });

            // Submit
            Notiflix.Notify.info(i18n.submittingToAniSkip, {
                timeout: 3000,
                position: 'right-bottom'
            });

            const result = await AniSkipModule.submitSkipTimes(
                malId,
                iframeInterface.episodeNumber,
                episodeLength,
                introStart,
                introEnd
            );

            if (result.success) {
                Notiflix.Notify.success(i18n.submitSuccess, {
                    timeout: 5000,
                    position: 'right-bottom'
                });
                // Save locally so skip works immediately without waiting for API cache refresh
                const introData = { start: introStart, end: introEnd };
                AniSkipModule.saveLocalSkipTimes(
                    iframeInterface.animeSlug, iframeInterface.seasonNumber,
                    iframeInterface.episodeNumber, introData, undefined
                );
                if (!globalAniSkipData) globalAniSkipData = {};
                globalAniSkipData.intro = introData;
                button.remove();
            } else {
                Notiflix.Notify.failure(i18n.submitError + (result.error ? `: ${result.error}` : ''), {
                    timeout: 5000,
                    position: 'right-bottom'
                });
            }
        });

        const insertButton = () => {
            const loadX = document.querySelector('.jw-controlbar');
            const speedFiles = document.querySelector('#my-video');
            const voe = document.querySelector('.jw-controls');

            if (loadX) {
                loadX.appendChild(button);
            } else if (speedFiles || voe) {
                document.body.appendChild(button);
            }
        };

        waitForElement('.jw-controlbar, #my-video, .jw-controls', {
            existing: true,
            onceOnly: true
        }, insertButton);

        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = !!document.fullscreenElement;
            if (isFullscreen) {
                button.style.bottom = '153px'; // 80px + 73px for skip button
            } else {
                button.style.bottom = '105px'; // 57px + 48px for skip button
            }
        });
    }

    // Restore PiP on the new episode if it was active during autoplay navigation
    async function restorePipIfNeeded(player) {
        const entry = GM_getValue('aw_pip_restore', null);
        if (!entry) return;

        const age = Date.now() - entry._at;
        if (age > 30000) {
            console.log(`[PiP] Restore flag expired (${age}ms old) — ignoring`);
            GM_deleteValue('aw_pip_restore');
            return;
        }
        GM_deleteValue('aw_pip_restore');

        if (!document.pictureInPictureEnabled) {
            console.warn('[PiP] Restore skipped — pictureInPictureEnabled is false');
            return;
        }

        console.log(`[PiP] Restore flag found (age: ${age}ms) — waiting for video...`);

        // Wait until the video has actual content (readyState >= 2 = HAVE_CURRENT_DATA)
        if (player.readyState < 2) {
            await new Promise((resolve) => {
                player.addEventListener('canplay', resolve, { once: true });
            });
        }

        console.log('[PiP] Video ready — attempt 1 (after canplay)...');

        try {
            await player.requestPictureInPicture();
            console.log('[PiP] Restored successfully on attempt 1');
            return;
        } catch (e) {
            console.warn(`[PiP] Attempt 1 failed (${e.message}) — waiting for playing event...`);
        }

        // Attempt 2: wait until video is actually playing (some players need this)
        await new Promise((resolve) => {
            if (!player.paused) { resolve(); return; }
            const onPlay = () => resolve();
            player.addEventListener('playing', onPlay, { once: true });
            setTimeout(() => { player.removeEventListener('playing', onPlay); resolve(); }, 3000);
        });

        console.log('[PiP] Attempt 2 (after playing)...');

        try {
            await player.requestPictureInPicture();
            console.log('[PiP] Restored successfully on attempt 2');
        } catch (e) {
            console.warn(`[PiP] Attempt 2 failed (${e.message}) — user gesture required, showing button`);
            showPipRestoreButton(player);
        }
    }

    function showPipRestoreButton(player) {
        if (document.querySelector('.aw-pip-restore-btn')) return;

        console.log('[PiP] Showing restore button (waiting for user gesture)');

        GM_addStyle(`
            .aw-pip-restore-btn {
                position: fixed;
                bottom: 110px;
                right: 10px;
                padding: 8px 14px;
                background: rgba(0,0,0,0.75);
                color: #fff;
                border: 2px solid #60a5fa;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                font-family: sans-serif;
                cursor: pointer;
                z-index: 99999;
                transition: background 0.15s;
            }
            .aw-pip-restore-btn:hover { background: rgba(30,80,160,0.85); }
        `);

        const btn = document.createElement('button');
        btn.className = 'aw-pip-restore-btn';
        btn.textContent = '⧉ PiP wiederherstellen';
        btn.addEventListener('click', async () => {
            btn.remove();
            console.log('[PiP] User clicked restore button');
            try {
                await player.requestPictureInPicture();
                console.log('[PiP] Restored via user gesture');
            } catch (e) {
                console.warn(`[PiP] Failed even with user gesture: ${e.message}`);
            }
        }, { once: true });

        document.body.appendChild(btn);

        setTimeout(() => {
            if (btn.isConnected) {
                btn.remove();
                console.log('[PiP] Restore button auto-dismissed after timeout');
            }
        }, 10000);
    }

    // Add visual markers on timeline for intro/outro
    function addTimelineMarkers(player) {
        if (!globalAniSkipData) {
            return;
        }

        if (!player.duration || !isFinite(player.duration)) {
            player.addEventListener('durationchange', () => addTimelineMarkers(player), { once: true });
            return;
        }

        // Remove any existing markers
        document.querySelectorAll('.aniskip-marker').forEach(el => el.remove());

        // Find the slider
        const slider = document.querySelector('.jw-slider-time') ||
                       document.querySelector('.jw-slider-container');

        if (!slider) {
            setTimeout(() => addTimelineMarkers(player), 1000);
            return;
        }

        // Ensure relative positioning
        const computedStyle = window.getComputedStyle(slider);
        if (computedStyle.position === 'static') {
            slider.style.position = 'relative';
        }

        // Intro marker (pink/purple)
        if (globalAniSkipData.intro) {
            const startPct = (globalAniSkipData.intro.start / player.duration) * 100 + 0.5;
            const widthPct = ((globalAniSkipData.intro.end - globalAniSkipData.intro.start) / player.duration) * 100;

            const marker = document.createElement('div');
            marker.className = 'aniskip-marker';
            marker.style.cssText = `
                position: absolute;
                left: ${startPct}%;
                width: ${widthPct}%;
                top: 30%;
                height: 60%;
                background-color: rgba(255, 0, 251, 0.5);
                pointer-events: none;
                z-index: 100;
                border-radius: 2px;
            `;
            slider.appendChild(marker);
        }

        // Outro marker (red)
        if (globalAniSkipData.outro) {
            const startPct = (globalAniSkipData.outro.start / player.duration) * 100 + 0.5;
            const widthPct = ((globalAniSkipData.outro.end - globalAniSkipData.outro.start) / player.duration) * 100;

            const marker = document.createElement('div');
            marker.className = 'aniskip-marker aniskip-marker-outro';
            marker.style.cssText = `
                position: absolute;
                left: ${startPct}%;
                width: ${widthPct}%;
                top: 30%;
                height: 60%;
                background-color: rgba(255, 50, 50, 0.5);
                pointer-events: none;
                z-index: 100;
                border-radius: 2px;
            `;
            slider.appendChild(marker);
        }
    }


    function waitForElement(query, {
        callbackOnTimeout = false,
        existing = false,
        onceOnly = false,
        rootElement = document.documentElement,
        timeout,

        // "attributes" prop is not supported
        observerOptions = {
            childList: true,
            subtree: true,
        },
    }, callback) {
        if (!query) throw new Error('Query is needed');
        if (!callback) throw new Error('Callback is needed');

        const handledElements = new WeakSet();
        const existingElements = rootElement.querySelectorAll(query);
        let timeoutId = null;
        if (existingElements.length) {
            // Mark all as handled for a proper work when `existing` is false
            // to ignore them later on
            for (const node of existingElements) {
                handledElements.add(node);
            }

            if (existing) {
                if (onceOnly) {
                    try {
                        callback(existingElements[0]);
                    } catch (e) {
                        console.error(e);
                    }

                    return;
                } else {
                    for (const node of existingElements) {
                        try {
                            callback(node);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
            }
        }

        const observer = new MutationObserver((mutations, observer) => {
            for (const node of rootElement.querySelectorAll(query)) {
                if (handledElements.has(node)) continue;

                handledElements.add(node);

                try {
                    callback(node);
                } catch (e) {
                    console.error(e);
                }

                if (onceOnly) {
                    observer.disconnect();

                    if (timeoutId) clearTimeout(timeoutId);

                    return;
                }
            }
        });
        observer.observe(rootElement, {
            attributes: false,
            childList: observerOptions.childList || false,
            subtree: observerOptions.subtree || false,
        });
        if (timeout !== undefined) {
            timeoutId = setTimeout(() => {
                observer.disconnect();

                if (callbackOnTimeout) {
                    try {
                        callback(null);
                    } catch (e) {
                        console.error(e);
                    }
                }
            }, timeout);
        }

        return observer;
    }

    async function waitForUserInteraction() {
        return new Promise((resolve) => {
            const handler = () => {
                document.removeEventListener('pointerup', handler);
                document.removeEventListener('keydown', handler);

                resolve();
            };

            document.addEventListener('pointerup', handler, {
                once: true
            });
            document.addEventListener('keydown', handler, {
                once: true
            });
        });
    }

    // -------------------------------------- utils\ ---------------------------------------------

    /* CommLink.js
    - Version: 1.0.1
    - Author: Haka
    - Description: A userscript library for cross-window communication via the userscript storage
    - GitHub: https://github.com/AugmentedWeb/CommLink
    */
    class CommLinkHandler {
        constructor(commlinkID, configObj) {
            this.commlinkID = commlinkID;
            this.singlePacketResponseWaitTime = configObj?.singlePacketResponseWaitTime || 1500;
            this.maxSendAttempts = configObj?.maxSendAttempts || 3;
            this.statusCheckInterval = configObj?.statusCheckInterval || 1;
            this.silentMode = configObj?.silentMode || false;
            this.commlinkValueIndicator = 'commlink-packet-';
            this.commands = {};
            this.listeners = [];

            const missingGrants = [
                'GM_getValue',
                'GM_setValue',
                'GM_deleteValue',
                'GM_listValues',
            ].filter(grant => !GM_info.script.grant.includes(grant));
            if (missingGrants.length > 0 && !this.silentMode) {
                alert(
                    `[CommLink] The following userscript grants are missing: ${missingGrants.join(', ')}. CommLink will not work.`
                );
            }

            this.getStoredPackets()
                .filter(packet => Date.now() - packet.date > 2e4)
                .forEach(packet => this.removePacketByID(packet.id));
        }

        setIntervalAsync(callback, interval = this.statusCheckInterval) {
            let running = true;
            async function loop() {
                while (running) {
                    try {
                        await callback();
                        await new Promise((resolve) => setTimeout(resolve, interval));
                    } catch {
                        continue;
                    }
                }
            };
            loop();

            return {
                stop: () => {
                    running = false;
                    return false;
                }
            };
        }

        getUniqueID() {
            return ([1e7] + -1e3 + 4e3 + -8e3 + -1e11)
                .replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
        }

        getCommKey(packetID) {
            return this.commlinkValueIndicator + packetID;
        }

        getStoredPackets() {
            return GM_listValues()
                .filter(key => key.includes(this.commlinkValueIndicator))
                .map(key => GM_getValue(key));
        }

        addPacket(packet) {
            GM_setValue(this.getCommKey(packet.id), packet);
        }

        removePacketByID(packetID) {
            GM_deleteValue(this.getCommKey(packetID));
        }

        findPacketByID(packetID) {
            return GM_getValue(this.getCommKey(packetID));
        }

        editPacket(newPacket) {
            GM_setValue(this.getCommKey(newPacket.id), newPacket);
        }

        send(platform, cmd, d) {
            return new Promise(async resolve => {
                const packetWaitTimeMs = this.singlePacketResponseWaitTime;
                const maxAttempts = this.maxSendAttempts;

                let attempts = 0;

                for (;;) {
                    attempts++;

                    const packetID = this.getUniqueID();
                    const attemptStartDate = Date.now();

                    const packet = {
                        command: cmd,
                        data: d,
                        date: attemptStartDate,
                        id: packetID,
                        sender: platform,
                    };

                    if (!this.silentMode) {
                        console.log(`[CommLink Sender] Sending packet! (#${attempts} attempt):`, packet);
                    }

                    this.addPacket(packet);

                    for (;;) {
                        const poolPacket = this.findPacketByID(packetID);
                        const packetResult = poolPacket?.result;

                        if (poolPacket && packetResult) {
                            if (!this.silentMode) {
                                console.log(`[CommLink Sender] Got result for a packet (${packetID}):`, packetResult);
                            }

                            resolve(poolPacket.result);
                            attempts = maxAttempts; // stop main loop

                            break;
                        }

                        if (!poolPacket || Date.now() - attemptStartDate > packetWaitTimeMs) {
                            break;
                        }

                        await new Promise(res => setTimeout(res, this.statusCheckInterval));
                    }

                    this.removePacketByID(packetID);
                    if (attempts === maxAttempts) break;
                }

                return resolve(null);
            });
        }

        registerSendCommand(name, obj) {
            this.commands[name] = async (data) => {
                return await this.send(obj?.commlinkID || this.commlinkID, name, obj?.data || data);
            };
        }

        registerListener(sender, commandHandler) {
            const listener = {
                sender,
                commandHandler,
                intervalObj: this.setIntervalAsync(this.receivePackets.bind(this), this.statusCheckInterval),
            };
            this.listeners.push(listener);
        }

        receivePackets() {
            this.getStoredPackets().forEach(packet => {
                this.listeners.forEach(listener => {
                    if (packet.sender === listener.sender && !packet.hasOwnProperty('result')) {
                        const result = listener.commandHandler(packet);

                        packet.result = result;

                        this.editPacket(packet);

                        if (!this.silentMode) {
                            if (packet.result === null) {
                                console.log('[CommLink Receiver] Possibly failed to handle packet:', packet);
                            } else {
                                console.log('[CommLink Receiver] Successfully handled a packet:', packet);
                            }
                        }
                    }
                });
            });
        }

        kill() {
            this.listeners.forEach(listener => listener.intervalObj.stop());
        }
    }


    class IframeMessenger {
        constructor() {
            this.commLink = null;
            this.topScopeId = null;
        }

        static get messages() {
            return {
                AUTOPLAY_NEXT: 'AUTOPLAY_NEXT',
                REQUEST_CURRENT_FRANCHISE_DATA: 'REQUEST_CURRENT_FRANCHISE_DATA',
                REQUEST_FULLSCREEN_STATE: 'REQUEST_FULLSCREEN_STATE',
                MARK_CURRENT_VIDEO_WATCHED: 'MARK_CURRENT_VIDEO_WATCHED',
                OPEN_HOTKEYS_GUIDE: 'OPEN_HOTKEYS_GUIDE',
                TOGGLE_FULLSCREEN: 'TOGGLE_FULLSCREEN',
                TOP_NOTIFLIX_REPORT_INFO: 'TOP_NOTIFLIX_REPORT_INFO',
                UPDATE_CORE_SETTINGS: 'UPDATE_CORE_SETTINGS',
            };
        }

        async initCrossFrameConnection() {
            const iframeId = makeId();
            const topScopeIdPromise = new Promise((resolve) => {
                // Top scope using GM_setValue will write its own id using iframeId as a key
                const valueChangeListenerId = GM_addValueChangeListener(iframeId, (
                    _key,
                    _oldValue,
                    newValue,
                ) => {
                    GM_removeValueChangeListener(valueChangeListenerId);
                    GM_deleteValue(iframeId);

                    resolve(newValue);
                });
            });
            // This should be almost immediately picked up by a top scope
            GM_setValue('unboundIframeId', iframeId);
            const topScopeId = await topScopeIdPromise;

            if (!iframeId || !topScopeId) throw new Error('Something went wrong');

            this.topScopeId = topScopeId;
            this.commLink = new CommLinkHandler(iframeId, {
                silentMode: true,
                statusCheckInterval: advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs],
            });
            this.commLink.registerSendCommand(IframeMessenger.messages.AUTOPLAY_NEXT);
            this.commLink.registerSendCommand(IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA);
            this.commLink.registerSendCommand(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
            this.commLink.registerSendCommand(IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED);
            this.commLink.registerSendCommand(IframeMessenger.messages.OPEN_HOTKEYS_GUIDE);
            this.commLink.registerSendCommand(IframeMessenger.messages.TOGGLE_FULLSCREEN);
            this.commLink.registerSendCommand(IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO);
            this.commLink.registerSendCommand(IframeMessenger.messages.UPDATE_CORE_SETTINGS);
        }

        registerConnectionListener(callback) {
            return this.commLink.registerListener(this.topScopeId, callback);
        }

        sendMessage(message, msgData) {
            this.commLink.commands[message](msgData);
            return;
        }
    }

    class IframeInterface {
        constructor(messenger) {
            this.commLink = null;
            this.currentFranchiseId = null;
            this.currentVideoId = null;
            this.ignoreMissingFranchiseOnce = true;
            this.isInFullscreen = null;
            this.messenger = messenger;
            this.topScopeDomainId = '';
            this.aniSkipData = null; // Store fetched AniSkip times
            this.aniSkipDurationRefetchKey = null;
            // Store anime info for AniSkip
            this.animeTitle = null;
            this.animeSlug = null;
            this.episodeNumber = null;
            this.seasonNumber = null;
            coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] = (
                advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS]
            );
            coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] = (
                advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS]
            );
        }

        static get franchiseSpecificDataGMPrefix() {
            return 'franchiseSpecificData_';
        }

        static makePlaybackPositionGMKey(topScopeDomainId, episodeId) {
            if (!topScopeDomainId || !episodeId) throw new Error('Something is missing');
            return `playbackTimestamp_${topScopeDomainId}_${episodeId}`;
        }

        // It is better not to be async
        handleTopScopeMessages(packet) {
            (async function() {
                try {
                    switch (packet.command) {
                        case TopScopeInterface.messages.CURRENT_FRANCHISE_DATA: {
                            // At least one value is going to be present
                            this.currentVideoId = packet.data.currentVideoId || null;
                            this.topScopeDomainId = packet.data.topScopeDomainId || '';

                            // Store anime info for AniSkip
                            this.animeTitle = packet.data.animeTitle || null;
                            this.animeSlug = packet.data.animeSlug || null;
                            this.episodeNumber = packet.data.episodeNumber || null;
                            this.seasonNumber = packet.data.seasonNumber || null;

                            // Fetch AniSkip data when we receive episode info
                            // Only on aniworld.to - AniSkip is for anime, not series
                            if (this.animeTitle && this.animeSlug && this.episodeNumber &&
                                this.topScopeDomainId !== 'sto') {
                                // Wait for video duration to be available so we can pass episodeLength to AniSkip API
                                const waitForDurationThenFetch = async () => {
                                    const player = document.querySelector('video');
                                    if (player && player.duration && isFinite(player.duration) && player.duration > 0) {
                                        return this.fetchAniSkipData();
                                    }
                                    // Wait for loadedmetadata, with a timeout fallback
                                    return new Promise((resolve) => {
                                        let resolved = false;
                                        const onReady = () => {
                                            if (resolved) return;
                                            resolved = true;
                                            this.fetchAniSkipData().then(resolve).catch(() => resolve(null));
                                        };
                                        if (player) {
                                            player.addEventListener('loadedmetadata', onReady, { once: true });
                                        }
                                        // Fallback: fetch anyway after 5s even without duration
                                        setTimeout(onReady, 5000);
                                    });
                                };

                                waitForDurationThenFetch().then(data => {
                                    this.aniSkipData = data;
                                    globalAniSkipData = data;
                                    // Now that we have the data, add timeline markers
                                    const player = document.querySelector('video');
                                    if (player) {
                                        addTimelineMarkers(player);
                                    }
                                }).catch(err => {
                                    console.error('[AniSkip] Error during fetch:', err);
                                });
                            }

                            if (packet.data.currentFranchiseId) {
                                this.currentFranchiseId = packet.data.currentFranchiseId;

                                const {
                                    largeSkipSizeS,
                                    outroSkipThresholdS
                                } = GM_getValue(
                                    `${IframeInterface.franchiseSpecificDataGMPrefix}${this.currentFranchiseId}`
                                ) || {};

                                if (isNumeric(largeSkipSizeS)) {
                                    coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] = largeSkipSizeS;
                                } else {
                                    coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS] = (
                                        advancedSettings[ADVANCED_SETTINGS_MAP.defaultLargeSkipSizeS]
                                    );
                                }

                                if (isNumeric(outroSkipThresholdS)) {
                                    coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] = outroSkipThresholdS;
                                } else {
                                    coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS] = (
                                        advancedSettings[ADVANCED_SETTINGS_MAP.defaultOutroSkipThresholdS]
                                    );
                                }

                                this.settingsPane?.refresh();
                                this.ignoreMissingFranchiseOnce = false;
                            }

                            break;
                        }

                        case TopScopeInterface.messages.FULLSCREEN_STATE: {
                            if (IS_SAFARI) break;
                            this.isInFullscreen = packet.data.isInFullscreen;
                            this.updateFullscreenBtn({
                                isInFullscreen: this.isInFullscreen
                            });
                            break;
                        }

                        default:
                            break;
                    }
                } catch (e) {
                    console.error(e);
                }
            }.bind(this)());
            return {
                status: `${this.constructor.name} received a message`,
            };
        }

        scheduleAniSkipDurationRefetch(player) {
            if (!player) return;

            const pendingKey = `${this.animeSlug || ''}::s${this.seasonNumber ?? 1}::e${this.episodeNumber || ''}`;
            if (!pendingKey || this.aniSkipDurationRefetchKey === pendingKey) return;

            this.aniSkipDurationRefetchKey = pendingKey;

            const maybeRefetch = async () => {
                if (this.aniSkipDurationRefetchKey !== pendingKey) return;

                const exactDuration = player.duration;
                if (!(Number.isFinite(exactDuration) && exactDuration > 0)) return;

                const currentKey = `${this.animeSlug || ''}::s${this.seasonNumber ?? 1}::e${this.episodeNumber || ''}`;
                if (currentKey !== pendingKey) return;

                this.aniSkipDurationRefetchKey = null;
                console.log('[AniSkip] Episode duration became available, refetching with exact length:', exactDuration);

                try {
                    const data = await this.fetchAniSkipData({ ignoreNoDataCache: true });
                    this.aniSkipData = data;
                    globalAniSkipData = data;
                    addTimelineMarkers(player);
                } catch (e) {
                    console.error('[AniSkip] Refetch after duration update failed:', e);
                }
            };

            player.addEventListener('loadedmetadata', maybeRefetch, { once: true });
            player.addEventListener('durationchange', maybeRefetch, { once: true });
        }

        async fetchAniSkipData(options = {}) {
            const ignoreNoDataCache = !!options.ignoreNoDataCache;
            // AniSkip is only for anime (aniworld.to), not for series (S.to domains)
            if (STO_DOMAINS.includes(this.topScopeDomainId === 'sto' ? location.hostname : '') ||
                this.topScopeDomainId === 'sto') {
                globalAniSkipData = null;
                return null;
            }

            // Check if AniSkip is enabled
            if (!advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip]) {
                globalAniSkipData = null;
                return null;
            }

            try {
                // Use instance variables instead of extracting from page
                const title = this.animeTitle;
                const slug = this.animeSlug;
                const episode = this.episodeNumber;
                const season = this.seasonNumber;

                if (!title || !slug || !episode) {
                    console.log('[AniSkip] Missing anime info:', { title, slug, episode, season });
                    globalAniSkipData = null;
                    return null;
                }

                // ── Check for local override data ──────────────────────────────
                const localData = AniSkipModule.getLocalSkipTimes(slug, season, episode);
                const hasLocalData = !!(localData && (localData.intro || localData.outro));
                if (hasLocalData) {
                    console.log('[AniSkip] Found local override data:', localData);
                }

                // Merge local overrides on top of API data (local always wins per type)
                const applyLocalOverrides = (data) => {
                    if (!hasLocalData) return data;
                    const merged = data ? { ...data } : {};
                    if (localData.intro) merged.intro = localData.intro;
                    if (localData.outro) merged.outro = localData.outro;
                    return merged;
                };

                // ── "No data" cache — skip if we have local data to use ──────────────
                const noDataKey = `aw_nodata::${slug}::s${season ?? 1}::e${episode}`;
                if (!ignoreNoDataCache && !hasLocalData) {
                    const noDataEntry = GM_getValue(noDataKey, null);
                    if (noDataEntry) {
                    try {
                        const { _cachedAt } = noDataEntry;
                        // Suppress for 2 hours — prevents spam but retries reasonably often
                        if (_cachedAt && Date.now() - _cachedAt < 2 * 60 * 60 * 1000) {
                            console.log('[AniSkip] "No data" cached, skipping API calls');
                            globalAniSkipData = null;
                            return null;
                        }
                    } catch {}
                    GM_deleteValue(noDataKey);
                    }
                }

                console.log('[AniSkip] Fetching for:', { title, slug, episode, season });

                // Fetch MAL ID (include season for multi-season anime)
                const malId = await AniSkipModule.getMalId(title, slug, season);
                if (!malId) {
                    console.log('[AniSkip] Could not find MAL ID — trying anime-skip.com directly...');
                    const player = document.querySelector('video');
                    const epLen = player?.duration && isFinite(player.duration) ? player.duration : 0;
                    try {
                        const animeSkipResult = await AnimeSkipModule.getSkipTimes(title, episode, epLen, season);
                        if (animeSkipResult?.intro) {
                            const merged = applyLocalOverrides(animeSkipResult);
                            console.log('[AnimeSkip] Direct fallback succeeded:', merged);
                            if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                                Notiflix.Notify.success('AnimeSkip: ' + (userLang === 'de' ? 'Erkannte Zeiten werden verwendet' : 'Using detected times'), {
                                    timeout: 2000,
                                    position: 'right-bottom',
                                });
                                this.showOverrideButton(null, episode);
                            }
                            globalAniSkipData = merged;
                            return merged;
                        }
                    } catch (e) {
                        console.error('[AnimeSkip] Direct fallback error:', e);
                    }
                    // No MAL ID, no AnimeSkip data — use local if available
                    if (hasLocalData) {
                        console.log('[AniSkip] No MAL ID / API data, using local override data');
                        globalAniSkipData = localData;
                        if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                            this.showOverrideButton(null, episode);
                        }
                        return localData;
                    }
                    if (epLen > 0) {
                        GM_setValue(noDataKey, { _cachedAt: Date.now() });
                    }
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                        Notiflix.Notify.info(i18n.aniSkipFetchFailed, {
                            timeout: 2000,
                            position: 'right-bottom',
                        });
                    }
                    globalAniSkipData = null;
                    return null;
                }

                console.log('[AniSkip] Found MAL ID:', malId);

                // Get episode length from the video player if available
                const player = document.querySelector('video');
                const episodeLength = player?.duration && isFinite(player.duration) ? player.duration : 0;
                console.log('[AniSkip] Episode length from player:', episodeLength);
                if (episodeLength > 0) {
                    this.aniSkipDurationRefetchKey = null;
                } else {
                    this.scheduleAniSkipDurationRefetch(player);
                }

                // Fetch skip times
                const skipTimes = await AniSkipModule.getSkipTimes(malId, episode, episodeLength);
                const parsed = (skipTimes?.length)
                    ? AniSkipModule.parseSkipTimes(skipTimes, episodeLength)
                    : null;

                if (parsed?.intro || parsed?.outro) {
                    const merged = applyLocalOverrides(parsed);
                    console.log('[AniSkip] Successfully fetched skip times:', merged);
                    globalAniSkipData = merged;
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                        this.showOverrideButton(malId, episode);
                    }
                    return merged;
                }

                // ── Fallback 1: anime-skip.com ──────────────────────────────
                console.log('[AniSkip] No data — trying anime-skip.com fallback...');
                try {
                    const animeSkipResult = await AnimeSkipModule.getSkipTimes(title, episode, episodeLength, season);
                    if (animeSkipResult?.intro) {
                        const merged = applyLocalOverrides(animeSkipResult);
                        console.log('[AnimeSkip] Fallback succeeded:', merged);
                        if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                            Notiflix.Notify.success('AnimeSkip: ' + (userLang === 'de' ? 'Erkannte Zeiten werden verwendet' : 'Using detected times'), {
                                timeout: 2000,
                                position: 'right-bottom',
                            });
                            this.showOverrideButton(malId, episode);
                        }
                        globalAniSkipData = merged;
                        return merged;
                    }
                } catch (fallbackErr) {
                    console.error('[AnimeSkip] Fallback error:', fallbackErr);
                }

                // ── All API sources failed — check local data before giving up ──
                if (hasLocalData) {
                    console.log('[AniSkip] All API sources exhausted, using local override data:', localData);
                    globalAniSkipData = localData;
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                        this.showOverrideButton(malId, episode);
                    }
                    return localData;
                }

                // ── All sources failed — cache result + show submit notification ──
                console.log('[AniSkip] All sources exhausted, no intro data found');
                if (episodeLength > 0) {
                    GM_setValue(noDataKey, { _cachedAt: Date.now() });
                }
                globalAniSkipData = null;
                if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                    this.showSubmitNotification(malId, episode);
                }
                return null;
            } catch (e) {
                console.error('[AniSkip] Error fetching skip times:', e);
                globalAniSkipData = null;
                return null;
            }
        }

        // Opens the submit/override dialog for a specific type ('intro' or 'outro').
        // isOverride=true → pre-fills with current globalAniSkipData and shows "Override" wording.
        _openSkipTimesDialog(malId, episode, button, isOverride = false, type = 'intro') {
            let player = this.player || document.querySelector('video');
            if (!player) {
                Notiflix.Notify.failure('Player not ready', { timeout: 3000, position: 'right-bottom' });
                return;
            }

            const isIntro = type === 'intro';

            const timeToSeconds = (str) => {
                str = String(str).trim();
                if (str.includes(':')) {
                    const [m, s] = str.split(':');
                    return (parseInt(m) || 0) * 60 + (parseInt(s) || 0);
                }
                return parseFloat(str) || 0;
            };
            const formatTime = (sec) => {
                const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
                return `${m}:${s.toString().padStart(2, '0')}`;
            };

            // Pre-fill: override mode uses existing data, submit mode uses session values
            const existing = isOverride && (isIntro ? globalAniSkipData?.intro : globalAniSkipData?.outro);
            const sessionStart = isIntro ? submitDialogValues.introStart : submitDialogValues.outroStart;
            const sessionEnd   = isIntro ? submitDialogValues.introEnd   : submitDialogValues.outroEnd;
            const initStart = existing ? formatTime(existing.start) : (sessionStart || '0:00');
            const initEnd   = existing ? formatTime(existing.end)   : (sessionEnd   || '0:00');

            const themeVars = getCurrentThemeVars();
            const { bgPrimary, bgSecondary, bgTertiary, accentPrimary, accentSecondary,
                    textPrimary, textSecondary, borderColor, borderRadius, fontFamily } = themeVars;
            const typeColor = isIntro ? accentPrimary : accentSecondary;

            const overlay = document.createElement('div');
            overlay.id = 'aw-submit-overlay';
            overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:99998;`;

            const dialog = document.createElement('div');
            dialog.id = 'aw-submit-dialog';
            dialog.style.cssText = `
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                width:340px;z-index:99999;background:${bgPrimary};border-radius:${borderRadius};
                overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.5);font-family:${fontFamily};color:${textPrimary};
            `;

            if (!document.getElementById('aw-submit-shimmer-style')) {
                const s = document.createElement('style');
                s.id = 'aw-submit-shimmer-style';
                s.textContent = `@keyframes aw-submit-shimmer{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}`;
                document.head.appendChild(s);
            }

            const inputStyle = `flex:1;padding:10px 12px;background:${bgSecondary};border:1px solid ${borderColor};border-radius:8px;color:${textPrimary};font-family:inherit;font-size:13px;`;
            const setStyle   = `padding:10px 13px;background:${bgTertiary};border:1px solid ${borderColor};border-radius:8px;color:${textSecondary};font-family:inherit;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;`;

            const typeLabelDE = isIntro ? 'Intro' : 'Outro';
            const typeLabelEN = isIntro ? 'Intro' : 'Outro';

            const titleText = isOverride
                ? (userLang === 'de' ? `${typeLabelDE} Zeiten überschreiben` : `Override ${typeLabelEN} Times`)
                : (userLang === 'de' ? `${typeLabelDE} Zeiten einreichen`    : `Submit ${typeLabelEN} Times`);
            const subtitleText = isOverride
                ? (userLang === 'de' ? 'Lokal gespeicherte Zeiten haben Vorrang' : 'Locally saved times take priority')
                : (userLang === 'de' ? 'Der Community helfen!' : 'Help the community!');

            dialog.innerHTML = `
                <div style="background:${bgSecondary};padding:14px 16px;border-bottom:1px solid ${borderColor};display:flex;align-items:center;gap:12px;position:relative;">
                    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,${typeColor},${accentSecondary},${typeColor});background-size:200% 100%;animation:aw-submit-shimmer 3s ease-in-out infinite;"></div>
                    <div style="width:40px;height:40px;background:linear-gradient(135deg,${typeColor},${accentSecondary});border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;flex-shrink:0;">
                        ${isOverride ? '✎' : '↑'}
                    </div>
                    <div style="min-width:0;">
                        <h3 style="font-size:15px;font-weight:600;margin:0 0 2px 0;">${titleText}</h3>
                        <p style="font-size:11px;color:${textSecondary};margin:0;">${subtitleText}</p>
                    </div>
                    <button id="aw-submit-close" style="margin-left:auto;width:26px;height:26px;border:none;background:${bgTertiary};border-radius:6px;color:${textSecondary};cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>
                </div>
                <div style="padding:16px;">
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:11px;color:${textSecondary};margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">
                            ${userLang === 'de' ? `${typeLabelDE} Start` : `${typeLabelEN} Start`}
                        </label>
                        <div style="display:flex;gap:6px;">
                            <input type="text" id="aw-time-start" value="${initStart}" style="${inputStyle}">
                            <button id="aw-set-start" style="${setStyle}">${userLang === 'de' ? 'Jetzt' : 'Now'}</button>
                        </div>
                    </div>
                    <div style="margin-bottom:18px;">
                        <label style="display:block;font-size:11px;color:${textSecondary};margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">
                            ${userLang === 'de' ? `${typeLabelDE} Ende` : `${typeLabelEN} End`}
                        </label>
                        <div style="display:flex;gap:6px;">
                            <input type="text" id="aw-time-end" value="${initEnd}" style="${inputStyle}">
                            <button id="aw-set-end" style="${setStyle}">${userLang === 'de' ? 'Jetzt' : 'Now'}</button>
                            <button id="aw-add-end" style="${setStyle}" title="+1:30 min">+1:30</button>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button id="aw-submit-cancel" style="padding:10px 14px;background:${bgTertiary};border:none;border-radius:8px;color:${textSecondary};font-family:inherit;font-size:12px;font-weight:500;cursor:pointer;">
                            ${userLang === 'de' ? 'Abbrechen' : 'Cancel'}
                        </button>
                        <button id="aw-save-local" style="flex:1;padding:10px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:8px;color:rgb(34,197,94);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">
                            ${userLang === 'de' ? '💾 Lokal speichern' : '💾 Save Locally'}
                        </button>
                        <button id="aw-submit-confirm" style="flex:1;padding:10px;background:linear-gradient(135deg,${typeColor},${accentSecondary});border:none;border-radius:8px;color:white;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">
                            ${userLang === 'de' ? '↑ API einreichen' : '↑ Submit to API'}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(dialog);

            dialog.querySelectorAll('input').forEach(input => {
                ['keydown', 'keyup', 'keypress'].forEach(ev => input.addEventListener(ev, e => e.stopPropagation()));
            });

            const closeDialog = () => {
                const val = { start: dialog.querySelector('#aw-time-start').value, end: dialog.querySelector('#aw-time-end').value };
                if (isIntro) { submitDialogValues.introStart = val.start; submitDialogValues.introEnd = val.end; }
                else         { submitDialogValues.outroStart = val.start; submitDialogValues.outroEnd = val.end; }
                overlay.remove();
                dialog.remove();
            };

            const getNow = () => formatTime(Math.floor(player.currentTime));
            dialog.querySelector('#aw-set-start').onclick = () => { dialog.querySelector('#aw-time-start').value = getNow(); };
            dialog.querySelector('#aw-set-end').onclick   = () => { dialog.querySelector('#aw-time-end').value   = getNow(); };

            dialog.querySelector('#aw-add-end').onclick = () => {
                const startSecs = timeToSeconds(dialog.querySelector('#aw-time-start').value);
                dialog.querySelector('#aw-time-end').value = formatTime(startSecs + 90);
            };

            overlay.addEventListener('click', closeDialog);
            dialog.querySelector('#aw-submit-close').addEventListener('click', closeDialog);
            dialog.querySelector('#aw-submit-cancel').addEventListener('click', closeDialog);

            // Validate and return { start, end } or null
            const readFields = () => {
                const start = timeToSeconds(dialog.querySelector('#aw-time-start').value);
                const end   = timeToSeconds(dialog.querySelector('#aw-time-end').value);
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                    Notiflix.Notify.failure(userLang === 'de'
                        ? `Ungültige ${typeLabelDE}-Zeiten. Ende muss nach dem Start liegen.`
                        : `Invalid ${typeLabelEN} times. End must be greater than start.`,
                        { timeout: 3000, position: 'right-bottom' });
                    return null;
                }
                return { start, end };
            };

            // ── Save Locally ──────────────────────────────────────────────────────
            dialog.querySelector('#aw-save-local').addEventListener('click', () => {
                const times = readFields();
                if (!times) return;

                const introArg = isIntro  ? times     : undefined;
                const outroArg = !isIntro ? times     : undefined;
                AniSkipModule.saveLocalSkipTimes(this.animeSlug, this.seasonNumber, episode, introArg, outroArg);

                if (!globalAniSkipData) globalAniSkipData = {};
                if (isIntro)  globalAniSkipData.intro = times;
                else          globalAniSkipData.outro = times;

                closeDialog();
                if (button) button.remove();
                if (isIntro) submitDialogValues.introStart = submitDialogValues.introEnd = null;
                else         submitDialogValues.outroStart = submitDialogValues.outroEnd = null;

                Notiflix.Notify.success(userLang === 'de'
                    ? 'Lokal gespeichert! Zeiten werden sofort verwendet.'
                    : 'Saved locally! Times will be used immediately.', { timeout: 4000, position: 'right-bottom' });

                const playerEl = document.querySelector('video');
                if (playerEl) addTimelineMarkers(playerEl);
            });

            // ── Submit to API ─────────────────────────────────────────────────────
            dialog.querySelector('#aw-submit-confirm').addEventListener('click', async () => {
                const times = readFields();
                if (!times) return;
                const episodeLength = player.duration ? Math.floor(player.duration) : 0;
                if (episodeLength <= 0) {
                    Notiflix.Notify.failure(
                        userLang === 'de'
                            ? 'Episodenlänge nicht verfügbar. Bitte warte bis das Video geladen ist.'
                            : 'Episode length not available. Please wait for the video to load.',
                        { timeout: 4000, position: 'right-bottom' });
                    return;
                }

                let resolvedMalId = malId;
                if (!resolvedMalId) {
                    resolvedMalId = await AniSkipModule.getMalId(this.animeTitle, this.animeSlug, this.seasonNumber);
                }
                if (!resolvedMalId) {
                    Notiflix.Notify.failure(
                        userLang === 'de'
                            ? 'MAL-ID nicht gefunden. Bitte "Lokal speichern" verwenden.'
                            : 'Could not find MAL ID. Use "Save Locally" instead.',
                        { timeout: 4000, position: 'right-bottom' });
                    return;
                }

                closeDialog();
                Notiflix.Notify.info(
                    userLang === 'de' ? 'Wird zu AniSkip hochgeladen...' : 'Submitting to AniSkip...',
                    { timeout: 3000, position: 'right-bottom' });

                const result = isIntro
                    ? await AniSkipModule.submitSkipTimes(resolvedMalId, episode, episodeLength, times.start, times.end)
                    : await AniSkipModule.submitOutroTimes(resolvedMalId, episode, episodeLength, times.start, times.end);

                if (result.success) {
                    const introArg = isIntro  ? times : undefined;
                    const outroArg = !isIntro ? times : undefined;
                    AniSkipModule.saveLocalSkipTimes(this.animeSlug, this.seasonNumber, episode, introArg, outroArg);
                    if (!globalAniSkipData) globalAniSkipData = {};
                    if (isIntro)  globalAniSkipData.intro = times;
                    else          globalAniSkipData.outro = times;

                    if (button) button.remove();
                    if (isIntro) submitDialogValues.introStart = submitDialogValues.introEnd = null;
                    else         submitDialogValues.outroStart = submitDialogValues.outroEnd = null;

                    Notiflix.Notify.success(userLang === 'de'
                        ? 'Erfolgreich eingereicht und lokal gespeichert!'
                        : 'Successfully submitted and saved locally!', { timeout: 5000, position: 'right-bottom' });
                    const playerEl = document.querySelector('video');
                    if (playerEl) addTimelineMarkers(playerEl);
                } else {
                    Notiflix.Notify.failure(
                        (userLang === 'de' ? 'Fehler beim Einreichen.' : 'Failed to submit.') + (result.error ? `: ${result.error}` : ''),
                        { timeout: 5000, position: 'right-bottom' });
                }
            });
        }

        showSubmitNotification(malId, episode) {
            console.log('[AniSkip] Showing submit button');

            const themeVars = getCurrentThemeVars();
            const btnBg1 = themeVars.submitBtnBg1 || themeVars.accentPrimary || 'rgba(255,51,102,1)';
            const btnBg2 = themeVars.submitBtnBg2 || themeVars.accentSecondary || 'rgba(124,58,237,1)';
            const btnText = themeVars.submitBtnText || 'rgba(255,255,255,1)';

            const button = document.createElement('a');
            button.id = 'AniSkipSubmitButton';
            button.className = 'notiflix-report-button';
            button.style.cssText = `
                position: absolute;
                bottom: 65px;
                right: 15px;
                font-weight: 600;
                font-size: 14px;
                background: linear-gradient(135deg, ${btnBg1} 0%, ${btnBg2} 100%);
                color: ${btnText};
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                z-index: 10000;
                text-decoration: none;
                display: inline-block;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                transition: all 0.3s ease, opacity 0.3s ease;
                border: 2px solid rgba(255,255,255,0.2);
                opacity: 1;
            `;
            button.textContent = userLang === 'de' ? 'Intro einreichen' : 'Submit Intro';

            let hideTimeout;
            let isMouseOverButton = false;

            const showButton = () => {
                button.style.opacity = '1';
                button.style.pointerEvents = 'auto';
                clearTimeout(hideTimeout);
                hideTimeout = setTimeout(() => {
                    if (!isMouseOverButton) {
                        button.style.opacity = '0';
                        button.style.pointerEvents = 'none';
                    }
                }, 3000);
            };
            const hideButton = () => {
                if (!isMouseOverButton) {
                    button.style.opacity = '0';
                    button.style.pointerEvents = 'none';
                }
            };

            document.addEventListener('mousemove', showButton);
            button.addEventListener('mouseenter', () => {
                isMouseOverButton = true;
                button.style.opacity = '1';
                button.style.pointerEvents = 'auto';
                clearTimeout(hideTimeout);
            });
            button.addEventListener('mouseleave', () => {
                isMouseOverButton = false;
                hideTimeout = setTimeout(hideButton, 2000);
            });
            hideTimeout = setTimeout(hideButton, 3000);

            const hideSkipIntroButton = () => {
                const skipIntroBtn = document.querySelector('.SkipIntroBtn');
                if (skipIntroBtn) skipIntroBtn.style.display = 'none';
            };
            hideSkipIntroButton();
            const checkInterval = setInterval(hideSkipIntroButton, 500);

            const originalRemove = button.remove.bind(button);
            button.remove = function() {
                clearInterval(checkInterval);
                const skipIntroBtn = document.querySelector('.SkipIntroBtn');
                if (skipIntroBtn) skipIntroBtn.style.display = '';
                originalRemove();
            };

            button.onmouseenter = function() {
                this.style.transform = 'translateY(-2px) scale(1.02)';
                this.style.boxShadow = `0 6px 16px ${btnBg1}80`;
                this.style.background = `linear-gradient(135deg, ${btnBg2} 0%, ${btnBg1} 100%)`;
            };
            button.onmouseleave = function() {
                this.style.transform = '';
                this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
                this.style.background = `linear-gradient(135deg, ${btnBg1} 0%, ${btnBg2} 100%)`;
            };

            button.onclick = (e) => {
                e.preventDefault();
                this._openSkipTimesDialog(malId, episode, button, false, 'intro');
            };

            const insertButton = () => {
                const existing = document.getElementById('AniSkipSubmitButton');
                if (existing) existing.remove();
                document.body.appendChild(button);
                console.log('[AniSkip] Submit button inserted into DOM');
            };

            if (document.body) {
                insertButton();
            } else {
                document.addEventListener('DOMContentLoaded', insertButton);
            }

            document.addEventListener('fullscreenchange', () => {
                button.style.bottom = document.fullscreenElement ? '88px' : '65px';
            });
        }

        showOverrideButton(malId, episode) {
            // Remove any previous cross-frame listener
            if (this._skipDialogListenerId != null) {
                GM_removeValueChangeListener(this._skipDialogListenerId);
            }
            // Signal availability to the top-frame message handler via shared storage
            GM_setValue('_aniSkipAvailable', 1);
            // Listen for the open-dialog trigger set by the top-frame message handler
            this._skipDialogListenerId = GM_addValueChangeListener(
                'aw_open_skip_dialog',
                (_key, _old, newVal) => {
                    if (newVal) this._openSkipTimesDialog(malId, episode, null, true, newVal.type || 'intro');
                }
            );
            console.log('[AniSkip] Zeiten ändern available in popup (malId:', malId, 'ep:', episode, ')');
        }

        async init(player) {
            this.messenger.registerConnectionListener(this.handleTopScopeMessages.bind(this));
            this.messenger.sendMessage(IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA);

            // AniSkip data will be fetched when CURRENT_FRANCHISE_DATA message arrives
            await this.preparePlayer(player);
        }


        createAutoplayButton() {
            const button = document.createElement('button');
            const toggleContainer = document.createElement('div');
            const toggleDot = document.createElement('div');
            const isAutoplayEnabled = coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled];
            let lastClickTime = 0;
            button.addEventListener('click', () => {
                const now = Date.now();

                // Prevent double-clicks unwanted behavior
                if (now - lastClickTime < 300) return;

                lastClickTime = now;

                if (!GM_getValue('firstRunTextWasShown')) {
                    GM_setValue('firstRunTextWasShown', true);

                    this.messenger.sendMessage(IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO, {
                        args: [
                            i18n.firstRunInfoTitle,
                            i18n.firstRunInfoText(IS_MOBILE, hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip]),
                            i18n.ok, {
                                delayedButton: true,
                            },
                        ],
                    });
                }

                const wasEnabled = coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled];
                coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled] = !wasEnabled;

                button.setAttribute('aria-checked', (!wasEnabled).toString());
                button.title = (
                    !isAutoplayEnabled ? i18n.autoplayDisabled : i18n.autoplayEnabled
                );
                toggleDot.style.backgroundColor = wasEnabled ? '#e1e1e1' : '#fff';
                toggleDot.style.transform = wasEnabled ? 'translateX(0px)' : 'translateX(12px)';
            });

            button.type = 'button';
            button.title = (
                !isAutoplayEnabled ? i18n.autoplayDisabled : i18n.autoplayEnabled
            );
            button.appendChild(toggleContainer);
            button.setAttribute('aria-checked', (isAutoplayEnabled).toString());
            button.className = 'Autoplay-button';

            toggleContainer.className = 'Autoplay-button--toggle';
            toggleContainer.appendChild(toggleDot);

            toggleDot.className = 'Autoplay-button--toggle-dot';
            toggleDot.style.backgroundColor = !isAutoplayEnabled ? '#e1e1e1' : '#fff';
            toggleDot.style.transform = (
                !isAutoplayEnabled ? 'translateX(0px)' : 'translateX(12px)'
            );
            GM_addStyle([`
    .Autoplay-button {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: 50%;
      border: none;
      background: none;
      cursor: pointer;
      top: 0;
      left: 0;
      transition: all 0.2s ease;
      user-select: none;
      -webkit-user-select: none;
    }

    .Autoplay-button[aria-checked="true"] .Autoplay-button--toggle-dot {
      transform: translateX(12px);
    }

    .Autoplay-button--toggle {
      width: 24px;
      height: 12px;
      margin-bottom: 3px;
      background-color: rgba(221, 221, 221, 0.5);
      border-radius: 6px;
      position: relative;
      display: inline-block;
    }

    .Autoplay-button--toggle-dot {
      width: 12px;
      height: 12px;
      background-color: #e1e1e1;
      border-radius: 50%;
      position: absolute;
      top: 0;
      left: 0;
      transition: all 0.2s ease;
    }
  `][0]);
            return button;
        }

        createSettingsPane() {
            // Settings are now in the extension popup (Erweitert tab).
            return null;
        }

        async handleAutoplay(player) {
            if (!coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled]) return;

            // Don't auto-start if the user manually clicked an episode link
            const suppressEntry = GM_getValue('aw_suppress_autoplay_once', null);
            if (suppressEntry && (Date.now() - suppressEntry._at) < 30000) {
                GM_deleteValue('aw_suppress_autoplay_once');
                console.log('[Autoplay] Manual navigation detected — not auto-starting video');
                return;
            }
            GM_deleteValue('aw_suppress_autoplay_once'); // clean up stale entries

            const playTooSlowErr = 'play() was taking too long';
            let muteWasApplied = false;
            // If play fails it tries to fix it but throws the problem error anyway
            const playOrFix = async () => {
                try {
                    await Promise.race([
                        player.play(), // there is a chance this would hang forever
                        new Promise((_, reject) => {
                            setTimeout(() => reject(new Error(playTooSlowErr)), 50);
                        }),
                    ]);
                } catch (e) {
                    if (e.name === 'NotAllowedError') {
                        // Muted usually is allowed to play,
                        // and if it's not allowed, nothing could be done here
                        if (player.muted) {
                            console.error('Muted and not allowed');
                            throw e;
                        }

                        if (mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted] && !muteWasApplied) {
                            player.muted = true;
                            muteWasApplied = true;

                            // Restore setting altered by forced mute.
                            // See this.setupPersistentVolume()
                            setTimeout(() => (coreSettings[CORE_SETTINGS_MAP.isMuted] = false));
                            // Should not be awaited
                            (async () => {
                                await waitForUserInteraction();

                                // If interaction was unmute button, try to not overtake it
                                // because it might result in mute -> unmute -> mute again.
                                // Different players require a different delay
                                await sleep(100);

                                if (player.muted) player.muted = false;
                            })();
                        }
                    }

                    throw e;
                }
            };

            const startTime = Date.now();
            let lastError = null;

            while ((Date.now() - startTime) < (10 * 1000)) {
                try {
                    await sleep(200);
                    await playOrFix();

                    restorePipIfNeeded(player).catch(e => console.warn(`[PiP] Unexpected restore error: ${e.message}`));
                    return;
                } catch (e) {
                    lastError = e;
                }
            }

            throw lastError;
        }

        setupDoubletapBehavior(player, doubletapTarget = player) {
            if (!mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior]) return;
            detectDoubletap(doubletapTarget, (ev) => {
                const xViewport = ev.clientX;
                const rect = ev.target.getBoundingClientRect();

                // Get X relative to the target just in case.
                // It is not really needed since the player takes the whole size of an iframe
                const xTarget = xViewport - rect.left;

                if (xTarget < rect.width * 0.35) {
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
                        player.currentTime -= advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
                    }
                } else if (xTarget > rect.width - (rect.width * 0.35)) {
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
                        player.currentTime += advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
                    }
                } else {
                    if (coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]) {
                        player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
                        if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
                            player.play();
                        }
                    }
                }
            }, {
                maxIntervalMs: advancedSettings[ADVANCED_SETTINGS_MAP.doubletapTimingThresholdMs],
                tapsDistanceThresholdPx: (
                    advancedSettings[ADVANCED_SETTINGS_MAP.doubletapDistanceThresholdPx]
                ),
            });
        }

        setupHotkeys(player) {
            keyboardJS.bind('space', () => player.paused ? player.play() : player.pause());
            if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward]) {
                keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastForward], () => {
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
                        player.currentTime += advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
                    }
                });
            }

            if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward]) {
                keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fastBackward], () => {
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS]) {
                        player.currentTime -= advancedSettings[ADVANCED_SETTINGS_MAP.fastForwardSizeS];
                    }
                });
            }

            if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen]) {
                keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.fullscreen], (ev) => {
                    ev.preventRepeat();
                    this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
                });
            }

            if (hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip]) {
                const cooldownTime = advancedSettings[ADVANCED_SETTINGS_MAP.largeSkipCooldownMs];
                let lastSkipTime = 0;

                keyboardJS.bind(hotkeysSettings[HOTKEYS_SETTINGS_MAP.largeSkip], () => {
                    if (coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]) {
                        const now = Date.now();

                        if (now - lastSkipTime < cooldownTime) return;

                        lastSkipTime = now;

                        console.log('[Keyboard Skip] Pressed. globalAniSkipData:', globalAniSkipData);

                        // Check if we have AniSkip data for intro
                        if (globalAniSkipData && globalAniSkipData.intro) {
                            // Use AniSkip intro end time
                            console.log('[Keyboard Skip] Using AniSkip time:', globalAniSkipData.intro.end);
                            player.currentTime = globalAniSkipData.intro.end;
                            if (advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                                Notiflix.Notify.success(i18n.aniSkipIntroDetected, {
                                    timeout: 1500,
                                    position: 'right-bottom'
                                });
                            }
                        } else {
                            // Fallback to manual skip size
                            console.log('[Keyboard Skip] Using fallback skip size:', coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS]);
                            player.currentTime += coreSettings[CORE_SETTINGS_MAP.currentLargeSkipSizeS];
                            if (globalAniSkipData === null && advancedSettings[ADVANCED_SETTINGS_MAP.useAniSkip] && advancedSettings[ADVANCED_SETTINGS_MAP.showAniSkipNotifications]) {
                                Notiflix.Notify.info(i18n.usingFallbackTimes, {
                                    timeout: 1500,
                                    position: 'right-bottom'
                                });
                            }
                        }

                        const skipBtn = document.querySelector('.SkipIntroBtn');
                        if (skipBtn) {
                            skipBtn.classList.add('invisible');
                            window.__skipIntroButtonDisabled = true;
                        }

                        if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
                            player.play();
                        }
                    }
                });
            }
        }

        setupOutroSkipHandling(player) {
            let outroHasBeenReached = false;
            let lastLoggedState = null;

            setInterval(() => {
                const autoplayOn = coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled];

                // Log state once when it changes so we can see it in the popup
                const stateKey = `${autoplayOn}|${outroHasBeenReached}`;
                if (stateKey !== lastLoggedState) {
                    lastLoggedState = stateKey;
                    console.log(`[Autoplay] OutroSkip state — autoplay: ${autoplayOn}, reached: ${outroHasBeenReached}, timeLeft: ${(player.duration - player.currentTime).toFixed(1)}s, threshold: ${coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS]}s`);
                }

                if (outroHasBeenReached || !autoplayOn) return;

                const timeLeft = player.duration - player.currentTime;

                if (timeLeft <= coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS]) {
                    outroHasBeenReached = true;
                    console.log(`[Autoplay] Threshold reached (${timeLeft.toFixed(1)}s left) — firing AUTOPLAY_NEXT`);

                    // Remember PiP state so the next episode can restore it
                    if (document.pictureInPictureElement) {
                        GM_setValue('aw_pip_restore', { _at: Date.now() });
                        console.log('[PiP] Active before autoplay — flagged for restoration on next episode');
                    }

                    this.messenger.sendMessage(IframeMessenger.messages.AUTOPLAY_NEXT);
                }
            }, 250);
        }

        setupAutoIntroSkip(player) {
            if (!coreSettings[CORE_SETTINGS_MAP.autoSkipIntro]) return;

            let introHasBeenSkipped = false;
            let hasStartedPlaying = false;

            const checkInterval = setInterval(() => {
                if (introHasBeenSkipped || !coreSettings[CORE_SETTINGS_MAP.autoSkipIntro]) {
                    clearInterval(checkInterval);
                    return;
                }

                const currentTime = player.currentTime;

                // Mark as started playing once we get past 0.5 seconds
                if (!hasStartedPlaying && currentTime > 0.5) {
                    hasStartedPlaying = true;
                }

                // Don't skip until we've actually started playing
                if (!hasStartedPlaying) return;

                // Only auto-skip if we have AniSkip data
                if (globalAniSkipData && globalAniSkipData.intro) {
                    // Skip when we're within the intro timeframe
                    if (currentTime >= globalAniSkipData.intro.start && currentTime < globalAniSkipData.intro.end) {
                        introHasBeenSkipped = true;
                        player.currentTime = globalAniSkipData.intro.end;

                        if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) {
                            player.play();
                        }
                        clearInterval(checkInterval);
                    }
                }
                // No fallback - auto-skip only works with AniSkip data
            }, 250);
        }

        setupAutoEdSkip(player) {
            if (!coreSettings[CORE_SETTINGS_MAP.autoSkipIntro]) return; // reuse autoSkipIntro setting for now
            let edHasBeenSkipped = false;
            const checkInterval = setInterval(() => {
                if (edHasBeenSkipped) { clearInterval(checkInterval); return; }
                if (!globalAniSkipData || !globalAniSkipData.outro) return;
                const t = player.currentTime;
                const { start, end } = globalAniSkipData.outro;
                if (t >= start && t < end) {
                    edHasBeenSkipped = true;
                    player.currentTime = end;
                    if (advancedSettings[ADVANCED_SETTINGS_MAP.playOnLargeSkip]) player.play();
                    clearInterval(checkInterval);
                }
            }, 250);
        }

        setupPersistentVolume(player) {
            player.muted = coreSettings[CORE_SETTINGS_MAP.isMuted];
            player.volume = coreSettings[CORE_SETTINGS_MAP.persistentVolumeLvl];

            player.addEventListener('volumechange', () => {
                coreSettings[CORE_SETTINGS_MAP.isMuted] = player.muted;
                coreSettings[CORE_SETTINGS_MAP.persistentVolumeLvl] = player.volume;
            });
        }

        setupWatchedStateLabeling(player) {
            const intervalMs = 250;
            let approximatePlayTimeS = 0;
            let currentVideoWasWatched = false;
            let lastPlayerTime = player.currentTime;
            setInterval(() => {
                if (player.currentTime === lastPlayerTime) return;

                lastPlayerTime = player.currentTime;
                approximatePlayTimeS += intervalMs / 1000;

                if (
                    !currentVideoWasWatched &&
                    advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS] &&
                    approximatePlayTimeS >= advancedSettings[ADVANCED_SETTINGS_MAP.markWatchedAfterS]
                ) {
                    currentVideoWasWatched = true;
                    this.messenger.sendMessage(IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED);
                }
            }, intervalMs);
        }

        async setupVideoPlaybackPositionMemory(player) {
            const self = this;
            await (async function waitForVideoData(start = Date.now()) {
                if (!self.currentVideoId || !self.topScopeDomainId) {
                    if ((Date.now() - start) > (10 * 1000)) {
                        throw new Error('Video data didn\'t arrive in time');
                    }

                    await sleep();

                    return waitForVideoData(start);
                }
            }());
            // This has to wait indefinitely because players like VOE do not have the value
            // until the play button has been pressed or an autoplay has been triggered
            await (async function waitForVideoDuration() {
                if (!player.duration) {
                    await sleep();
                    return waitForVideoDuration();
                }
            }());
            const timestampDataGMKey = (
                IframeInterface.makePlaybackPositionGMKey(this.topScopeDomainId, this.currentVideoId)
            );
            const timestampData = GM_getValue(timestampDataGMKey, {});

            if (timestampData.value) {
                const elapsedTime = Date.now() - timestampData.updateDate;
                const expirationThreshold = advancedSettings[
                    ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays
                ] * 24 * 60 * 60 * 1000;
                if (elapsedTime < expirationThreshold) {
                    const outroSkipThresholdS = coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS];
                    const potentialTimeLeftToPlay = player.duration - timestampData.value;

                    // Skip saved playback position if it's in a range of (outroSkipThresholdS + 20)
                    if (potentialTimeLeftToPlay > (outroSkipThresholdS + 20)) {
                        player.currentTime = timestampData.value;
                    }
                }
            }

            let lastCheckedTime = player.currentTime;
            setInterval(() => {
                if (
                    !mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory] ||
                    (player.currentTime === lastCheckedTime)
                ) return;

                lastCheckedTime = player.currentTime;

                GM_setValue(timestampDataGMKey, {
                    value: lastCheckedTime,
                    updateDate: Date.now(),
                });
            }, 1000);
        }
    }


    class VidozaIframeInterface extends IframeInterface {
        constructor(messenger) {
            super(messenger);
            waitForElement([
                'div[id^=asg-]',
                'div.prevent-first-click',
                'div.vjs-adblock-overlay',
                'iframe[data-asg-handled^="asg-"]',
                'iframe[style*="z-index: 2147483647"]',
            ].join(', '), {
                existing: true,
            }, (ads) => ads.remove());
            (function() {
                const originalAddEventListener = EventTarget.prototype.addEventListener;

                EventTarget.prototype.addEventListener = function(type, listener, options) {
                    // Get rid of ads
                    if (type === 'mousedown' && (this === document || this === unsafeWindow)) {
                        return;
                    }

                    return originalAddEventListener.call(this, type, listener, options);
                };
            }());
        }

        static get queries() {
            return {
                fullscreenBtn: 'button.vjs-fullscreen-control',
                player: 'video#player_html5_api.vjs-tech',
            };
        }

        async preparePlayer(player) {
            this.setupDoubletapBehavior(player);
            this.setupHotkeys(player);
            if (advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton]) {
                setupSkipIntroButton(player);
                setupSkipEdButton(player, this);
                setupFallbackOutroSkipButton(player, this.messenger, this);
            }

            addTimelineMarkers(player);
            this.setupOutroSkipHandling(player);
            this.setupAutoIntroSkip(player);
            this.setupAutoEdSkip(player);
            this.setupWatchedStateLabeling(player);
            this.setupVideoPlaybackPositionMemory(player);
            this.restylePlayer(player);

            let hasSkippedInitial = false;
            player.addEventListener('timeupdate', function autoStartSkip() {
                if (!hasSkippedInitial && coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart]) {
                    const skipSeconds = Number(coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart]) || 0;
                    if (player.currentTime < skipSeconds) {
                        player.currentTime = skipSeconds;
                    }
                    hasSkippedInitial = true;
                }
            });
            this.setupPersistentVolume(player);
            this.handleAutoplay(player); // should go after setupPersistentVolume

            // Attach autoplay button and change fullscreen button behavior...
            waitForElement(VidozaIframeInterface.queries.fullscreenBtn, {
                existing: true,
                onceOnly: true,
            }, (fsBtn) => {
                // Prevent focused buttons from being toggled by pressing space/enter
                fsBtn.parentElement.addEventListener('keydown', (ev) => ev.preventDefault());
                fsBtn.parentElement.addEventListener('keyup', (ev) => ev.preventDefault());

                const newFsBtn = fsBtn.cloneNode(true);
                const autoplayBtn = this.createAutoplayButton();

                autoplayBtn.style.paddingBottom = '1px';

                fsBtn.before(autoplayBtn);

                IS_SAFARI ? fsBtn.remove() : fsBtn.replaceWith(newFsBtn);

                if (IS_SAFARI === false) {
                    newFsBtn.addEventListener('click', () => {
                        this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
                    });
                    this.messenger.sendMessage(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
                }
            });
        }

        restylePlayer() {
            GM_addStyle([
                `
      div.vjs-resolution-button, button.vjs-disable-ads-button {
        display: none !important;
      }
    `,

                `
      div.video-js div.vjs-control-bar {
        background-color: unset !important;
      }
    `,

                `
      div.video-js .vjs-slider {
        background-color: rgb(112, 112, 112, 0.8) !important;
      }
    `,

                `
      div.video-js .vjs-play-progress {
        background-color: #2979ff !important;
        border-radius: 1em !important;
        height: 0.4em !important;
      }

      div.video-js .vjs-play-progress:before {
        font-size: 0.9em !important;
        top: -.25em !important;
      }
    `,

                `
      div.video-js .vjs-load-progress {
        background-color: #808080 !important;
        height: 0.4em !important;
      }
    `,

                `
      div.video-js .vjs-progress-control .vjs-progress-holder {
        height: 0.4em !important;
      }
    `,

                `
      div.video-js .vjs-time-control, div.vjs-playback-rate .vjs-playback-rate-value, div.vjs-resolution-button .vjs-resolution-button-label {
        line-height: 3em !important;
      }
    `,

                `
      div.video-js .vjs-big-play-button {
        background-color: rgb(0 132 255 / 75%) !important;
      }

      div.video-js .vjs-big-play-button:hover {
        background-color: rgb(40 160 255 / 95%) !important;
      }
    `,

                `
      div.video-js .vjs-progress-control:hover .vjs-mouse-display:after, div.video-js .vjs-progress-control:hover .vjs-play-progress:after, div.video-js .vjs-progress-control:hover .vjs-time-tooltip, div.video-js .vjs-volume-panel .vjs-volume-control.vjs-volume-vertical, div.vjs-menu-button-popup .vjs-menu .vjs-menu-content {
        background-color: rgb(0 132 255 / 75%) !important;
      }
    `,

                `
      #vplayer .video-js .vjs-time-control {
        padding-right: 3.5em !important;
      }
    `,

                `
      div.video-js .vjs-play-control {
        margin-left: 0.5em !important;
      }
    `,

                `
      div.video-js .vjs-progress-control {
        margin-left: 0.8em !important;
      }
    `,

                `
      div.video-js .vjs-fullscreen-control {
        margin-right: 0.5em !important;
      }
    `,
            ].join(' '));
            const currentTime = document.querySelector('div.vjs-current-time');
            const remainingTime = document.querySelector('div.vjs-remaining-time');

            remainingTime.replaceWith(currentTime);
        }

        updateFullscreenBtn({
            isInFullscreen
        }) {
            const player = document.querySelector(VidozaIframeInterface.queries.player);
            if (isInFullscreen) {
                player.parentElement.classList.add('vjs-fullscreen');
            } else {
                player.parentElement.classList.remove('vjs-fullscreen');
            }
        }
    }

    class VOEJWPIframeInterface extends IframeInterface {
        constructor(messenger) {
            super(messenger);
            const playbackPositionStorageKey = (
                `skip-forward-${location.pathname.split('/').pop()}`
            );
            try {
                this.builtinPlaybackPositionMemory = JSON.parse(localStorage.getItem(
                    playbackPositionStorageKey
                ));
            } catch {}

            localStorage.removeItem(playbackPositionStorageKey);
            waitForElement([
                'div.guestMode',
                'iframe[style*="z-index: 2147483647"]',
            ].join(', '), {
                existing: true,
            }, (ads) => ads.remove());
            (function() {
                const originalAddEventListener = EventTarget.prototype.addEventListener;

                EventTarget.prototype.addEventListener = function(type, listener, options) {
                    if (
                        // Get rid of ads
                        (['click', 'mousedown'].includes(type) && this === document) ||
                        // Intercept original hotkeys to avoid conflicts with the script hotkeys
                        (type === 'keydown' && this.matches && this.matches('div#vp'))
                    ) {
                        return;
                    }

                    // Intercept double-tap to fullscreen handler
                    if (
                        IS_MOBILE &&
                        mainSettings[MAIN_SETTINGS_MAP.overrideDoubletapBehavior] &&
                        (type === 'click' && this.matches && this.matches('div#vp > div > div.jw-media'))
                    ) {
                        let timerId = null;
                        return originalAddEventListener.call(this, type, () => {
                            clearTimeout(timerId);

                            const playerContainer = document.querySelector('div#vp');

                            if (playerContainer.classList.contains('jw-flag-user-inactive')) {
                                playerContainer.classList.remove('jw-flag-user-inactive');

                                timerId = setTimeout(() => {
                                    playerContainer.classList.add('jw-flag-user-inactive');
                                }, 2000);
                            } else {
                                playerContainer.classList.add('jw-flag-user-inactive');
                            }
                        }, options);
                    }

                    return originalAddEventListener.call(this, type, listener, options);
                };
            }());
        }

        static get queries() {
            return {
                fullscreenBtn: 'div.jw-tooltip-fullscreen',
                player: 'video.jw-video',
            };
        }

        async handleAutoplay(player) {
            if (!coreSettings[CORE_SETTINGS_MAP.isAutoplayEnabled]) return;

            // Don't auto-start if the user manually clicked an episode link
            const suppressEntry = GM_getValue('aw_suppress_autoplay_once', null);
            if (suppressEntry && (Date.now() - suppressEntry._at) < 30000) {
                GM_deleteValue('aw_suppress_autoplay_once');
                console.log('[Autoplay] Manual navigation detected — not auto-starting video');
                return;
            }
            GM_deleteValue('aw_suppress_autoplay_once'); // clean up stale entries

            const playTooSlowErr = 'play() was taking too long';
            let muteWasApplied = false;
            let playBtnWasClicked = false;
            // If play fails it tries to fix it but throws the problem error anyway
            const playOrFix = async () => {
                try {
                    // VOE play() either errors immediately
                    // or never resolves until a play button click
                    await Promise.race([
                        player.play(),
                        new Promise((_, reject) => {
                            setTimeout(() => reject(new Error(playTooSlowErr)), 150);
                        }),
                    ]);
                } catch (e) {
                    if (e.message === playTooSlowErr) {
                        if (playBtnWasClicked) throw e;
                        document.querySelector('div.jw-icon-display').click();
                        playBtnWasClicked = true;
                    } else if (e.name === 'NotAllowedError') {
                        // Muted usually is allowed to play,
                        // and if it's not allowed, nothing could be done here
                        if (player.muted) {
                            console.error('Muted and not allowed');
                            throw e;
                        }

                        if (mainSettings[MAIN_SETTINGS_MAP.shouldAutoplayMuted] && !muteWasApplied) {
                            player.muted = true;
                            muteWasApplied = true;

                            // Restore setting altered by forced mute.
                            // See this.setupPersistentVolume()
                            setTimeout(() => (coreSettings[CORE_SETTINGS_MAP.isMuted] = false));
                            // Should not be awaited
                            (async () => {
                                await waitForUserInteraction();

                                // If interaction was unmute button, try to not overtake it
                                // because it might result in mute -> unmute -> mute again.
                                // Different players require a different delay
                                await sleep(100);

                                if (player.muted) player.muted = false;
                            })();
                        }
                    }

                    throw e;
                }
            };

            const startTime = Date.now();
            let lastError = null;

            while ((Date.now() - startTime) < (10 * 1000)) {
                try {
                    await sleep(200);
                    await playOrFix();

                    restorePipIfNeeded(player).catch(e => console.warn(`[PiP] Unexpected restore error: ${e.message}`));
                    return;
                } catch (e) {
                    lastError = e;
                }
            }

            throw lastError;
        }

        async preparePlayer(player) {
            this.setupDoubletapBehavior(player);
            this.setupHotkeys(player);
            if (advancedSettings[ADVANCED_SETTINGS_MAP.showSkipIntroButton]) {
                setupSkipIntroButton(player);
                setupSkipEdButton(player, this);
                setupFallbackOutroSkipButton(player, this.messenger, this);
            }

            addTimelineMarkers(player);
            this.setupOutroSkipHandling(player);
            this.setupAutoIntroSkip(player);
            this.setupAutoEdSkip(player);
            this.setupWatchedStateLabeling(player);
            this.setupVideoPlaybackPositionMemory(player);

            let hasSkippedInitial = false;
            player.addEventListener('timeupdate', function autoStartSkip() {
                if (!hasSkippedInitial && coreSettings[CORE_SETTINGS_MAP.shouldAutoSkipOnStart]) {
                    const skipSeconds = Number(coreSettings[CORE_SETTINGS_MAP.autoSkipSecondsOnStart]) || 0;
                    if (player.currentTime < skipSeconds) {
                        player.currentTime = skipSeconds;
                    }
                    hasSkippedInitial = true;
                }
            });
            this.setupPersistentVolume(player);
            this.handleAutoplay(player); // should go after setupPersistentVolume

            // Attach autoplay button and change fullscreen button behavior...
            waitForElement(VOEJWPIframeInterface.queries.fullscreenBtn, {
                existing: true,
                onceOnly: true,
            }, (fsBtn) => {
                fsBtn = fsBtn.parentElement;

                const newFsBtn = fsBtn.cloneNode(true);
                const autoplayBtn = this.createAutoplayButton();

                autoplayBtn.style.width = '44px';
                autoplayBtn.style.height = '44px';
                autoplayBtn.style.paddingTop = '3px';
                autoplayBtn.style.flex = '0 0 auto';
                autoplayBtn.style.outline = 'none';

                fsBtn.before(autoplayBtn);

                IS_SAFARI ? fsBtn.remove() : fsBtn.replaceWith(newFsBtn);

                if (IS_SAFARI === false) {
                    newFsBtn.addEventListener('click', () => {
                        this.messenger.sendMessage(IframeMessenger.messages.TOGGLE_FULLSCREEN);
                    });
                    this.messenger.sendMessage(IframeMessenger.messages.REQUEST_FULLSCREEN_STATE);
                }
            });
        }

        async setupVideoPlaybackPositionMemory(player) {
            const self = this;
            await (async function waitForVideoData(start = Date.now()) {
                if (!self.currentVideoId || !self.topScopeDomainId) {
                    if ((Date.now() - start) > (10 * 1000)) {
                        throw new Error('Video data didn\'t arrive in time');
                    }

                    await sleep();

                    return waitForVideoData(start);
                }
            }());
            const timestampDataGMKey = (
                IframeInterface.makePlaybackPositionGMKey(this.topScopeDomainId, this.currentVideoId)
            );
            if (
                this.builtinPlaybackPositionMemory &&
                this.builtinPlaybackPositionMemory.value
            ) {
                const {
                    expire,
                    value
                } = this.builtinPlaybackPositionMemory;
                let updateDate = Date.now();

                // 10 days is the built in position memory expiration time
                if (expire) {
                    updateDate = (
                        new Date((new Date(expire)).getTime() - 10 * 24 * 60 * 60 * 1000).getTime()
                    );
                }

                GM_setValue(timestampDataGMKey, {
                    value,
                    updateDate
                });
            }

            // This has to wait indefinitely because players like VOE do not have the value
            // until the play button has been pressed or an autoplay has been triggered
            await (async function waitForVideoDuration() {
                if (!player.duration) {
                    await sleep();
                    return waitForVideoDuration();
                }
            }());
            const timestampData = GM_getValue(timestampDataGMKey, {});

            if (timestampData.value) {
                const elapsedTime = Date.now() - timestampData.updateDate;
                const expirationThreshold = advancedSettings[
                    ADVANCED_SETTINGS_MAP.playbackPositionExpirationDays
                ] * 24 * 60 * 60 * 1000;
                if (elapsedTime < expirationThreshold) {
                    const outroSkipThresholdS = coreSettings[CORE_SETTINGS_MAP.currentOutroSkipThresholdS];
                    const potentialTimeLeftToPlay = player.duration - timestampData.value;

                    // Skip saved playback position if it's in a range of (outroSkipThresholdS + 20)
                    if (potentialTimeLeftToPlay > (outroSkipThresholdS + 20)) {
                        player.currentTime = timestampData.value;
                    }
                }
            }

            let lastCheckedTime = player.currentTime;
            setInterval(() => {
                if (
                    !mainSettings[MAIN_SETTINGS_MAP.playbackPositionMemory] ||
                    (player.currentTime === lastCheckedTime)
                ) return;

                lastCheckedTime = player.currentTime;

                GM_setValue(timestampDataGMKey, {
                    value: lastCheckedTime,
                    updateDate: Date.now(),
                });
            }, 1000);
        }

        updateFullscreenBtn({
            isInFullscreen
        }) {
            const fsBtn = document.querySelector(VOEJWPIframeInterface.queries.fullscreenBtn);
            if (isInFullscreen) {
                fsBtn.parentElement.classList.add('jw-off');
            } else {
                fsBtn.parentElement.classList.remove('jw-off');
            }
        }
    }

    class TopScopeInterface {
        constructor() {
            this.commLink = null;
            this.currentIframeId = null;
            this.domainId = TOP_SCOPE_DOMAINS_IDS[location.hostname] || '';
            this.iframeSrcChangesListener = null;
            this.id = makeId();
            this.ignoreIframeSrcChangeOnce = false;
            this.isPendingConnection = false;
            // Ugly shitcode fix for a playback positions. This assigns their value
            // to both the aniworld and s.to at the same time.
            // This is needed because these prefixes were missing before v4.8.3
            // causing saved positions being shared between different websites
            if (!GM_getValue('playbackPositionsMemory482wereFixed', false)) {
                this.applyPlaybackPositionsFix();
                GM_setValue('playbackPositionsMemory482wereFixed', true);
            }
        }

        static get messages() {
            return {
                CURRENT_FRANCHISE_DATA: 'CURRENT_FRANCHISE_DATA',
                FULLSCREEN_STATE: 'FULLSCREEN_STATE',
            };
        }

        static get queries() {
            // New S.to layout detection - check all S.to domains
            const newSto = STO_DOMAINS.includes(location.hostname) && !!document.querySelector('#player-iframe');

            if (newSto) {
                // New S.to layout queries
                return {
                    animeTitle: 'h1.h2.fw-bold, .breadcrumb-item.show-name a',
                    episodeDedicatedLink: null, // Not used in new layout
                    episodeTitle: '#player-meta', // Contains data-episode-id
                    hostersPlayerContainer: '.player-wrap',
                    navLinksContainer: '#episode-nav',
                    playerIframe: '#player-iframe',
                    providerChangeBtn: '#episode-links .link-box',
                    providerName: '#episode-links .link-box', // Provider name is in data-provider-name
                    providersList: '#episode-links',
                    selectedLanguageBtn: '#episode-links .link-box.active',
                    // New S.to specific queries
                    nextEpisodeLink: 'a.btn-link[href*="episode"]',
                    seasonNav: '[data-season-pill]',
                    playerMeta: '#player-meta',
                };
            }

            // Old aniworld.to / legacy S.to layout queries
            return {
                animeTitle: 'div.hostSeriesTitle',
                episodeDedicatedLink: 'div.hosterSiteVideo a.watchEpisode',
                episodeTitle: 'div.hosterSiteTitle',
                hostersPlayerContainer: 'div.hosterSiteVideo',
                navLinksContainer: 'div#stream.hosterSiteDirectNav',
                playerIframe: 'div.inSiteWebStream iframe',
                providerChangeBtn: 'div.generateInlinePlayer',
                providerName: 'div.hosterSiteVideo > ul a > h4',
                providersList: 'div.hosterSiteVideo > ul',
                selectedLanguageBtn: 'img.selectedLanguage',
            };
        }

        applyPlaybackPositionsFix() {
            const oldPlaybackPositionsGMPrefix = 'playbackTimestamp_';
            const oldPlaybackPositionsKeys = (
                GM_listValues().filter(
                    v => v.startsWith(oldPlaybackPositionsGMPrefix) && v.split('_').length === 2
                )
            );
            const uniqueTopScopeDomainsIds = [...new Set(Object.values(TOP_SCOPE_DOMAINS_IDS))];

            for (const oldKey of oldPlaybackPositionsKeys) {
                const episodeId = oldKey.slice(oldPlaybackPositionsGMPrefix.length);
                const oldValue = GM_getValue(oldKey);

                for (const domainId of uniqueTopScopeDomainsIds) {
                    const newKey = IframeInterface.makePlaybackPositionGMKey(domainId, episodeId);
                    GM_setValue(newKey, oldValue);
                }

                GM_deleteValue(oldKey);
            }
        }

        // It is better not to be async
        handleIframeMessages(packet) {
            (async function() {
                try {
                    switch (packet.command) {
                        case IframeMessenger.messages.AUTOPLAY_NEXT: {
                            // This is here because it bugges out the episodes navigation panel
                            // if try and use MARK_CURRENT_VIDEO_WATCHED. Watched episode is being
                            // marked as non watched
                            try {
                                await this.markCurrentVideoWatched();
                            } catch (e) {
                                console.error(e);
                            }

                            try {
                                await this.goToNextVideo();
                            } catch (e) {
                                console.error(e);

                                Notiflixx.notify.warning(
                                    `${GM_info.script.name}: ${i18n.autoplayError}`
                                );
                            }

                            break;
                        }

                        case IframeMessenger.messages.REQUEST_CURRENT_FRANCHISE_DATA: {
                            let episodeId, releaseYear, title, slug, episodeNumber, seasonNumber;

                            // Check if we're on the new S.to layout
                            const newStoLayout = isNewStoLayout();

                            if (newStoLayout) {
                                // New S.to layout
                                const playerMeta = document.querySelector('#player-meta');
                                episodeId = playerMeta?.dataset.episodeId;
                                seasonNumber = playerMeta?.dataset.seasonNo;
                                episodeNumber = playerMeta?.dataset.episodeNo;

                                // Get title from breadcrumb or h1
                                const titleEl = document.querySelector('.breadcrumb-item.show-name a') ||
                                               document.querySelector('h1.h2.fw-bold');
                                title = titleEl?.textContent?.trim() || null;

                                // Get release year from sidebar if available
                                const yearEl = document.querySelector('.text-muted a[href*="/jahr/"]');
                                releaseYear = yearEl?.textContent?.trim() || '';

                                // Extract slug from URL (new format: /serie/slug-name/staffel-X/episode-Y)
                                slug = location.pathname.match(/^\/serie\/([^/]+)/)?.[1] || null;
                            } else {
                                // Old aniworld.to / legacy S.to layout
                                episodeId = document.querySelector(
                                    TopScopeInterface.queries.episodeTitle
                                )?.dataset?.episodeId;
                                releaseYear = document.querySelector(
                                    'div.series-title span[itemprop="startDate"]'
                                )?.innerText || '';
                                title = document.querySelector('div.series-title > h1')?.innerText || null;

                                // Extract slug, season, and episode number for AniSkip
                                slug = location.pathname.match(/^\/anime\/stream\/([^/]+)/)?.[1] || null;
                                episodeNumber = location.pathname.match(/\/episode-(\d+)\b/i)?.[1] || null;
                                seasonNumber = location.pathname.match(/\/staffel-(\d+)\b/i)?.[1] || null;
                            }

                            const currentFranchiseId = (
                                title ? `${title}${releaseYear ? `::${releaseYear}` : ''}` : null
                            );

                            if (currentFranchiseId || episodeId) {
                                this.commLink.commands[
                                    TopScopeInterface.messages.CURRENT_FRANCHISE_DATA
                                ]({
                                    currentFranchiseId,
                                    currentVideoId: episodeId || null,
                                    topScopeDomainId: this.domainId,
                                    // Add AniSkip-related data
                                    animeTitle: title || null,
                                    animeSlug: slug,
                                    episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : null,
                                    seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : null,
                                });
                            }

                            break;
                        }

                        // Would not work on Safari
                        // but this should not be called on Safari anyway
                        case IframeMessenger.messages.REQUEST_FULLSCREEN_STATE: {
                            if (IS_SAFARI) break;
                            this.commLink.commands[TopScopeInterface.messages.FULLSCREEN_STATE]({
                                isInFullscreen: !!document.fullscreenElement,
                            });
                            break;
                        }

                        case IframeMessenger.messages.MARK_CURRENT_VIDEO_WATCHED: {
                            await this.markCurrentVideoWatched();
                            break;
                        }

                        case IframeMessenger.messages.OPEN_HOTKEYS_GUIDE: {
                            let content = [
                                '<h5>🔹 Basic hotkeys</h5>',
                                '<div><b>Single key: </b><pre>a</pre> → Triggers when <pre>a</pre> is pressed</div>',
                                '<div><b>Combo keys: </b><pre>ctrl + shift + a</pre> → Triggers when all keys are held together</div>',
                                '<h5>🔹 Sequences (pressing keys in order)</h5>',
                                '<div><b>Sequence: </b><pre>a > b</pre> → Press <pre>a</pre>, then <pre>b</pre></div>',
                                '<div><b>Chained sequence: </b><pre>ctrl + a > b</pre> → Hold <pre>ctrl</pre>, press <pre>a</pre>, release, then press <pre>b</pre></div>',
                                '<h5>🔹 Multiple options</h5>',
                                '<div><pre>a + b > c, x + y > z</pre> → Either <pre>a</pre> & <pre>b</pre> then <pre>c</pre> OR <pre>x</pre> & <pre>y</pre> then <pre>z</pre></div>',
                                '<h5>🔹 Special keys (most of them)</h5>',
                            ].join('');
                            content += [
                                'cancel', 'backspace', 'tab', 'clear', 'enter', 'shift', 'ctrl',
                                'alt', 'menu', 'pause', 'break', 'capslock', 'pageup', 'pagedown',
                                'space', 'spacebar', 'escape', 'esc', 'end', 'home', 'left', 'up',
                                'right', 'down', 'select', 'printscreen', 'execute', 'snapshot',
                                'insert', 'ins', 'delete', 'del', 'help', 'scrolllock', 'scroll',
                                'comma', ',', 'period', '.', 'openbracket', '[', 'backslash', '\\',
                                'slash', 'forwardslash', '/', 'closebracket', ']', 'apostrophe',
                                '\'', 'zero', '0', 'one', '1', 'two', '2', 'three', '3', 'four',
                                '4', 'five', '5', 'six', '6', 'seven', '7', 'eight', '8', 'nine',
                                '9', 'numzero', 'num0', 'numone', 'num1', 'numtwo', 'num2',
                                'numthree', 'num3', 'numfour', 'num4', 'numfive', 'num5', 'numsix',
                                'num6', 'numseven', 'num7', 'numeight', 'num8', 'numnine', 'num9',
                                'nummultiply', 'num*', 'numadd', 'num+', 'numenter', 'numsubtract',
                                'num-', 'numdecimal', 'num.', 'numdivide', 'num/', 'numlock', 'num',
                                'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11',
                                'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19', 'f20', 'f21',
                                'f22', 'f23', 'f24', 'tilde', '~', 'exclamation', 'exclamationpoint',
                                '!', 'at', '@', 'number', '#', 'dollar', 'dollars', 'dollarsign',
                                '$', 'percent', '%', 'caret', '^', 'ampersand', 'and', '&', 'asterisk',
                                '*', 'openparen', '(', 'closeparen', ')', 'underscore', '_', 'plus',
                                '+', 'opencurlybrace', 'opencurlybracket', '{', 'closecurlybrace',
                                'closecurlybracket', '}', 'verticalbar', '|', 'colon', ':',
                                'quotationmark', '\'', 'openanglebracket', '<', 'closeanglebracket',
                                '>', 'questionmark', '?', 'semicolon', ';', 'dash', '-', 'equal',
                                'equalsign', '=',
                            ].map(s => `<pre>${s}</pre>`).join(' ');
                            const modal = document.createElement('div');

                            modal.className = 'notiflix-hotkeys-guide-modal';
                            modal.innerHTML = content;
                            Notiflixx.report.info(i18n.hotkeysGuide, modal.outerHTML, i18n.close, {
                                backOverlayClickToClose: true,
                                messageMaxLength: Infinity,
                                plainText: false,
                            });
                            break;
                        }

                        // Would not work on Safari
                        // but this should not be called from Safari anyway
                        case IframeMessenger.messages.TOGGLE_FULLSCREEN: {
                            if (IS_SAFARI) break;
                            // Notice how this then triggers a listener from this.init()
                            if (document.fullscreenElement) {
                                await document.exitFullscreen();
                            } else {
                                await document.documentElement.requestFullscreen();
                            }

                            break;
                        }

                        case IframeMessenger.messages.TOP_NOTIFLIX_REPORT_INFO: {
                            Notiflixx.report.info(...packet.data.args);
                            break;
                        }

                        // Not sure if anything except providersPriority needs to be in sync witn an iframe
                        case IframeMessenger.messages.UPDATE_CORE_SETTINGS: {
                            coreSettings.update();
                            break;
                        }

                        default:
                            break;
                    }
                } catch (e) {
                    console.error(e);
                }
            }.bind(this)());
            return {
                status: `${this.constructor.name} received a message`,
            };
        }

        async init(iframe) {
            this.iframeSrcChangesListener = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.attributeName === 'src') {
                        if (this.ignoreIframeSrcChangeOnce) {
                            this.ignoreIframeSrcChangeOnce = false;

                            return;
                        }

                        this.unregisterCommlinkListener();
                        this.initCrossFrameConnection();
                    }
                }
            }).observe(iframe, {
                attributes: true
            });

            await this.initCrossFrameConnection();

            if (IS_SAFARI) {
                this.adaptFakeFullscreen();
                window.addEventListener('orientationchange', () => {
                    setTimeout(() => this.adaptFakeFullscreen(), 100);
                });
            } else {
                document.addEventListener('fullscreenchange', () => {
                    this.adaptFakeFullscreen();
                    this.commLink.commands[TopScopeInterface.messages.FULLSCREEN_STATE]({
                        isInFullscreen: !!document.fullscreenElement,
                    });
                });
            }
        }

        async initCrossFrameConnection() {
            if (this.isPendingConnection) throw new Error('Connecting already');
            this.isPendingConnection = true;

            let timeoutId;

            const iframeId = this.currentIframeId = await new Promise((resolve, reject) => {
                const valueChangeListenerId = GM_addValueChangeListener('unboundIframeId', (
                    _key,
                    _oldValue,
                    newValue,
                ) => {
                    const iframe = document.querySelector(TopScopeInterface.queries.playerIframe);

                    // Skip if top scope is a wrong one
                    if (!iframe) return;

                    GM_removeValueChangeListener(valueChangeListenerId);
                    clearTimeout(timeoutId);
                    resolve(newValue);
                });

                timeoutId = setTimeout(() => {
                    this.isPendingConnection = false;

                    GM_removeValueChangeListener(valueChangeListenerId);
                    reject(new Error('Iframe connection timeout'));
                }, 4 * 1000);
            });
            GM_setValue(iframeId, this.id);

            this.commLink = new CommLinkHandler(this.id, {
                silentMode: true,
                statusCheckInterval: advancedSettings[ADVANCED_SETTINGS_MAP.commlinkPollingIntervalMs],
            });
            this.commLink.registerSendCommand(TopScopeInterface.messages.CURRENT_FRANCHISE_DATA);
            this.commLink.registerSendCommand(TopScopeInterface.messages.FULLSCREEN_STATE);

            this.commLink.registerListener(iframeId, this.handleIframeMessages.bind(this));

            this.isPendingConnection = false;
        }


        adaptFakeFullscreen() {
            const Q = TopScopeInterface.queries;
            const hostersPlayerContainer = document.querySelector(Q.hostersPlayerContainer);
            const playerIframe = document.querySelector(Q.playerIframe);

            if (!hostersPlayerContainer || !playerIframe) return;

            const newStoLayout = isNewStoLayout();

            // Consider landscape mode as fullscreen on Safari
            const isInFullscreen = (
                IS_SAFARI ? window.innerWidth > window.innerHeight : !!document.fullscreenElement
            );
            if (isInFullscreen) {
                document.body.style.overflow = 'hidden';

                if (newStoLayout) {
                    // Hide the navbar and other fixed elements during fullscreen
                    const navbar = document.querySelector('nav.navbar');
                    if (navbar) {
                        navbar.dataset.prevDisplay = navbar.style.display;
                        navbar.style.display = 'none';
                    }

                    // New S.to layout - ensure container and iframe fill the screen
                    hostersPlayerContainer.style.cssText = (
                        'z-index: 2147483647 !important; position: fixed !important; ' +
                        'top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; ' +
                        'width: 100vw !important; height: 100vh !important; ' +
                        'padding: 0 !important; margin: 0 !important; ' +
                        'overflow: hidden !important; background: #000 !important;'
                    );
                    playerIframe.style.cssText = (
                        'display: block !important; position: absolute !important; ' +
                        'top: 0 !important; left: 0 !important; ' +
                        'width: 100vw !important; height: 100vh !important; ' +
                        'min-height: 100vh !important; min-width: 100vw !important; ' +
                        'border: 0 !important; border-width: 0 !important;'
                    );
                    // Hide the loading overlay
                    const loadingOverlay = document.querySelector('#player-loading');
                    if (loadingOverlay) {
                        loadingOverlay.style.display = 'none';
                    }
                } else {
                    // Old layout
                    playerIframe.style.setProperty('height', '100vh', 'important');
                    if (hostersPlayerContainer.firstElementChild) {
                        hostersPlayerContainer.firstElementChild.style.display = 'none';
                    }
                    hostersPlayerContainer.style.cssText = (
                        'z-index: 100; position: fixed; top: 0; left: 0; padding: 0; height: 100vh; overflow-y: scroll; scrollbar-width: none;'
                    );
                }
            } else {
                document.body.style.overflow = '';

                if (newStoLayout) {
                    // Restore the navbar
                    const navbar = document.querySelector('nav.navbar');
                    if (navbar) {
                        navbar.style.display = navbar.dataset.prevDisplay || '';
                        delete navbar.dataset.prevDisplay;
                    }

                    // Reset new S.to layout styles - restore proper player dimensions
                    hostersPlayerContainer.style.cssText = '';
                    // Restore iframe to proper embedded size
                    playerIframe.style.cssText = 'display: inline-block; min-height: 450px;';

                    // Restore loading overlay
                    const loadingOverlay = document.querySelector('#player-loading');
                    if (loadingOverlay) {
                        loadingOverlay.style.display = '';
                    }
                } else {
                    // Reset old layout styles
                    playerIframe.style.height = '';
                    if (hostersPlayerContainer.firstElementChild) {
                        hostersPlayerContainer.firstElementChild.style.display = '';
                    }
                    hostersPlayerContainer.scrollTop = 0;
                    hostersPlayerContainer.style.cssText = '';
                }
            }
        }

        async announceEpisodeWatched(id) {
            if (!id) throw new Error('Episode ID is missing');
            await fetch(`${location.protocol}//${location.hostname}/ajax/lastseen`, {
                method: 'POST',
                body: `episode=${id}`,
                headers: {
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
            });
        }

        async goToNextVideo() {
            const Q = TopScopeInterface.queries;
            const newStoLayout = isNewStoLayout();
            console.log('[Autoplay] goToNextVideo() called — layout:', newStoLayout ? 'new STO' : 'old/aniworld', '— url:', location.pathname);

            let nextEpisodeHref = null;

            if (newStoLayout) {
                // New S.to layout - use the next episode link button
                const nextLinks = [...document.querySelectorAll('a.btn-link[href*="episode"]')];
                const nextLink = nextLinks.find(link => link.textContent.includes('→'));

                if (nextLink) {
                    nextEpisodeHref = nextLink.href;
                } else {
                    // Try to find next season's first episode
                    const seasonPills = [...document.querySelectorAll('[data-season-pill]')];
                    const currentSeasonPill = seasonPills.find(el => el.classList.contains('bg-primary'));
                    const currentIndex = seasonPills.indexOf(currentSeasonPill);

                    if (currentIndex >= 0 && currentIndex < seasonPills.length - 1) {
                        const nextSeasonHref = seasonPills[currentIndex + 1].href;
                        const nextSeasonHtml = await (await fetch(nextSeasonHref)).text();
                        const nextSeasonDom = (new DOMParser()).parseFromString(nextSeasonHtml, 'text/html');
                        const firstEpisodeLink = nextSeasonDom.querySelector('#episode-nav .nav-link');
                        if (firstEpisodeLink) {
                            nextEpisodeHref = firstEpisodeLink.href;
                        }
                    }
                }
            } else {
                // Old aniworld.to / legacy S.to layout
                const navLists = document.querySelectorAll(`${Q.navLinksContainer} > ul`);
                const seasonsNav = navLists[0] || null;
                const episodesNav = navLists[1] || null;
                console.log('[Autoplay] Nav DOM: found', navLists.length, 'nav lists under', Q.navLinksContainer);

                if (seasonsNav && episodesNav) {
                    const episodesNavLinks = [...episodesNav.querySelectorAll('a')];
                    const seasonNavLinks = [...seasonsNav.querySelectorAll('a')];
                    const currentEpisodeIndex = episodesNavLinks.findIndex(el => el.classList.contains('active'));
                    const currentSeasonIndex = seasonNavLinks.findIndex(el => el.classList.contains('active'));
                    console.log('[Autoplay] Nav DOM: ep index', currentEpisodeIndex, 'of', episodesNavLinks.length, ', season index', currentSeasonIndex, 'of', seasonNavLinks.length);

                    if (currentEpisodeIndex < episodesNavLinks.length - 1) {
                        nextEpisodeHref = episodesNavLinks[currentEpisodeIndex + 1].href;
                    } else if (currentSeasonIndex < seasonNavLinks.length - 1) {
                        // Do not proceed if this is a last movie
                        // so it wont hop in to a season from a movie
                        if (seasonNavLinks[currentSeasonIndex].href.endsWith('/filme')) return;
                        const nextSeasonHref = seasonNavLinks[currentSeasonIndex + 1].href;
                        const nextSeasonHtml = await (await fetch(nextSeasonHref)).text();
                        const nextSeasonDom = (new DOMParser()).parseFromString(nextSeasonHtml, 'text/html');
                        const firstEpisodeLink = nextSeasonDom.querySelector(
                            `${Q.navLinksContainer} > ul a[data-episode-id]`
                        );
                        if (firstEpisodeLink) nextEpisodeHref = firstEpisodeLink.href;
                    }
                }

                // URL-based fallback for aniworld.to when nav DOM elements are missing
                if (!nextEpisodeHref) {
                    console.log('[Autoplay] Nav DOM gave no result — trying URL-based fallback');
                    const urlMatch = location.pathname.match(
                        /^\/anime\/stream\/([^/]+)\/(staffel-(\d+))\/episode-(\d+)$/i
                    );
                    if (urlMatch) {
                        const [, slug, staffelStr, seasonNumStr, epNumStr] = urlMatch;
                        const nextEpNum = parseInt(epNumStr) + 1;
                        const nextEpHref = `${location.origin}/anime/stream/${slug}/${staffelStr}/episode-${nextEpNum}`;
                        try {
                            const testResp = await fetch(nextEpHref);
                            await testResp.text();
                            if (testResp.ok && /\/episode-\d+/.test(new URL(testResp.url).pathname)) {
                                nextEpisodeHref = nextEpHref;
                                console.log('[Autoplay] URL-based nav: next episode', nextEpisodeHref);
                            } else {
                                // End of season — try first episode of next season
                                const nextSeasonNum = parseInt(seasonNumStr) + 1;
                                const nextSeasonHref = `${location.origin}/anime/stream/${slug}/staffel-${nextSeasonNum}`;
                                const seasonResp = await fetch(nextSeasonHref);
                                if (seasonResp.ok) {
                                    const seasonDom = new DOMParser().parseFromString(
                                        await seasonResp.text(), 'text/html'
                                    );
                                    const firstEpLink = [...seasonDom.querySelectorAll('a[href*="/anime/stream/"]')]
                                        .find(a => new RegExp(`/staffel-${nextSeasonNum}/episode-1$`).test(
                                            a.getAttribute('href') || ''
                                        ));
                                    if (firstEpLink) {
                                        nextEpisodeHref = new URL(
                                            firstEpLink.getAttribute('href'), location.origin
                                        ).href;
                                        console.log('[Autoplay] URL-based nav: next season', nextEpisodeHref);
                                    }
                                }
                            }
                        } catch (navErr) {
                            console.warn('[Autoplay] URL-based nav error:', navErr.message);
                        }
                    }
                }
            }

            // Seems like the last episode was reached
            if (!nextEpisodeHref) return;
            const nextEpisodeHtml = await (await fetch(nextEpisodeHref)).text();
            const nextEpisodeDom = (new DOMParser()).parseFromString(nextEpisodeHtml, 'text/html');

            if (newStoLayout) {
                // New S.to layout - update DOM elements
                const elementsToUpdate = [
                    '#player-meta',
                    '#episode-links',
                    '#episode-nav',
                    'h1.h2.fw-bold',
                    'h2.h4.mb-1', // Episode title
                    '.background-1.border-radius-top-1', // Top navigation bar with prev/next
                ];

                elementsToUpdate.forEach((query) => {
                    const currentElement = document.querySelector(query);
                    const newElement = nextEpisodeDom.querySelector(query);
                    if (currentElement && newElement) {
                        currentElement.outerHTML = newElement.outerHTML;
                    }
                });
            } else {
                // Old layout - Update current DOM from a next episode DOM
                ([
                    'div#wrapper > div.seriesContentBox > div.container.marginBottom > ul',
                    'div#wrapper > div.seriesContentBox > div.container.marginBottom > div.cf',
                    'div.changeLanguageBox',
                    `${Q.episodeTitle} > ul`,
                    Q.animeTitle,
                    Q.episodeTitle,
                    Q.navLinksContainer,
                    Q.providersList,
                ]).forEach((query) => {
                    const currentElement = document.querySelector(query);
                    const newElement = nextEpisodeDom.querySelector(query);

                    if (currentElement && newElement) {
                        currentElement.outerHTML = newElement.outerHTML;
                    }
                });
            }

            document.title = nextEpisodeDom.title;
            history.pushState({}, '', nextEpisodeHref);

            try {
                if (newStoLayout) {
                    // New S.to layout - setup provider click handlers
                    this.setupNewStoProviderHandlers();

                    // Get selected language and find preferred provider
                    const selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];
                    const providerButtons = [...document.querySelectorAll('#episode-links .link-box')];

                    // Filter by language if specified
                    let filteredButtons = providerButtons;
                    if (selectedLanguage) {
                        filteredButtons = providerButtons.filter(btn =>
                            btn.dataset.languageId === selectedLanguage
                        );
                        if (filteredButtons.length === 0) {
                            filteredButtons = providerButtons;
                        }
                    }

                    let nextVideoHref = null;
                    let nextProviderName = null;

                    // Find preferred provider
                    for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                        const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
                        const matchingBtn = filteredButtons.find(btn =>
                            btn.dataset.providerName === preferredProviderName
                        );
                        if (matchingBtn) {
                            nextVideoHref = matchingBtn.dataset.playUrl;
                            nextProviderName = matchingBtn.dataset.providerName;
                            break;
                        }
                    }

                    // Fallback to first available
                    if (!nextVideoHref && filteredButtons.length > 0) {
                        nextVideoHref = filteredButtons[0].dataset.playUrl;
                        nextProviderName = filteredButtons[0].dataset.providerName;
                    }

                    if (!nextVideoHref) throw new Error('Embedded providers are missing or not supported');

                    document.querySelector('#player-iframe').src = nextVideoHref;
                    console.log('[Autoplay] Successfully changed iframe src to:', nextVideoHref);
                } else {
                    // Old layout - The website code copypasta to try and restore various buttons functionality
                    (function repairWebsiteFeatures() {
                        document.querySelectorAll(Q.providerChangeBtn).forEach((btn) => {
                            btn.addEventListener('click', (ev) => {
                                ev.preventDefault();

                                const parent = btn.parentElement;
                                const linkTarget = parent.getAttribute('data-link-target');
                                const hosterTarget = parent.getAttribute('data-external-embed') === 'true';
                                const fakePlayer = document.querySelector('.fakePlayer');
                                const inSiteWebStream = document.querySelector('.inSiteWebStream');
                                const iframe = inSiteWebStream.querySelector('iframe');

                                if (hosterTarget) {
                                    fakePlayer.style.display = 'block';
                                    inSiteWebStream.style.display = 'inline-block';
                                    iframe.style.display = 'none';
                                } else {
                                    fakePlayer.style.display = 'none';
                                    inSiteWebStream.style.display = 'inline-block';
                                    iframe.src = linkTarget;
                                    iframe.style.display = 'inline-block';
                                }
                            });
                        });
                    }());

                    const {
                        selectedLanguage
                    } = this.updateVideoLanguageProcessing();
                    const preferredProvidersButtons = [
                        ...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn)
                    ].filter(el => el.parentElement.dataset.langKey === selectedLanguage);
                    console.log('[Autoplay] Old layout provider: lang', selectedLanguage, ', generateInlinePlayer buttons:', preferredProvidersButtons.length);
                    let nextProviderName = null;
                    let nextVideoLink = null;

                    if (preferredProvidersButtons.length) {
                        outer: for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                            const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
                            for (const btn of preferredProvidersButtons) {
                                const link = btn.firstElementChild;
                                const providerName = link.querySelector(
                                    TopScopeInterface.queries.providerName
                                ).innerText;
                                if (providerName === preferredProviderName) {
                                    nextProviderName = providerName;
                                    nextVideoLink = link;

                                    break outer;
                                }
                            }
                        }
                    }

                    let nextVideoHref = nextVideoLink?.href;
                    // VOE has an additional redirect page,
                    // so need to extract the video href from there first
                    // in order to keep VOE-to-VOE autoplay unmuted
                    if (nextVideoHref && nextProviderName === VIDEO_PROVIDERS_MAP.VOE) {
                        const corsProxy =
                            advancedSettings[ADVANCED_SETTINGS_MAP.corsProxy];

                        if (corsProxy) {
                            nextVideoHref = /location\.href = '(https:\/\/.+)';/.exec(
                                await (await fetch(corsProxy + nextVideoLink.href)).text()
                            )[1];
                        }
                    }

                    // Fallback: follow /redirect/{ID} links from fetched next episode HTML
                    // (handles new aniworld.to structure where generateInlinePlayer no longer exists)
                    if (!nextVideoHref) {
                        const redirectLinks = [...nextEpisodeDom.querySelectorAll('a[href*="/redirect/"]')];
                        if (redirectLinks.length > 0) {
                            console.log('[Autoplay] Trying redirect-based provider selection,', redirectLinks.length, 'links');
                            const resolvedLinks = await Promise.all(
                                redirectLinks.map(link => new Promise(resolve => {
                                    const href = link.getAttribute('href');
                                    const fullUrl = href.startsWith('http') ? href : `${location.origin}${href}`;
                                    GM_xmlhttpRequest({
                                        method: 'HEAD',
                                        url: fullUrl,
                                        onload: r => resolve({ finalUrl: r.finalUrl }),
                                        onerror: () => resolve(null),
                                        timeout: 5000,
                                    });
                                }))
                            );
                            const resolvedDomains = resolvedLinks.map(r => {
                                try { return r?.finalUrl ? new URL(r.finalUrl).hostname : null; } catch (_) { return null; }
                            }).filter(Boolean);
                            console.log('[Autoplay] Redirect links resolved — domains:', resolvedDomains);
                            const providerUrlMap = {};
                            for (const res of resolvedLinks) {
                                if (!res?.finalUrl) continue;
                                try {
                                    const domain = new URL(res.finalUrl).hostname;
                                    if (domain.includes('voe.sx') && !providerUrlMap[VIDEO_PROVIDERS_MAP.VOE]) {
                                        providerUrlMap[VIDEO_PROVIDERS_MAP.VOE] = res.finalUrl;
                                    } else if (
                                        (domain.includes('vidmoly.to') || domain.includes('vidmoly.me')) &&
                                        !providerUrlMap[VIDEO_PROVIDERS_MAP.Vidmoly]
                                    ) {
                                        providerUrlMap[VIDEO_PROVIDERS_MAP.Vidmoly] = res.finalUrl;
                                    } else if (domain.includes('vidoza.net') && !providerUrlMap[VIDEO_PROVIDERS_MAP.Vidoza]) {
                                        providerUrlMap[VIDEO_PROVIDERS_MAP.Vidoza] = res.finalUrl;
                                    }
                                } catch (_) {}
                            }
                            for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                                const name = VIDEO_PROVIDERS_IDS[id];
                                if (providerUrlMap[name]) {
                                    nextVideoHref = providerUrlMap[name];
                                    nextProviderName = name;
                                    console.log('[Autoplay] Redirect-based provider selected:', nextProviderName);
                                    break;
                                }
                            }
                        }
                    }

                    if (!nextVideoHref) {
                        console.warn('[Autoplay] No provider found — redirect links in next episode DOM:', nextEpisodeDom.querySelectorAll('a[href*="/redirect/"]').length);
                        throw new Error('Embedded providers are missing or not supported');
                    }

                    try {
                        document.querySelector(Q.playerIframe).src = nextVideoHref;
                        console.log('[Autoplay] Successfully changed iframe src to:', nextVideoHref);
                    } catch (iframeError) {
                        console.error('[Autoplay] Error setting iframe src:', iframeError);
                        throw iframeError;
                    }
                }
            } catch (error) {
                console.error('[Autoplay] Autoplay failed:', error);
                GM_setValue('lastAutoplayError', {
                    date: Date.now(),
                    error: error.message
                });
                // At that point, refresh should load the next episode if the website even has it.
                // The problem is it is not seamless
                console.log('[Autoplay] Reloading page due to autoplay error');

                // Exit fullscreen before reload to prevent fullscreen errors
                if (document.fullscreenElement) {
                    document.exitFullscreen().then(() => {
                        location.href = location.href;
                    }).catch(() => {
                        // If exit fullscreen fails, reload anyway
                        location.href = location.href;
                    });
                } else {
                    location.href = location.href;
                }
            }
        }

        async markCurrentVideoWatched() {
            let episodeId;

            if (isNewStoLayout()) {
                // New S.to layout - get episode ID from player-meta
                const playerMeta = document.querySelector('#player-meta');
                episodeId = playerMeta?.dataset?.episodeId;

                if (episodeId) {
                    // New S.to uses a different API endpoint
                    await this.announceEpisodeWatchedNewSto(episodeId);
                }
            } else {
                // Old layout
                episodeId = document.querySelector(
                    TopScopeInterface.queries.episodeTitle
                )?.dataset?.episodeId;

                if (episodeId) {
                    await this.announceEpisodeWatched(episodeId);
                }
            }
        }

        // New S.to API for marking episodes watched
        async announceEpisodeWatchedNewSto(episodeId) {
            if (!episodeId) throw new Error('Episode ID is missing');

            const playerMeta = document.querySelector('#player-meta');
            const seriesId = playerMeta?.dataset?.seriesId;
            const seasonNo = playerMeta?.dataset?.seasonNo;
            const episodeNo = playerMeta?.dataset?.episodeNo;

            try {
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
                await fetch(`${location.protocol}//${location.hostname}/api/episodes/watched`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': csrfToken,
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        series_id: Number(seriesId || 0),
                        season_no: Number(seasonNo || 0),
                        episode_no: Number(episodeNo || 0),
                        episode_id: Number(episodeId || 0),
                    }),
                });
            } catch (e) {
                console.error('[Autoplay] Failed to mark episode as watched:', e);
            }
        }

        // Setup click handlers for new S.to provider buttons
        setupNewStoProviderHandlers() {
            document.querySelectorAll('#episode-links .link-box').forEach((btn) => {
                // Remove existing listeners by cloning
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);

                newBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();

                    // Remove active class from all buttons
                    document.querySelectorAll('#episode-links .link-box').forEach(b => {
                        b.classList.remove('active');
                    });

                    // Add active class to clicked button
                    newBtn.classList.add('active');

                    // Update iframe src
                    const playUrl = newBtn.dataset.playUrl;
                    if (playUrl) {
                        const iframe = document.querySelector('#player-iframe');
                        if (iframe) {
                            iframe.src = playUrl;
                        }
                    }

                    // Update player meta suffix
                    const metaSuffix = document.querySelector('#player-meta-suffix');
                    if (metaSuffix) {
                        const lang = newBtn.dataset.languageLabel || '';
                        const provider = newBtn.dataset.providerName || '';
                        metaSuffix.textContent = `${lang} ${provider}`.trim();
                    }
                });
            });
        }

        unregisterCommlinkListener() {
            if (!this.currentIframeId) return;
            this.commLink.listeners = this.commLink.listeners.filter((listener) => {
                if (listener.sender === this.currentIframeId) {
                    listener.intervalObj.stop();
                    return false;
                }

                return true;
            });

            this.currentIframeId = null;
        }

        // Partly consist of the website code
        updateVideoLanguageProcessing() {
            // New S.to layout has different language handling
            if (isNewStoLayout()) {
                return this.updateVideoLanguageProcessingNewSto();
            }

            // Old layout
            let changeLanguageButtons = [...document.querySelectorAll('.changeLanguageBox img')];
            let selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];
            const availableLangIDs = [...new Set(changeLanguageButtons.map(img => img.dataset.langKey))];
            // Checks preferred language and if it is missing, it takes first available.
            // Returns if found zero buttons with language IDs
            if (!selectedLanguage || !availableLangIDs.includes(selectedLanguage)) {
                if (availableLangIDs.length) {
                    selectedLanguage = availableLangIDs[0];
                } else {
                    return null;
                }
            }

            // Hides/unhides providers buttons based on language
            document.querySelectorAll('.hosterSiteVideo ul li[data-lang-key]').forEach((el) => {
                el.style.display = el.dataset.langKey === selectedLanguage ? 'block' : 'none';
            });
            // Highlights/unhighlights change language buttons
            changeLanguageButtons.forEach((btn) => {
                btn.classList.toggle('selectedLanguage', btn.dataset.langKey === selectedLanguage);
                btn.outerHTML = btn.outerHTML;
            });
            // HTML reset removes the nodes from the DOM so need to get them here once again
            changeLanguageButtons = [...document.querySelectorAll('.changeLanguageBox img')];
            changeLanguageButtons.forEach((btn) => {
                btn.addEventListener('click', function() {
                    const selectedLanguage = coreSettings[
                        CORE_SETTINGS_MAP.videoLanguagePreferredID
                    ] = this.getAttribute('data-lang-key');

                    // Highlights/unhighlights change language buttons
                    document.querySelectorAll('.changeLanguageBox img').forEach((btn) => {
                        btn.classList.toggle('selectedLanguage', btn.dataset.langKey === selectedLanguage);
                    });

                    // Hides/unhides providers buttons based on language
                    document.querySelectorAll('.hosterSiteVideo ul li[data-lang-key]').forEach((el) => {
                        el.style.display = el.dataset.langKey === selectedLanguage ? 'block' : 'none';
                    });

                    const preferredProvidersButtons = [
                        ...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn)
                    ].filter(el => el.parentElement.dataset.langKey === selectedLanguage);
                    if (preferredProvidersButtons.length) {
                        outer: for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                            const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
                            for (const btn of preferredProvidersButtons) {
                                const providerName = btn.firstElementChild.querySelector(
                                    TopScopeInterface.queries.providerName
                                ).innerText;

                                if (providerName === preferredProviderName) {
                                    btn.click();
                                    break outer;
                                }
                            }
                        }
                    } else {
                        document.querySelectorAll('.inSiteWebStream').forEach((el) => {
                            el.style.display = 'none';
                        });
                        this.unregisterCommlinkListener();

                        if (this.iframeSrcChangesListener) this.ignoreIframeSrcChangeOnce = true;

                        document.querySelector(TopScopeInterface.queries.playerIframe).src = 'about:blank';
                    }
                });
            });

            return {
                selectedLanguage
            };
        }

        // New S.to layout language processing
        updateVideoLanguageProcessingNewSto() {
            const providerButtons = [...document.querySelectorAll('#episode-links .link-box')];
            let selectedLanguage = coreSettings[CORE_SETTINGS_MAP.videoLanguagePreferredID];

            // Get available language IDs from provider buttons
            const availableLangIDs = [...new Set(providerButtons.map(btn => btn.dataset.languageId))];

            // Checks preferred language and if it is missing, it takes first available
            if (!selectedLanguage || !availableLangIDs.includes(selectedLanguage)) {
                if (availableLangIDs.length) {
                    selectedLanguage = availableLangIDs[0];
                } else {
                    return { selectedLanguage: null };
                }
            }

            // Setup click handlers for provider buttons
            this.setupNewStoProviderHandlers();

            return {
                selectedLanguage
            };
        }
    }


    // If context is top scope
    if (!isEmbedded()) {
        if (!TOP_SCOPE_DOMAINS.includes(location.hostname)) return;

        const newStoLayout = isNewStoLayout();

        // Recolor episodes links visited before, excluding the current or watched ones
        if (mainSettings[MAIN_SETTINGS_MAP.highlightVisitedEpisodes]) {
            if (newStoLayout) {
                // New S.to layout - style for visited episode links
                GM_addStyle(`
  #episode-nav .nav-link:visited:not(.bg-primary) {
    background: #ffdd00 !important;
    color: #000 !important;
  }
  `);
            } else {
                // Old layout
                GM_addStyle(`
  div#stream.hosterSiteDirectNav a[data-episode-id]:visited:not([class]) {
    background: #ffdd00;
  }
  `);
            }
        }

        // Wait for DOM
        await new Promise((resolve) => {
            if (['complete', 'interactive'].includes(document.readyState)) {
                resolve();
            } else {
                document.addEventListener('DOMContentLoaded', resolve, {
                    once: true
                });
            }
        });
        setupManualEpisodeNavigationTracking();
        const suppressAutoProviderLoadOnce = consumeManualEpisodeNavigation();
        if (suppressAutoProviderLoadOnce) {
            console.log('[Autoplay] Suppressing automatic provider selection after manual episode navigation');
            // Also tell handleAutoplay (iframe scope) not to auto-start the video
            GM_setValue('aw_suppress_autoplay_once', { _at: Date.now() });
        }
        try {
            const lastAutoplayError = GM_getValue('lastAutoplayError');
            if (lastAutoplayError && ((Date.now() - lastAutoplayError.date) <= (60 * 1000))) {
                GM_deleteValue('lastAutoplayError');
                Notiflixx.notify.warning(
                    `${GM_info.script.name}: ${i18n.lastAutoplayError}`
                );
            }
        } catch (e) {
            console.error(e);
        }

        const topScopeInterface = new TopScopeInterface();
        const iframe = document.querySelector(TopScopeInterface.queries.playerIframe);
        // Not a video page?
        if (!iframe) return;

        // Remove the website logic responsible for marking episodes as watched.
        // since the script would handle it instead. Awaiting is unnecessary
        if (!newStoLayout) {
            // Only needed for old layout
            (async function waitForWatchedFunction(start = Date.now()) {
                if (unsafeWindow.markAsWatched) {
                    unsafeWindow.markAsWatched = () => {};
                } else {
                    if ((Date.now() - start) > (10 * 1000)) {
                        throw new Error('Watched function didn\'t arrive in time');
                    }

                    await sleep();

                    return waitForWatchedFunction(start);
                }
            }());
        }

        iframe.addEventListener('load', async () => {
            await topScopeInterface.init(iframe);
        }, {
            once: true
        });

        if (newStoLayout) {
            // New S.to layout - wait for provider buttons to be available
            await new Promise((resolve) => {
                waitForElement('#episode-links .link-box', {
                    existing: true,
                    onceOnly: true,
                    callbackOnTimeout: true,
                    timeout: 10 * 1000,
                }, resolve);
            });
            await sleep();

            const result = topScopeInterface.updateVideoLanguageProcessing();
            const selectedLanguage = result?.selectedLanguage;

            if (suppressAutoProviderLoadOnce) return;

            // Find and click preferred provider for selected language
            const providerButtons = [...document.querySelectorAll('#episode-links .link-box')];

            // Filter by language if set
            let filteredButtons = providerButtons;
            if (selectedLanguage) {
                filteredButtons = providerButtons.filter(btn =>
                    btn.dataset.languageId === selectedLanguage
                );
                if (filteredButtons.length === 0) {
                    filteredButtons = providerButtons;
                }
            }

            // Find preferred provider and click it
            for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
                const matchingBtn = filteredButtons.find(btn =>
                    btn.dataset.providerName === preferredProviderName
                );
                if (matchingBtn) {
                    // Check if it's already active (already loaded)
                    if (!matchingBtn.classList.contains('active')) {
                        matchingBtn.click();
                    }
                    return;
                }
            }
        } else {
            // Old layout - Wait for the website main code to finish
            await new Promise((resolve) => {
                waitForElement(TopScopeInterface.queries.selectedLanguageBtn, {
                    existing: true,
                    onceOnly: true,
                    callbackOnTimeout: true,
                    timeout: 10 * 1000,
                }, resolve);
            });
            await sleep();

            const {
                selectedLanguage
            } = topScopeInterface.updateVideoLanguageProcessing();

            if (suppressAutoProviderLoadOnce) return;

            const preferredProvidersButtons = [
                ...document.querySelectorAll(TopScopeInterface.queries.providerChangeBtn)
            ].filter(el => el.parentElement.dataset.langKey === selectedLanguage);
            if (preferredProvidersButtons.length) {
                for (const id of coreSettings[CORE_SETTINGS_MAP.providersPriority]) {
                    const preferredProviderName = VIDEO_PROVIDERS_IDS[id];
                    for (const btn of preferredProvidersButtons) {
                        const providerName = btn.firstElementChild.querySelector(
                            TopScopeInterface.queries.providerName
                        ).innerText;
                        if (providerName === preferredProviderName) {
                            btn.click();
                            return;
                        }
                    }
                }
            }
        }
    }

    // If context is iframe scope
    else {
        const isItVOEJWP = !!document.querySelector('meta[name="keywords"][content^="VOE"]');
        const isItVidoza = !!document.querySelector('meta[content*="Vidoza"]');
        if ([isItVidoza, isItVOEJWP].every(e => !e)) {
            return;
        }

        const iframeMessenger = new IframeMessenger();
        for (const {
                condition,
                interface: Interface
            }
            of [
                {
                    condition: isItVidoza,
                    interface: VidozaIframeInterface
                },
                {
                    condition: isItVOEJWP,
                    interface: VOEJWPIframeInterface
                },
            ]) {
            if (!condition) continue;
            // Call early to get rid of ads and intercept listeners
            const iframeInterface = new Interface(iframeMessenger);
            window.addEventListener('load', async () => {
                // Give a little bit of a time for the TopScopeInterface to prepare
                await sleep(4);
                await iframeMessenger.initCrossFrameConnection();

                waitForElement(Interface.queries.player, {
                    existing: true,
                    onceOnly: true,
                }, async (player) => {
                    // Prevent fullscreen triggering by a playback start, on Safari
                    player.setAttribute('playsinline', '');
                    player.setAttribute('webkit-playsinline', '');

                    // Attempt to fix a Safari bug when the video controls get duplicated
                    GM_addStyle(`
        video::-webkit-media-controls-panel, video::-webkit-media-controls-play-button, video::-webkit-media-controls-start-playback-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0;
          visibility: hidden;
        }
      `);

                    await iframeInterface.init(player);
                });
            }, {
                once: true
            });
            break;
        }
    }
}());
