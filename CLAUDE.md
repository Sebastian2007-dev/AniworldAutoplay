# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Manifest V3 Chrome extension for aniworld.to and s.to: autoplay, intro/outro skip (AniSkip API), persistent volume/language, ad-popup blocking, and PiP restore. No build step — all files are plain JS loaded directly by the manifest.

## Loading the extension

Open `chrome://extensions`, enable Developer Mode, click **Load unpacked**, select this folder. After any code change: click the **reload** button on the extension card. There are no tests and no lint config.

## Architecture

### Two-scope execution model

`src/content.js` runs in **every frame** (`all_frames: true`) but has a single entry point that branches based on the current URL/DOM:

- **Top scope** (`window.top === window` and URL matches aniworld.to/s.to): Creates a `TopScopeInterface` that drives episode navigation, language/provider memory, autoplay, and PiP. Communicates with the embedded player iframe via `CommLinkHandler` (IPC over `GM_addValueChangeListener` / `chrome.storage.onChanged`).

- **Iframe scope** (inside a video player embed): Detects the player type via DOM meta tags, then instantiates either `VidozaIframeInterface` or `VOEJWPIframeInterface`. These extend a shared `IframeInterface` base that handles skip-button injection, volume persistence, and AniSkip time loading. Bidirectional messaging with the top scope goes through `IframeMessenger`.

### Key modules inside content.js

| Module / class | Purpose |
|---|---|
| `AniSkipModule` | Fetches intro/outro timestamps from api.aniskip.com (MAL ID lookup via Jikan) |
| `AnimeSkipModule` | GraphQL client for api.anime-skip.com (alternative source) |
| `DataStore` | Settings persistence wrapper around `GM_getValue`/`GM_setValue` |
| `installAgeGateBlocker` IIFE | Removes ad/gambling iframes and auto-dismisses age-gate overlays in every frame |
| `installClickAdBlocker` IIFE | Injects a `<script>` tag into every frame's page context to override `window.open` and block `_blank` link clicks (prevents VOE ad popups) |

### background.js

Three responsibilities:
1. **Ad-tab blocker**: `chrome.tabs.onCreated` listener — if a new tab's opener is an aniworld/s.to tab and the destination is not aniworld/s.to, the tab is closed immediately.
2. **Cross-origin XHR proxy**: handles `GM_XMLHTTPREQUEST` messages from content scripts (background service worker is not subject to CORS).
3. **Log buffer**: Receives `LOGS` messages from content scripts, keeps the last 500 entries, forwards to any connected popup ports.

### src/gm-compat.js

Tampermonkey → Chrome API shim loaded first (before content.js). Key mappings:
- `GM_getValue`/`GM_setValue` → `chrome.storage.local` with a synchronous in-memory cache
- `GM_addValueChangeListener` → `chrome.storage.onChanged` (used for cross-frame IPC)
- `GM_xmlhttpRequest` → background worker message relay
- Wraps `console.log/warn/error` to batch-forward tagged log entries to the background

### popup.js

Four-tab UI: **Logs** (live viewer with level filters), **AniSkip** (edit timestamps, clear cache), **Settings** (40+ options), **Advanced** (custom themes, network, AnimeSkip client ID). Communicates with content scripts via `chrome.tabs.sendMessage` and `chrome.storage`.

### src/vidmoly-patch.js

Injected into Vidmoly/JW Player pages as a web-accessible resource; patches JW Player internals to strip ad calls before they fire.

## Important patterns

- **Isolated world limitation**: `window.open` overrides and DOM event captures that need to affect page JS must be done by appending a `<script>` tag to the document — content script code runs in Chrome's isolated world and cannot override page-context globals directly.
- **Storage-based IPC**: Cross-frame communication (top ↔ iframe) does not use `postMessage`; it uses `GM_setValue` + `GM_addValueChangeListener` which maps to `chrome.storage.local` change events.
- **No module system**: All code is concatenated into one large IIFE-heavy file. New features go inside `src/content.js`; avoid splitting into separate files unless necessary.
