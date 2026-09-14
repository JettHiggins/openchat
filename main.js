const { app, BrowserWindow } = require('electron/main');
const { hubURL: findHubURL } = require('./hub-url');
let hubURL;

function createWindow() {
  const win = new BrowserWindow({ width: 1100, height: 800, minWidth: 360, minHeight: 500,
    backgroundColor: '#000000', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(hubURL).origin) event.preventDefault(); });
  win.loadURL(hubURL);
}
app.whenReady().then(async () => {
  hubURL = await findHubURL();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
