# IO Control Panel (desktop launcher)

A GUI for starting, stopping, and monitoring the I/O
server, instead of running it purely from the command line. It's a
separate, optional app that lives in its own folder - the main
server's own dependencies are completely untouched by this, so
`start.bat`/`start.sh` continue to work exactly as before for anyone
who doesn't want the GUI.

Themed after the app's own login page - same colors, same font, same
IO logo - so it genuinely looks like part of the same product,
not an approximation of it.

## First-time setup

From this `launcher` folder:

```
npm install
npm start
```

`npm install` only needs to be run once (it downloads Electron, which
is a real download - a few hundred MB - since it bundles a full
Chromium browser to render the GUI).

## What it does

- Starts the server automatically when opened, and keeps running in
  the system tray even if you close the window - closing the window
  doesn't stop the server, since that matches how this kind of
  control panel is normally expected to behave. Use Quit from the
  tray icon's menu, or the tray menu's own Stop Server, to actually
  stop it.
- **Start / Stop / Restart** - direct control over the server process,
  with its real console output streamed live into the log panel below.
- **Open in Browser** - jumps straight to the running server at its
  correct address (reads the actual port and whether HTTPS is
  configured directly from your real config, so this is always
  correct even after changing settings).
- **Copy Server URL** - for sharing with someone else on your network,
  without needing to remember the port.
- **Open Data Folder** - opens the folder holding your actual
  config.json, database, and certificates - the same folder the
  server itself already reports in its own startup log.
- **Clear Logs** - clears the log panel display only; doesn't touch
  any actual log file on disk.

## Notes

- Requires `node` to be on your system PATH, same requirement
  `start.bat`/`start.sh` already have - this doesn't bundle its own
  copy of Node.js, it spawns the real server the same way those
  scripts do.
- The system tray icon and window icon are set from
  `launcher/assets/icon.png`. Replace this file with a different
  image (same 256x256 PNG format) if you'd like to use something else.
