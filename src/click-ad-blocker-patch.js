// Click-Ad Blocker — prevents video players (VOE, Doodstream, etc.) from
// opening ad tabs when the user clicks inside them. Loaded via
// chrome.runtime.getURL() to bypass page CSP (no unsafe-inline needed).
(function() {
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
            if (/^https?:\/\/(aniworld\.to|s\.to|serienstream\.to)([\/\?#]|$)/.test(href)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            console.log('[ClickAdBlocker] Blocked link:', href);
        } catch (e) {}
    }, true);
})();
