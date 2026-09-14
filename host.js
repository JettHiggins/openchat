const { io } = require('socket.io-client');
const fs = require('node:fs');
const path = require('node:path');

function startHost() {
  const token = process.env.OPENCHAT_HOST_TOKEN || fs.readFileSync(path.join(__dirname, '.local/host-token'), 'utf8').trim();
  const endpoint = process.env.MODEL_URL || 'http://127.0.0.1:8080';
  const modelToken = process.env.MODEL_API_KEY || fs.readFileSync(path.join(__dirname, '.local/model-token'), 'utf8').trim();
  const socket = io(process.env.OPENCHAT_URL || 'http://192.168.50.1:7000', { reconnection: true });
  let active;
  let accepted = false;
  let lastReady;
  async function health(register = false) {
    let ready = false;
    try { ready = (await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
    if (!socket.connected) return;
    if (register) socket.emit('worker-register', { token, ready });
    else if (accepted && ready !== lastReady) socket.emit('worker-status', { ready });
    lastReady = ready;
  }
  socket.on('connect', () => { accepted = false; health(true); });
  socket.on('worker-accepted', () => { accepted = true; console.log('Model bridge connected to Uno Q'); });
  socket.on('room-error', data => console.error(data.message));
  socket.on('connect_error', error => console.error(`Q connection: ${error.message}`));
  socket.on('disconnect', () => { accepted = false; active?.controller.abort(); });
  socket.on('model-cancel', data => { if (active?.id === data.id) active.controller.abort(); });
  socket.on('model-request', async ({ id, messages }) => {
    if (active) { socket.emit('model-error', { id, message: 'Model is finishing the previous request. Try again.' }); return; }
    const controller = new AbortController();
    active = { id, controller };
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelToken}` }, signal: controller.signal,
        body: JSON.stringify({ messages, stream: true, max_tokens: 384, temperature: 0.7,
          chat_template_kwargs: { enable_thinking: false } })
      });
      if (!response.ok) throw new Error(`Model HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (!line.startsWith('data:')) continue;
          const value = line.slice(5).trim();
          if (value === '[DONE]') { completed = true; continue; }
          const packet = JSON.parse(value);
          if (packet.error) throw new Error(packet.error.message || 'Inference failed');
          const text = packet.choices?.[0]?.delta?.content;
          if (text) socket.emit('model-chunk', { id, text });
        }
      }
      if (!completed) throw new Error('Model stream ended unexpectedly.');
      socket.emit('model-done', { id });
    } catch (error) {
      socket.emit('model-error', { id, message: error.name === 'AbortError' ? 'Generation stopped or timed out.' : error.message });
    } finally { clearTimeout(timeout); active = null; }
  });
  const timer = setInterval(health, 5000);
  return () => { clearInterval(timer); active?.controller.abort(); socket.disconnect(); };
}
if (require.main === module) {
  const stop = startHost();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
}
module.exports = { startHost };
