window.socketAPI.onConnect( () => {
  console.log("Connected")
})

window.socketAPI.onHello( (value) => {
  const parentElement = document.getElementById("messages");
  parentElement.innerHTML += '<div>Hello</div>'
})

window.addEventListener('mousemove', (event) => {
  const packet = {mouseX : event.clientX, mouseY : event.clientY, Width : window.innerWidth, Height : window.innerHeight};
  window.socketAPI.sendCursor(packet);
}) 
