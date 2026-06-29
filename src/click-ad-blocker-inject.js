(function () {
    try {
        var _open = window.open;
        window.open = function (url, target, features) {
            var t = (target || '').trim();
            if (!t || t === '_blank' || t === '_top' || t === '_parent') {
                console.log('[ClickAdBlocker] Blocked popup:', url);
                return { closed: true, close: function () {}, focus: function () {}, blur: function () {} };
            }
            return _open.apply(this, arguments);
        };
    } catch (e) {}

    document.addEventListener('click', function (e) {
        try {
            var a = e.target && e.target.closest && e.target.closest('a[target]');
            if (!a) return;
            var t = (a.target || '').trim();
            if (t !== '_blank' && t !== '_top' && t !== '_parent') return;
            var href = a.href || '';
            if (/^https?:\/\/(aniworld\.to|s\.to|serienstream\.to)([/?#]|$)/.test(href)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            console.log('[ClickAdBlocker] Blocked link:', href);
        } catch (e) {}
    }, true);
})();
