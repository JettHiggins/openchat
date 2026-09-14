const { app, BrowserWindow, ipcMain} = require('electron/main')
const path = require('node:path')

const { io } = require('socket.io-client');
const socket = io('http://192.168.50.1:7000');



const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  ipcMain.on('cursor-update', (event, packet) => {
    console.log("Sending packet")
    socket.emit('cursor-update', packet)
  })

  socket.on('connected', () => { 
    console.log("Connected")
    win.webContents.send('connected');
  });

  socket.on('hello', (data) => {
    console.log("Hello")
    win.webContents.send('hello', data);
  });

  socket.on('user-cursor-packets', (packet) => {
    console.log("User packets recieved")
    console.log(packet)
  });

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
