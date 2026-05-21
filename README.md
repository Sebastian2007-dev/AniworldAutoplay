# Aniworld.to & S.to Autoplay

A browser extension for [Aniworld.to](https://aniworld.to) and [S.to](https://s.to) that adds autoplay, automatic intro/outro skipping, and a bunch of quality-of-life features.

Based on the [Aniworld.to & S.to Autoplay](https://greasyfork.org/de/scripts/518391-aniworld-to-s-to-autoplay) Tampermonkey script by [AniPlayer](https://greasyfork.org/de/users/1400386-aniplayer). This repository is a browser extension port with additional improvements.

## Features

- **Autoplay** — automatically loads the next episode when the current one ends
- **Automatic intro skip** — detects and skips intros via the [AniSkip API](https://api.aniskip.com) and [AnimeSkip API](https://api.anime-skip.com)
- **Playback memory** — resumes where you left off after a page reload
- **Language memory** — remembers your preferred stream language/provider
- **Persistent volume** — keeps your volume level across episodes and page loads
- **Age-gate blocker** — auto-dismisses 18+ overlays injected by video providers (VOE, Doodstream, Filemoon, etc.)
- **Debug log panel** — live log viewer in the popup with level filters (Log / Warn / Error)

## Installation

Since the extension is not published to the Chrome Web Store, install it manually:

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the repository folder
5. The extension icon will appear in your toolbar

## Usage

1. Navigate to an episode page on **aniworld.to** or **s.to**
2. The extension activates automatically — a green status dot in the popup confirms it's running
3. Open the popup via the toolbar icon to configure settings or inspect logs

## Settings

| Setting | Description |
| --- | --- |
| Autoplay | Automatically play the next episode |
| Auto intro skip | Skip intros immediately when detected |
| Playback memory | Restore playback position on reload |
| AniSkip API | Fetch intro timestamps automatically |
| Notifications | Show AniSkip status as an in-page popup |
| AnimeSkip Client ID | Your own API key from [anime-skip.com](https://anime-skip.com) (leave empty to use the shared test key) |

## Supported Sites

- `aniworld.to`
- `s.to`
- `serienstream.to`

## Tech Stack

- Manifest V3 (Chrome Extensions API)
- [Notiflix](https://notiflix.github.io/) for in-page notifications
- [Hotkeys.js](https://github.com/jaywcjlove/hotkeys) for keyboard shortcuts
- AniSkip & AnimeSkip APIs for intro/outro timestamps

## Credits

Original script by [AniPlayer](https://greasyfork.org/de/users/1400386-aniplayer) on Greasy Fork — published as a Tampermonkey userscript under GPL-3.0-or-later.

## License

[GPL-3.0-or-later](LICENSE)
