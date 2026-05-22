// Patches jwplayer on Vidmoly to strip ad config before setup runs.
// Loaded via chrome.runtime.getURL() to bypass page CSP (no unsafe-inline needed).
(() => {
    const og = window.jwplayer;
    if (typeof og !== 'function') return;
    Object.defineProperty(window, 'jwplayer', {
        configurable: true,
        get: () => function(id) {
            const p = og(id);
            const s = p.setup;
            p.setup = function(cfg) {
                if (cfg.advertising) cfg.advertising = {};
                return s.call(this, cfg);
            };
            return p;
        }
    });
})();
