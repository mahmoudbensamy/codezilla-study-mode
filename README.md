# Codezilla Study Mode: Study & Guard Manager

A Windows self-control toolkit: block distracting sites at the hosts-file level, redirect them in the browser, and keep a small allowlist of study channels and playlists that still open, in a clean YouTube-style player.

- **Hosts guard:** blocks the domains you list and restores the hosts file every N minutes if it is changed (Windows scheduled task, runs as SYSTEM).
- **Browser extension:** redirects distracting sites (for example YouTube to SoundCloud) and sends allowlisted study links to the local player.
- **Study player:** a local page at `127.0.0.1:8765` that shows allowlisted channels (Videos and Playlists tabs) and playlists, with a watch page and a playlist panel.
- **Manager GUI:** one window to edit all of the above. Changes to the hosts file only apply after you approve the Windows administrator prompt.

## Requirements

Windows 10/11, [Node.js](https://nodejs.org) 18+, and Chrome, Brave or Edge.

## Setup

1. Copy `config.example.json` to `config.json` and edit it (or edit later in the GUI).
2. Run `node generate.js`. This creates `blocked-domains.txt` and the `extension/` folder.
3. Double-click `install.bat` and approve the administrator prompt. It writes the hosts block, registers the guard task, and sets the study player to start at login.
4. In your browser open the extensions page, turn on Developer mode, and **Load unpacked** the `extension` folder (press Reload after later rule changes).
5. Open the manager with `Study Manager.bat` (it starts the player if needed and opens the GUI as an app window).

## Using the study allowlist

In the GUI, Study allowlist tab:

- Add a **channel** with its channel ID (starts with `UC`; on YouTube: About, Share, Copy channel ID). Then add its **courses** by pasting playlist links.
- Add single **playlists** by pasting their links.
- Open the YouTube link as usual; the extension sends it to the local player. Any other YouTube page still redirects.

## Files

| File | Purpose |
| --- | --- |
| `config.json` | Your settings (not committed). Single source of truth. |
| `generate.js` | Builds the blocklist and extension rules from `config.json`. |
| `install.ps1`, `install.bat` | Applies everything to Windows (admin). |
| `uninstall.ps1`, `uninstall.bat` | Removes the hosts block and scheduled tasks. |
| `guard.ps1`, `common.ps1` | The restoring guard and shared helpers. |
| `study-player/server.js` | Local player, GUI server and API (127.0.0.1 only). |
| `study-player/admin.html` | The manager GUI. |
| `launch-manager.ps1`, `Study Manager.bat` | Open the GUI as an app window. |

## Security notes

The local server accepts requests only for host `127.0.0.1:8765`, requires a custom header on API calls, and rejects cross-origin writes. The GUI cannot change the hosts file by itself: Apply launches the installer through the Windows administrator prompt. This tool is a speed bump for your own impulses, not protection against a determined administrator.
