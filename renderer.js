const socket = io();
const $ = id => document.getElementById(id);
const prompt = $('prompt');
const messages = $('messages');
let state = { clients: [], messages: [], revision: 0, draft: '', scroll: 1 };
let name = sessionStorage.getItem('openchat-name');
if (!name) { name = `Guest ${Math.floor(100 + Math.random() * 900)}`; sessionStorage.setItem('openchat-name', name); }
let draftFlight = false;
let pendingDraft = null;
let appliedScrollTop = null;
let scrollTimer;
const cursors = new Map();

function controls() {
  $('clear').disabled = !socket.connected || (!state.messages.length && !state.draft);
  $('send').disabled = !socket.connected || !state.modelReady || !!state.active || draftFlight || pendingDraft !== null || !prompt.value.trim();
  $('send').hidden = !!state.active;
  $('stop').hidden = !state.active;
  $('stop').disabled = !socket.connected;
  prompt.disabled = !socket.connected;
}
function sendDraft() {
  if (draftFlight || pendingDraft === null || !socket.connected) return;
  draftFlight = true;
  socket.emit('draft-update', { text: pendingDraft, revision: state.revision });
  pendingDraft = null;
  controls();
}
function applyScroll(value) {
  appliedScrollTop = value * Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = appliedScrollTop;
}
function renderMessages() {
  messages.replaceChildren();
  for (const message of state.messages) {
    const article = document.createElement('article'); article.className = `message ${message.role}`;
    const heading = document.createElement('div'); heading.className = 'message-header';
    heading.textContent = message.role === 'assistant' ? 'Qwen3 4B' : message.name;
    const body = document.createElement('div'); body.className = 'message-body'; body.id = `message-${message.id}`;
    body.textContent = message.content || (message.status === 'streaming' ? 'Thinking…' : '');
    const status = document.createElement('div'); status.className = 'message-status';
    status.textContent = message.error || (message.status !== 'complete' ? message.status : '');
    article.append(heading, body, status); messages.append(article);
  }
  applyScroll(state.scroll);
}
function renderPeople() {
  $('people').replaceChildren();
  for (const client of state.clients) {
    const item = document.createElement('span'); item.className = 'person';
    item.textContent = `${client.name}${client.id === socket.id ? ' (you)' : ''}`;
    $('people').append(item);
  }
  for (const [id, cursor] of cursors) {
    if (!state.clients.some(client => client.id === id)) { cursor.element.remove(); cursors.delete(id); }
  }
}
socket.on('connect', () => {
  $('connection').textContent = '';
  draftFlight = false; pendingDraft = null;
  socket.emit('join', { name });
  controls();
});
socket.on('disconnect', () => {
  $('connection').textContent = 'Disconnected. Reconnecting…';
  for (const cursor of cursors.values()) cursor.element.remove();
  cursors.clear(); controls();
});
socket.on('connect_error', () => { $('connection').textContent = 'Waiting for Uno Q…'; controls(); });
socket.on('room-state', next => {
  state = next; draftFlight = false;
  // An authoritative snapshot resolves concurrent edits rather than overwriting newer room text.
  pendingDraft = null; prompt.value = state.draft;
  $('model-status').textContent = state.active ? 'Generating…' : state.modelReady ? 'Model ready' : 'Model offline';
  renderPeople(); renderMessages(); controls();
});
socket.on('draft-state', ({ text, revision }) => {
  if (revision <= state.revision) return;
  state.draft = text; state.revision = revision;
  draftFlight = false;
  if (pendingDraft === null) prompt.value = text;
  sendDraft(); controls();
});
socket.on('chat-chunk', ({ id, text }) => {
  const message = state.messages.find(item => item.id === id);
  if (!message) { socket.emit('sync', {}); return; }
  message.content += text;
  $(`message-${id}`).textContent = message.content;
  applyScroll(state.scroll);
});
socket.on('room-error', ({ message }) => { $('notice').textContent = message; controls(); });
socket.on('scroll-state', ({ value }) => { state.scroll = value; applyScroll(value); });
socket.on('cursor-update', packet => {
  if (packet.id === socket.id) return;
  const person = state.clients.find(client => client.id === packet.id); if (!person) return;
  let cursor = cursors.get(packet.id);
  if (!cursor) {
    const element = document.createElement('div'); element.className = 'cursor';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 20 24');
    const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', 'M2 2 L17 15 L10 15 L7 22 Z'); shape.setAttribute('fill', '#fff'); shape.setAttribute('stroke', '#000'); svg.append(shape);
    const label = document.createElement('span'); label.textContent = person.name; element.append(svg, label); $('cursors').append(element);
    cursor = { element }; cursors.set(packet.id, cursor);
  }
  cursor.packet = packet; cursor.updated = Date.now();
  cursor.element.hidden = packet.visible === false;
  cursor.element.style.transform = `translate(${packet.x * innerWidth}px, ${packet.y * innerHeight}px)`;
});
let lastCursor = 0;
window.addEventListener('pointermove', event => {
  if (!socket.connected || performance.now() - lastCursor < 40) return;
  lastCursor = performance.now();
  socket.volatile.emit('cursor-update', { x: event.clientX / innerWidth, y: event.clientY / innerHeight, visible: true });
});
document.addEventListener('pointerleave', () => { if (socket.connected) socket.emit('cursor-update', { x: 0, y: 0, visible: false }); });
setInterval(() => { for (const cursor of cursors.values()) if (Date.now() - cursor.updated > 15000) cursor.element.hidden = true; }, 3000);
window.addEventListener('resize', () => {
  applyScroll(state.scroll);
  for (const { element, packet } of cursors.values()) element.style.transform = `translate(${packet.x * innerWidth}px, ${packet.y * innerHeight}px)`;
});
messages.addEventListener('scroll', () => {
  if (!socket.connected || (appliedScrollTop !== null && Math.abs(messages.scrollTop - appliedScrollTop) < 1)) return;
  appliedScrollTop = null;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const range = messages.scrollHeight - messages.clientHeight;
    state.scroll = range > 0 ? messages.scrollTop / range : 1;
    socket.volatile.emit('scroll-update', { value: state.scroll });
  }, 40);
});
prompt.addEventListener('input', () => { pendingDraft = prompt.value; sendDraft(); controls(); });
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('send').disabled) $('composer').requestSubmit(); }
});
$('composer').addEventListener('submit', event => {
  event.preventDefault(); if ($('send').disabled) return;
  $('notice').textContent = '';
  socket.emit('chat-send', { text: prompt.value, revision: state.revision });
});
$('clear').addEventListener('click', () => {
  if (window.confirm('Clear the chat history and draft for everyone?')) {
    $('notice').textContent = '';
    socket.emit('chat-clear', {});
  }
});
$('stop').addEventListener('click', () => socket.emit('chat-stop', {}));
controls();
