const { app, BrowserWindow, dialog } = require('electron/main');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { hubURL: findHubURL } = require('./hub-url');
let hubURL;
let hostProcess;
let quitting = false;

async function startLocalModel() {
  // Client-only installations can still join the shared room.
  if (!fs.existsSync(path.join(__dirname, '.local/host-token'))) return;
  try {
    const response = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1500) });
    if (response.ok || response.status === 503) return;
  } catch {}
  const logPath = path.join(__dirname, '.local/logs/hub.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'a');
  hostProcess = spawn(process.execPath, [path.join(__dirname, 'scripts/hub.js')], {
    cwd: __dirname,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENCHAT_URL: hubURL },
    stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  hostProcess.on('error', error => {
    if (!quitting) dialog.showErrorBox('Model could not start', error.message);
  });
  hostProcess.on('exit', code => {
    hostProcess = null;
    if (!quitting && code !== 0) dialog.showErrorBox('Model stopped', `The local model stopped. Reopen Openchat to retry. Details: ${logPath}`);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('before-quit', () => { quitting = true; hostProcess?.kill('SIGTERM'); });

function createWindow() {
  const win = new BrowserWindow({ width: 1100, height: 800, minWidth: 360, minHeight: 500,
    backgroundColor: '#000000', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(hubURL).origin) event.preventDefault(); });
  win.loadURL(hubURL);
}
app.whenReady().then(async () => {
  hubURL = await findHubURL();
  await startLocalModel();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
