const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDir = path.resolve(__dirname, '..', 'docs', 'catalog', 'fixture-preview');
const previewBase = pathToFileURL(path.join(outputDir, 'catalog-shopping-restructure-fixture.html')).href;

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
  constructor(url) { this.nextId = 1; this.pending = new Map(); this.waiters = new Map(); this.socket = new WebSocket(url); }
  async connect() {
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); return; }
      const waiters = this.waiters.get(message.method) || []; this.waiters.delete(message.method); waiters.forEach((resolve) => resolve(message.params));
    });
  }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  once(method) { return new Promise((resolve) => { const waiters = this.waiters.get(method) || []; waiters.push(resolve); this.waiters.set(method, waiters); }); }
  close() { this.socket.close(); }
}

async function navigate(client, url) {
  const loaded = client.once('Page.loadEventFired'); await client.send('Page.navigate', { url }); await loaded;
  await client.send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true, returnByValue: true });
}

async function capture(client, name, view, width, height, mobile, scrollY = 0) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await navigate(client, `${previewBase}?view=${view}`);
  if (scrollY) await client.send('Runtime.evaluate', { expression: `window.scrollTo(0, ${scrollY})`, returnByValue: true });
  const dimensions = await client.send('Runtime.evaluate', { expression: '({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})', returnByValue: true });
  if (dimensions.result.value.scrollWidth > dimensions.result.value.clientWidth) throw new Error(`${name} has horizontal overflow.`);
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(path.join(outputDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snoozepod-catalog-preview-'));
  const child = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  try {
    const browserSocket = await waitForDevTools(child); const port = new URL(browserSocket).port;
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
    const client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); await client.send('Page.enable');
    await capture(client, 'standard-product-desktop.png', 'standard', 1440, 1100, false);
    await capture(client, 'dual-comfort-desktop.png', 'dual', 1440, 1200, false);
    await capture(client, 'dual-comfort-mobile.png', 'dual', 390, 844, true);
    await capture(client, 'dual-comfort-mobile-controls.png', 'dual', 390, 844, true, 880);

    await navigate(client, `${previewBase}?view=standard`);
    const standard = await client.send('Runtime.evaluate', { expression: `(()=>{const form=document.querySelector('form');form.requestSubmit();return {enabled:!form.querySelector('[name=add]').disabled,result:document.querySelector('.cart-result').textContent}})()`, returnByValue: true });
    if (!standard.result.value.enabled || !/variant 7001/.test(standard.result.value.result)) throw new Error(`Standard cart fixture failed: ${JSON.stringify(standard.result.value)}`);

    await navigate(client, `${previewBase}?view=dual`);
    const unsupported = await client.send('Runtime.evaluate', { expression: `(()=>{document.querySelector('#left-0').click();document.querySelector('#right-3').click();const form=document.querySelector('form');form.requestSubmit();return {disabled:form.querySelector('[name=add]').disabled,result:document.querySelector('.cart-result').textContent,summary:document.querySelector('[data-dual-comfort-summary]').textContent}})()`, returnByValue: true });
    if (!unsupported.result.value.disabled || unsupported.result.value.result) throw new Error(`Unsupported Dual Comfort did not fail closed: ${JSON.stringify(unsupported.result.value)}`);

    await navigate(client, `${previewBase}?view=dual-mapped`);
    const mapped = await client.send('Runtime.evaluate', { expression: `(()=>{document.querySelector('#left-0').click();document.querySelector('#right-3').click();const form=document.querySelector('form');form.requestSubmit();return {enabled:!form.querySelector('[name=add]').disabled,result:document.querySelector('.cart-result').textContent,left:new FormData(form).get('properties[Left Side Comfort]'),right:new FormData(form).get('properties[Right Side Comfort]')}})()`, returnByValue: true });
    if (!mapped.result.value.enabled || mapped.result.value.left !== '0.0' || mapped.result.value.right !== '3.0' || !/variant 9001/.test(mapped.result.value.result)) throw new Error(`Mapped Dual Comfort fixture failed: ${JSON.stringify(mapped.result.value)}`);
    client.close();
    console.log(`PASS fixture shopping flow: ${JSON.stringify({ standard: standard.result.value, unsupported: unsupported.result.value, mapped: mapped.result.value })}`);
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); });
    const expectedPrefix = path.resolve(os.tmpdir(), 'snoozepod-catalog-preview-');
    if (!path.resolve(profileDir).startsWith(expectedPrefix)) throw new Error(`Refusing unexpected profile removal: ${profileDir}`);
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
