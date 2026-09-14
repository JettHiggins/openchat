// Starts the laptop's model and outbound bridge. The Q serves the UI to everyone.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { hubURL } = require('../hub-url');
process.chdir(path.resolve(__dirname, '..'));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${command} exited (${code}).`); stop(code || 1); } });
}
async function main() {
  if (!fs.existsSync('.local/host-token')) throw new Error('Deploy to the Q first: npm run deploy');
  if (!fs.existsSync('.local/llama.cpp/build/bin/llama-server') || !fs.existsSync('.local/models/Qwen3-4B-Q4_K_M.gguf')) throw new Error('Install the model first: npm run setup:model');
  let modelAlreadyRunning = false;
  try { await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1000) }); modelAlreadyRunning = true; } catch {}
  if (modelAlreadyRunning) throw new Error('A model server is already using port 8080. Keep using the running hub, or stop it before starting another.');
  const url = await hubURL();
  console.log(`Openchat hub: ${url}\nOpen this address in a browser, or run npm start.\nKeep this terminal open. Ctrl+C stops the laptop host.`);
  launch('bash', ['scripts/model.sh']);
  // model.sh creates the key before starting llama-server.
  for (let i = 0; i < 30 && !stopping; i++) {
    if (fs.existsSync('.local/model-token')) {
      launch(process.execPath, ['host.js'], { ...process.env, OPENCHAT_URL: url });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!stopping) throw new Error('Model did not create its local API key.');
}
main().catch(error => { console.error(error.message); stop(1); });
