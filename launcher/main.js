const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server', 'index.js');
// Reuses the server's own path resolution directly rather than
// reimplementing it - guarantees this always agrees with wherever the
// server itself actually reads config.json from, with no risk of the
// two drifting apart if that logic ever changes.
const { DATA_DIR } = require(path.join(PROJECT_ROOT, 'server', 'paths.js'));
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

let mainWindow = null;
let tray = null;
let rebuildTrayMenu = null;
let serverProcess = null;
let forceKillTimer = null;
let serverStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'stopping'
let quittingForReal = false; // closing the window hides it to the tray by default - this distinguishes that from an actual app quit

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch (e) { return {}; }
}

function getServerUrl() {
  const cfg = readConfig();
  const port = cfg.port || 4821;
  const httpsOn = !!(cfg.https && cfg.https.certPath && cfg.https.keyPath && fs.existsSync(cfg.https.certPath) && fs.existsSync(cfg.https.keyPath));
  return `${httpsOn ? 'https' : 'http'}://localhost:${port}`;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function sendStatus() {
  sendToRenderer('status-update', { status: serverStatus, url: getServerUrl() });
  if (tray) tray.setToolTip(`I/O - ${serverStatus}`);
  if (rebuildTrayMenu) rebuildTrayMenu();
}

function appendLog(text, isError) {
  sendToRenderer('log-line', { text, isError: !!isError });
}

function startServer() {
  if (serverProcess) return;
  if (!fs.existsSync(SERVER_ENTRY)) {
    appendLog(`[launcher] server entry point not found at ${SERVER_ENTRY}\n`, true);
    return;
  }
  serverStatus = 'starting';
  sendStatus();
  appendLog('[launcher] starting server...\n');
  // Relies on node being on PATH, same assumption start.bat/start.sh
  // already make for this whole project - not a new requirement this
  // introduces.
  serverProcess = spawn('node', [SERVER_ENTRY], { cwd: PROJECT_ROOT, env: process.env });

  serverProcess.stdout.on('data', (data) => {
    const text = data.toString('utf-8');
    appendLog(text);
    if (text.includes('is running')) { serverStatus = 'running'; sendStatus(); }
  });
  serverProcess.stderr.on('data', (data) => appendLog(data.toString('utf-8'), true));
  serverProcess.on('error', (e) => {
    appendLog(`[launcher] failed to start server: ${e.message}\n`, true);
    serverProcess = null;
    serverStatus = 'stopped';
    sendStatus();
  });
  serverProcess.on('exit', (code) => {
    appendLog(`\n[launcher] server process exited (code ${code === null ? 'killed' : code})\n`);
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
    serverProcess = null;
    serverStatus = 'stopped';
    sendStatus();
  });
}

function stopServer() {
  if (!serverProcess) return;
  serverStatus = 'stopping';
  sendStatus();
  appendLog('[launcher] stopping server...\n');
  serverProcess.kill('SIGTERM');
  // A hung process (still mid-write to the database, say) shouldn't
  // leave Stop looking like it silently did nothing forever - force it
  // after a reasonable grace period. Tracked so the exit handler above
  // can cancel this specific timer the moment the process actually
  // exits on its own - otherwise, if a new server gets started again
  // before this fires, it would wrongly find and kill THAT process
  // instead, since serverProcess would have been reassigned to it by
  // then.
  forceKillTimer = setTimeout(() => {
    if (serverProcess) { appendLog('[launcher] server did not stop gracefully - forcing it closed\n', true); serverProcess.kill('SIGKILL'); }
  }, 5000);
}

function restartServer() {
  if (serverProcess) {
    serverProcess.once('exit', () => startServer());
    stopServer();
  } else {
    startServer();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#050408', // matches the login page's own background - avoids a white flash before the page's own CSS applies
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false); // this is a purpose-built control panel, not something that needs a File/Edit/View menu bar
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (e) => {
    // Closing the window hides it to the tray rather than quitting -
    // matches how a background service control panel is normally
    // expected to behave (the server keeps running even if you close
    // the window), with Quit from the tray menu as the real exit.
    if (!quittingForReal) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  rebuildTrayMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show IO Control Panel', click: () => { mainWindow.show(); } },
      { type: 'separator' },
      { label: 'Start Server', click: startServer, enabled: serverStatus === 'stopped' },
      { label: 'Stop Server', click: stopServer, enabled: serverStatus === 'running' },
      { label: 'Restart Server', click: restartServer, enabled: serverStatus === 'running' },
      { type: 'separator' },
      { label: 'Open in Browser', click: () => shell.openExternal(getServerUrl()) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quittingForReal = true; app.quit(); } },
    ]));
  };
  rebuildTrayMenu();
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startServer(); // the whole point of this replacing "double-click start.bat" is that it comes up running automatically
});

app.on('window-all-closed', (e) => {
  // On every platform, not just macOS - this is a background-service
  // control panel, so the app (and the server it's managing) should
  // keep running via the tray icon even with no window open.
  e.preventDefault();
});

app.on('before-quit', () => { quittingForReal = true; });
app.on('quit', () => { if (serverProcess) serverProcess.kill('SIGTERM'); });

ipcMain.handle('start-server', () => { startServer(); return true; });
ipcMain.handle('stop-server', () => { stopServer(); return true; });
ipcMain.handle('restart-server', () => { restartServer(); return true; });
ipcMain.handle('get-status', () => ({ status: serverStatus, url: getServerUrl() }));
ipcMain.handle('open-in-browser', () => { shell.openExternal(getServerUrl()); });
ipcMain.handle('open-data-folder', () => { shell.openPath(DATA_DIR); });
ipcMain.handle('copy-server-url', () => { clipboard.writeText(getServerUrl()); return true; });
