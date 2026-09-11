const { io } =  require('socket.io-client');

const socket = io('http://localhost:7000');

socket.on('connect', () => { 
  console.log("Connected") 
});

socket.on('hello', (data) => {
  console.log(data);
});
