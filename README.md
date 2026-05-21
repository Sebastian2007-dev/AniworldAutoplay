# Aniworld.to & S.to Autoplay

A browser extension for [Aniworld.to](https://aniworld.to) and [S.to](https://s.to) that adds autoplay, automatic intro/outro skipping, and a bunch of quality-of-life features.

Based on the [Aniworld.to & S.to Autoplay](https://greasyfork.org/de/scripts/518391-aniworld-to-s-to-autoplay) Tampermonkey script by [AniPlayer](https://greasyfork.org/de/users/1400386-aniplayer). This repository is a browser extension port with additional improvements.

## Features

- **Autoplay** — automatically loads the next episode when the current one ends
- **Automatic intro & outro skip** — detects and skips intros and outros via the [AniSkip API](https://api.aniskip.com) and [AnimeSkip API](https://api.anime-skip.com)
- **Local skip times** — saves custom intro/outro timestamps per episode locally; survives API outages and works for shows with no API data
- **Skip times editor** — in-page dialog to correct or submit intro/outro timestamps for the current episode (openable from the popup)
- **No-data cache** — caches "no data" API responses to avoid redundant requests; clearable from the popup's AniSkip tab
- **Playback memory** — resumes where you left off after a page reload
- **Language memory** — remembers your preferred stream language/provider
- **Persistent volume** — keeps your volume level across episodes and page loads
- **Age-gate blocker** — auto-dismisses 18+ overlays injected by video providers (VOE, Doodstream, Filemoon, etc.)
- **Customizable keyboard shortcuts** — configurable hotkeys for fast-forward, rewind, fullscreen, and large skip (defaults: `→`, `←`, `F`, `V`)
- **In-page settings panel** — full settings UI embedded directly in the video player page
- **Debug log panel** — live log viewer in the popup with level filters (All / Log / Warn / Error) and auto-scroll

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
| Auto intro skip | Skip intros and outros immediately when detected |
| Playback memory | Restore playback position on reload |
| AniSkip API | Fetch intro/outro timestamps automatically |
| Notifications | Show AniSkip status as an in-page popup |
| AnimeSkip Client ID | Your own API key from [anime-skip.com](https://anime-skip.com) (leave empty to use the shared test key) |
| Max. stored skip entries | How many local skip-time records to keep; oldest are pruned when the limit is exceeded (default: 500) |

### AniSkip Tab (Popup)

| Action | Description |
| --- | --- |
| Edit Intro / Edit Outro | Open the in-page skip-times editor for the current episode |
| Clear "No data" cache | Force the extension to re-query both APIs on the next episode load |
| Clear local skip times | Delete all locally stored intro/outro timestamps |

## Supported Sites

- `aniworld.to`
- `s.to`
- `serienstream.to`

## Keyboard Shortcuts

Default hotkeys (configurable in the in-page settings panel):

| Key | Action |
| --- | --- |
| `→` | Fast-forward |
| `←` | Rewind |
| `F` | Toggle fullscreen |
| `V` | Large skip |

## Tech Stack

- Manifest V3 (Chrome Extensions API)
- [Notiflix](https://notiflix.github.io/) for in-page notifications
- [Hotkeys.js](https://github.com/jaywcjlove/hotkeys) for keyboard shortcuts
- AniSkip & AnimeSkip APIs for intro/outro timestamps

## Credits

Original script by [AniPlayer](https://greasyfork.org/de/users/1400386-aniplayer) on Greasy Fork — published as a Tampermonkey userscript under GPL-3.0-or-later.

## License

[GPL-3.0-or-later](LICENSE)
