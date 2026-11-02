const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const themeId = '139216420925';
const previewOrigin = process.env.SHOPIFY_PREVIEW_ORIGIN || 'https://mysnoozepodtest.myshopify.com';
const outputDir = path.resolve(__dirname, '..', 'docs', 'p1-007', 'shopify-preview');

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
    this.events = new Map();
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
      const waiters = this.events.get(message.method) || [];
      this.events.delete(message.method);
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
      const waiters = this.events.get(method) || [];
      waiters.push(resolve);
      this.events.set(method, waiters);
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}

async function navigate(client, url) {
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url });
  await loaded;
  await evaluate(client, `Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    })))
  ])`);
}

async function configureViewport(client, width, height, mobile) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function capture(client, fileName) {
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(path.join(outputDir, fileName), Buffer.from(screenshot.data, 'base64'));
}

async function assertNoOverflow(client, label) {
  const dimensions = await evaluate(client, `({
    innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(dimensions)}`);
  }
  return dimensions;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p1-007-shopify-preview-'));
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

    const homeUrl = `${previewOrigin}/?preview_theme_id=${themeId}&p1007=${Date.now()}`;
    await configureViewport(client, 1440, 1000, false);
    await navigate(client, homeUrl);
    const cardEvidence = await evaluate(client, `[...document.querySelectorAll('.snoozepod-environment__card')].map((card) => ({
      tag: card.tagName,
      href: card.getAttribute('href'),
      title: card.querySelector('h3')?.textContent?.trim(),
      image: card.querySelector('img')?.currentSrc
    }))`);
    if (cardEvidence.length !== 9 || cardEvidence.some((card) => card.tag !== 'A' || !card.href || !card.image)) {
      const pageEvidence = await evaluate(client, `({
        title: document.title,
        url: location.href,
        text: document.body?.innerText?.slice(0, 600)
      })`);
      throw new Error(`Homepage collection merchandising did not render completely: ${JSON.stringify({ cardEvidence, pageEvidence })}`);
    }
    const desktopHome = await assertNoOverflow(client, 'Desktop homepage');
    await evaluate(client, 'window.scrollTo(0, 0)');
    await capture(client, 'homepage-desktop.jpg');
    await evaluate(client, `document.querySelector('.snoozepod-environment-section').scrollIntoView({block:'start'})`);
    await capture(client, 'homepage-merchandising-desktop.jpg');

    await configureViewport(client, 390, 844, true);
    await evaluate(client, 'window.scrollTo(0, 0)');
    const mobileHome = await assertNoOverflow(client, 'Mobile homepage');
    await capture(client, 'homepage-mobile.jpg');
    await evaluate(client, `document.querySelector('.snoozepod-environment-section').scrollIntoView({block:'start'})`);
    await capture(client, 'homepage-merchandising-mobile.jpg');

    const collectionUrl = `${previewOrigin}/collections/mattresses?preview_theme_id=${themeId}&p1007=${Date.now()}`;
    await configureViewport(client, 1440, 1000, false);
    await navigate(client, collectionUrl);
    const collectionEvidence = await evaluate(client, `({
      heading: document.querySelector('.snoozepod-collection-hero__heading')?.textContent?.trim(),
      heroImage: document.querySelector('.snoozepod-collection-hero__media img')?.currentSrc,
      categoryImages: [...document.querySelectorAll('.snoozepod-collection-navigation img')].filter((image) => image.currentSrc).length
    })`);
    if (!collectionEvidence.heading || !collectionEvidence.heroImage) {
      throw new Error(`Collection hero media did not render: ${JSON.stringify(collectionEvidence)}`);
    }
    const desktopCollection = await assertNoOverflow(client, 'Desktop collection');
    await evaluate(client, 'window.scrollTo(0, 0)');
    await capture(client, 'mattresses-collection-desktop.jpg');

    await configureViewport(client, 390, 844, true);
    const mobileCollection = await assertNoOverflow(client, 'Mobile collection');
    await evaluate(client, 'window.scrollTo(0, 0)');
    await capture(client, 'mattresses-collection-mobile.jpg');

    client.close();
    console.log(JSON.stringify({
      previewThemeId: themeId,
      desktopHome,
      mobileHome,
      desktopCollection,
      mobileCollection,
      cardEvidence,
      collectionEvidence,
      screenshots: [
        'homepage-desktop.jpg',
        'homepage-merchandising-desktop.jpg',
        'homepage-mobile.jpg',
        'homepage-merchandising-mobile.jpg',
        'mattresses-collection-desktop.jpg',
        'mattresses-collection-mobile.jpg',
      ],
    }, null, 2));
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
    const expectedPrefix = path.resolve(os.tmpdir(), 'p1-007-shopify-preview-');
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
