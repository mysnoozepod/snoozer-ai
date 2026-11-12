import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fixture = path.join(root, 'tests', 'fixtures', 'sleep-system-configurator.browser.html');
if (!fs.existsSync(chrome)) throw new Error('Chrome is unavailable for the focused browser fixture.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snoozepod-configurator-'));
let output = '';
try {
  output = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--dump-dom', pathToFileURL(fixture).href], { encoding: 'utf8', timeout: 30000 });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
if (!/id="fixture-result" data-result="pass"/.test(output)) {
  const detail = output.match(/<pre id="fixture-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1] || 'Browser fixture did not return a result.';
  throw new Error(`Sleep System browser fixture failed: ${detail}`);
}
console.log('PASS Sleep System configurator browser fixture: size, base, Pod label, and Dual Comfort interactions.');
