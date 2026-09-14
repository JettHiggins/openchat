const { io } = require('socket.io-client');
const socket = io(process.env.OPENCHAT_URL || 'http://192.168.50.1:7000');
const timer = setTimeout(() => { console.error('Timed out connecting to the room'); socket.close(); process.exitCode = 1; }, 5000);
socket.on('connect', () => socket.emit('join', { name: 'Connection check' }));
socket.once('room-state', state => {
  console.log(`Connected: ${state.clients.length} participant(s), model ${state.modelReady ? 'ready' : 'offline'}, ${state.messages.length} messages`);
  clearTimeout(timer); socket.close();
});
socket.on('connect_error', error => console.error(error.message));
