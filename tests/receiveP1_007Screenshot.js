const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const outputDir = path.resolve(__dirname, '..', 'docs', 'p1-007', 'shopify-preview');
const allowedName = /^[a-z0-9-]+\.(?:jpe?g|png)$/;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const name = url.searchParams.get('name') || '';
    if (request.method !== 'POST' || url.pathname !== '/save' || !allowedName.test(name)) {
      response.writeHead(400).end('invalid request');
      return;
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) {
      response.writeHead(413).end('invalid image size');
      return;
    }

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, name), bytes);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name, bytes: bytes.length }));
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});

server.listen(38117, '127.0.0.1', () => {
  console.log(`P1-007 screenshot receiver listening on http://127.0.0.1:38117 (${outputDir})`);
});
