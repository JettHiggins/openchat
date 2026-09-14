const { execFileSync } = require('node:child_process');
async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
async function hubURL() {
  if (process.env.OPENCHAT_URL) return process.env.OPENCHAT_URL;
  const wifi = 'http://192.168.50.1:7000';
  if (await reachable(wifi)) return wifi;
  try {
    execFileSync('adb', ['forward', 'tcp:7000', 'tcp:7000'], { stdio: 'ignore', timeout: 5000 });
    if (await reachable('http://127.0.0.1:7000')) return 'http://127.0.0.1:7000';
  } catch {}
  return wifi;
}
module.exports = { hubURL };
