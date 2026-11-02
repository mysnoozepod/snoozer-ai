import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "docs", "p1-007", "PRODUCT_MEDIA_LIBRARY.json");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return { width: null, height: null };
}

async function fetchToFile(url, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    const temporary = `${target}.part`;
    let response;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      response = await fetch(url, { redirect: "follow" });
      if (response.ok) break;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
    if (!response?.ok || !response.body) throw new Error(`HTTP ${response?.status || "unknown"} for ${url}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    fs.renameSync(temporary, target);
  }
  const buffer = fs.readFileSync(target);
  return {
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    ...imageDimensions(buffer),
  };
}

const assets = manifest.products.flatMap((product) =>
  product.supportingImageOrder.map((asset) => ({ product, asset })),
);
let nextIndex = 0;
let completed = 0;

async function worker() {
  while (nextIndex < assets.length) {
    const current = nextIndex;
    nextIndex += 1;
    const { product, asset } = assets[current];
    const metadata = await fetchToFile(asset.sourceUrl, asset.localPath);
    Object.assign(asset, metadata, {
      resolutionStatus: metadata.width && metadata.height ? "Verified from archived source file" : asset.resolutionStatus,
      archivedAt: new Date().toISOString(),
    });
    const available = product.availableAssets.find((candidate) => candidate.sourceId === asset.sourceId);
    if (available) Object.assign(available, metadata);
    completed += 1;
    if (completed % 10 === 0 || completed === assets.length) {
      console.log(`Archived ${completed}/${assets.length} selected assets.`);
    }
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
manifest.archive = {
  completedAt: new Date().toISOString(),
  root: manifest.privateAssetRoot,
  selectedAssets: assets.length,
  bytes: assets.reduce((sum, entry) => sum + (entry.asset.bytes || 0), 0),
  sha256Recorded: assets.every((entry) => Boolean(entry.asset.sha256)),
};
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.archive, null, 2));
