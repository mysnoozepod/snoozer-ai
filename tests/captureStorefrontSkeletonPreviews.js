const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDir = path.resolve(__dirname, '..', 'docs', 'storefront-skeleton', 'previews');
const previewBase = pathToFileURL(path.join(outputDir, 'storefront-skeleton-preview.html')).href;

function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome DevTools did not start. ${stderr}`)), 15000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited early (${code}). ${stderr}`)); });
  });
}

class CdpClient {
  constructor(url) { this.nextId = 1; this.pending = new Map(); this.events = new Map(); this.socket = new WebSocket(url); }
  async connect() {
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); return message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
      const waiters = this.events.get(message.method) || []; this.events.delete(message.method); waiters.forEach((resolve) => resolve(message.params));
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  once(method) { return new Promise((resolve) => { const waiters = this.events.get(method) || []; waiters.push(resolve); this.events.set(method, waiters); }); }
  close() { this.socket.close(); }
}

async function capture(client, name, view, width, height, mobile) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: `${previewBase}?view=${view}` });
  await loaded;
  const dimensions = await client.send('Runtime.evaluate', { expression: '({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})', returnByValue: true });
  if (dimensions.result.value.scrollWidth > dimensions.result.value.clientWidth) throw new Error(`${name} has horizontal overflow`);
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(path.join(outputDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snoozepod-skeleton-preview-'));
  const child = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  try {
    const socket = await waitForDevTools(child);
    const port = new URL(socket).port;
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
    const client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); await client.send('Page.enable');
    await capture(client, 'desktop-navigation.png', 'nav', 1440, 900, false);
    await capture(client, 'mobile-menu.png', 'mobile', 390, 844, true);
    await capture(client, 'collection-page.png', 'collection', 1440, 1000, false);
    client.close();
    console.log('PASS storefront skeleton previews: desktop navigation, mobile menu, collection page.');
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); });
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
