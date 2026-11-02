const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const previewBase = 'http://127.0.0.1:8765/docs/p1-005ux/previews/p1-005ux-preview.html';
const outputDir = path.resolve(__dirname, '..', 'docs', 'p1-005ux', 'previews');

function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Chrome DevTools did not start. ${stderr}`)), 15000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (code ${code}). ${stderr}`));
    });
  });
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const waiters = this.eventWaiters.get(message.method) || [];
      this.eventWaiters.delete(message.method);
      waiters.forEach((resolve) => resolve(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push(resolve);
      this.eventWaiters.set(method, waiters);
    });
  }

  close() {
    this.socket.close();
  }
}

async function capture(client, { name, view, width, height, mobile }) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: `${previewBase}?view=${view}` });
  await loaded;
  await client.send('Runtime.evaluate', {
    expression: 'document.fonts && document.fonts.ready',
    awaitPromise: true,
    returnByValue: true,
  });
  await client.send('Runtime.evaluate', {
    expression: 'window.scrollTo(0, 0)',
    returnByValue: true,
  });
  const dimensions = await client.send('Runtime.evaluate', {
    expression: '({ innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })',
    returnByValue: true,
  });
  if (dimensions.result.value.scrollWidth > dimensions.result.value.clientWidth) {
    throw new Error(`${name} has horizontal overflow: ${JSON.stringify(dimensions.result.value)}`);
  }
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(path.join(outputDir, name), Buffer.from(screenshot.data, 'base64'));
  return dimensions.result.value;
}

async function main() {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snoozepod-preview-'));
  const child = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  try {
    const browserSocket = await waitForDevTools(child);
    const port = new URL(browserSocket).port;
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');

    const results = [];
    results.push(await capture(client, { name: 'product-v1-desktop.png', view: 'product', width: 1440, height: 1200, mobile: false }));
    results.push(await capture(client, { name: 'product-v1-mobile.png', view: 'product', width: 390, height: 844, mobile: true }));
    results.push(await capture(client, { name: 'collection-v1-desktop.png', view: 'collection', width: 1440, height: 1200, mobile: false }));
    results.push(await capture(client, { name: 'collection-v1-mobile.png', view: 'collection', width: 390, height: 844, mobile: true }));
    client.close();
    console.log(`PASS P1-005UX previews: ${JSON.stringify(results)}`);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
    const expectedPrefix = path.resolve(os.tmpdir(), 'snoozepod-preview-');
    if (!path.resolve(profileDir).startsWith(expectedPrefix)) {
      throw new Error(`Refusing to remove unexpected preview profile path: ${profileDir}`);
    }
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
