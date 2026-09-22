/**
 * Precompute lower-memory material LODs without changing either source PNG.
 * Run: node scripts/generate-standard-textures.mjs
 *
 * Channels are linear data, not display colors: no gamma, color-profile or
 * alpha-premultiplication conversion. Exact area averaging is a 2x2 box for
 * the flow texture and handles the non-power-of-two turbulence source directly.
 * Uses only Node built-ins; supports non-interlaced 8-bit RGB/RGBA PNGs.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {inflateSync, deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function decodePng(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(signature), 'Invalid PNG signature');
  let header, ended = false;
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    assert.ok(end <= bytes.length, 'Truncated PNG payload');
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    assert.equal(crc32(bytes.subarray(offset + 4, end - 4)), bytes.readUInt32BE(end - 4), `Invalid ${name} CRC`);
    if (name === 'IHDR') {
      assert.ok(!header && length === 13, 'Invalid IHDR');
      header = data;
    } else if (name === 'IDAT') compressed.push(data);
    else if (name === 'IEND') { ended = true; break; }
    offset = end;
  }
  assert.ok(header && ended && compressed.length, 'Incomplete PNG');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), colorType = header[9];
  assert.ok(width > 0 && height > 0, 'PNG dimensions must be positive');
  assert.equal(header[8], 8, 'Only 8-bit material PNGs are supported');
  assert.ok(colorType === 2 || colorType === 6, 'Only RGB/RGBA material PNGs are supported');
  assert.ok(header[10] === 0 && header[11] === 0 && header[12] === 0, 'Unsupported compression, filter method or interlaced PNG');
  const channels = colorType === 6 ? 4 : 3, stride = width * channels;
  const expected = (stride + 1) * height;
  const packed = inflateSync(Buffer.concat(compressed), {maxOutputLength: expected});
  assert.equal(packed.length, expected, 'Unexpected PNG decoded length');
  const pixels = Buffer.alloc(stride * height), filterCounts = [0, 0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    const input = y * (stride + 1), output = y * stride, filter = packed[input];
    assert.ok(filter <= 4, `Unknown PNG row filter ${filter}`);
    filterCounts[filter]++;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[output + x - channels] : 0;
      const b = y ? pixels[output + x - stride] : 0;
      const c = y && x >= channels ? pixels[output + x - stride - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b
        : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      pixels[output + x] = (packed[input + 1 + x] + predictor) & 255;
    }
  }
  return {width, height, channels, pixels, filterCounts};
}

function areaSpans(sourceSize, targetSize) {
  const scale = sourceSize / targetSize;
  return Array.from({length: targetSize}, (_, i) => {
    const start = i * scale, end = (i + 1) * scale, span = [];
    for (let sample = Math.floor(start); sample < Math.ceil(end); sample++) {
      const weight = Math.min(end, sample + 1) - Math.max(start, sample);
      if (weight > 0 && sample < sourceSize) span.push([sample, weight / scale]);
    }
    return span;
  });
}

export function boxResize(source, width, height) {
  assert.ok(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0, 'Invalid output size');
  assert.ok(width <= source.width && height <= source.height, 'Material LOD must not upscale its source');
  const channels = source.channels, pixels = Buffer.alloc(width * height * channels);
  const xs = areaSpans(source.width, width), ys = areaSpans(source.height, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const output = (y * width + x) * channels;
    for (let channel = 0; channel < channels; channel++) {
      let sum = 0;
      for (const [sy, wy] of ys[y]) for (const [sx, wx] of xs[x]) {
        sum += source.pixels[(sy * source.width + sx) * channels + channel] * wx * wy;
      }
      pixels[output + channel] = Math.round(sum);
    }
  }
  return {width, height, channels, pixels};
}

function chunk(name, data) {
  const type = Buffer.from(name), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); type.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

export function encodePng({width, height, channels, pixels}) {
  assert.ok(channels === 3 || channels === 4, 'Expected RGB/RGBA pixels');
  const stride = width * channels;
  assert.equal(pixels.length, stride * height, 'Unexpected pixel buffer length');
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1), source = y * stride;
    rows[at] = 1; // Lossless Sub prediction; does not alter material samples.
    for (let x = 0; x < stride; x++) rows[at + 1 + x] =
      (pixels[source + x] - (x >= channels ? pixels[source + x - channels] : 0)) & 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

function channelStatistics({pixels, channels}) {
  return Array.from({length: channels}, (_, channel) => {
    let min = 255, max = 0, sum = 0;
    for (let i = channel; i < pixels.length; i += channels) {
      min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); sum += pixels[i];
    }
    return {channel: 'RGBA'[channel], min, max, mean: +(sum / (pixels.length / channels)).toFixed(6)};
  });
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const inputs = [
    {source: 'plasma-flow.png', output: 'plasma-flow-standard.png', width: 2048, height: 1024},
    {source: 'plasma-turbulence.png', output: 'plasma-turbulence-standard.png', width: 1024, height: 512},
  ];
  const receipts = [];
  for (const item of inputs) {
    const inputPath = new URL(`../public/assets/${item.source}`, import.meta.url);
    const outputPath = new URL(`../public/assets/${item.output}`, import.meta.url);
    const bytes = await readFile(inputPath), source = decodePng(bytes);
    assert.equal(source.width * item.height, source.height * item.width, 'Material aspect ratio must be preserved');
    const resized = boxResize(source, item.width, item.height), output = encodePng(resized);
    const roundTrip = decodePng(output);
    assert.ok(roundTrip.pixels.equals(resized.pixels), 'PNG round trip changed material samples');
    await writeFile(outputPath, output);
    const sourceHash = sha256(bytes);
    assert.equal(sha256(await readFile(inputPath)), sourceHash, 'Source texture changed during generation');
    receipts.push({source: item.source, sourceSha256: sourceHash, sourceSize: [source.width, source.height],
      sourceFilterCounts: source.filterCounts, sourceChannels: channelStatistics(source),
      output: fileURLToPath(outputPath), outputSize: [resized.width, resized.height], bytes: output.length,
      outputSha256: sha256(output), outputChannels: channelStatistics(resized), sourceUnchanged: true});
  }
  console.log(JSON.stringify(receipts, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
