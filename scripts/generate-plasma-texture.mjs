/**
 * Procedural accretion-flow material, not a rendered black-hole background.
 * Run: node scripts/generate-plasma-texture.mjs
 *
 * Sampling: U = azimuth / (2*pi), V = normalized disk radius.
 * R/B = original flow, G = gently combed version of that same flow, A = 255.
 * Both axes are periodic.
 * Use REPEAT + LINEAR_MIPMAP_LINEAR. Color, radial falloff, motion, lensing and
 * lighting belong in the real-time renderer. There are no baked rings/camera.
 * Integer noise periods guarantee seamless wrap without a crossfade strip.
 */
import {writeFile, mkdir} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const parameters = Object.freeze({
  width: 4096, height: 2048, seed: 0x4e4f5845,
  broadWarp: 0.044, mediumWarp: 0.014, fineWarp: 0.0035,
  mainSharpness: 23, branchSharpness: 29, fineSharpness: 36,
  exposure: 1.09, samples: 4,
});
const {width, height, seed} = parameters;
const sampleSide = Math.sqrt(parameters.samples);
if (!Number.isInteger(sampleSide)) throw Error('Texture sample count must form a square grid.');
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = n => n * n * n * (n * (n * 6 - 15) + 10);
let randomState = seed;
function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
}
function noiseGrid(columns, rows) {
  const data = Float32Array.from({length: columns * rows}, () => random() * 2 - 1);
  return (u, v) => {
    const x = (u - Math.floor(u)) * columns, y = (v - Math.floor(v)) * rows;
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const jx = (ix + 1) % columns, jy = (iy + 1) % rows;
    const a = data[iy * columns + ix], b = data[iy * columns + jx];
    const c = data[jy * columns + ix], d = data[jy * columns + jx];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}
const warpBroad = noiseGrid(5, 8), warpMedium = noiseGrid(14, 21), warpFine = noiseGrid(35, 51);
const stretch = noiseGrid(7, 13), veil = noiseGrid(11, 23), pockets = noiseGrid(17, 41);
// These strongly anisotropic domains draw long, unequal, splitting flow lines.
const primary = noiseGrid(9, 91), branch = noiseGrid(18, 149), fine = noiseGrid(29, 241);
const knots = noiseGrid(39, 71), illumination = noiseGrid(5, 19);
const companion = noiseGrid(13, 119), lace = noiseGrid(41, 307);

function energy(u, v, combed = false) {
  const broad = warpBroad(u, v), medium = warpMedium(u, v);
  // G uses the same original irregular strands, knots, gaps and illumination.
  // Only their displacement is gentler; no separate radial ring template exists.
  const warpScale = combed ? 0.4 : 1;
  const wu = u + stretch(u, v) * 0.018 * (combed ? 0.6 : 1);
  const wv = v + broad * parameters.broadWarp * warpScale + medium * parameters.mediumWarp * warpScale
    + warpFine(u, v) * parameters.fineWarp * warpScale;
  const a = primary(wu, wv), b = branch(wu + 0.013, wv + a * 0.004);
  const c = fine(wu - 0.017, wv + b * 0.002);
  const d = companion(wu + 0.079, wv + a * 0.003);
  const e = lace(wu + 0.031, wv + d * 0.0014);
  const gate = clamp(0.5 + veil(u, v) * 0.71 + pockets(u, v) * 0.27);
  const excitation = 0.3 + 0.7 * clamp(0.58 + illumination(u, v) * 0.67);
  const filament = Math.exp(-Math.abs(a) * parameters.mainSharpness);
  const tributary = Math.exp(-Math.abs(b) * parameters.branchSharpness);
  const hairline = Math.exp(-Math.abs(c) * parameters.fineSharpness);
  const fiber = Math.exp(-Math.abs(d) * 20);
  const tendril = Math.exp(-Math.abs(e) * 31);
  const brightKnot = clamp(knots(u, v) * 1.5 + 0.3);
  const haze = Math.pow(clamp((1 - Math.abs(a)) * gate), 4) * 0.025;
  // Black gaps are intentionally preserved; no global gray base or white noise.
  return (filament * (0.39 + gate * 0.86) + tributary * (0.15 + gate * 0.32) * (0.6 + brightKnot * 0.7)
    + hairline * (0.1 + gate * 0.2) + fiber * (0.2 + gate * 0.4)
    + tendril * (0.07 + gate * 0.16) + haze) * excitation;
}

const combedEnergy = (u, v) => energy(u, v, true);

const started = performance.now();
let periodicError = 0;
for (let i = 0; i < 64; i++) {
  const u = i / 63, v = ((i * 17) % 64) / 64;
  periodicError = Math.max(periodicError,
    Math.abs(energy(u, v) - energy(u + 1, v)),
    Math.abs(energy(u, v) - energy(u, v + 1)),
    Math.abs(combedEnergy(u, v) - combedEnergy(u + 1, v)),
    Math.abs(combedEnergy(u, v) - combedEnergy(u, v + 1)));
}
if (periodicError > 1e-9) throw Error(`Texture seam check failed: ${periodicError}`);
const pixels = Buffer.alloc((width * 4 + 1) * height);
let minimum = 255, maximum = 0, sum = 0, lit = 0;
let combedMinimum = 255, combedMaximum = 0, combedSum = 0, combedLit = 0;
for (let y = 0; y < height; y++) {
  const line = y * (width * 4 + 1);
  pixels[line] = 1; // PNG Sub filter keeps the smooth flow channels compact.
  for (let x = 0; x < width; x++) {
    // Cover both axes with a stratified 2D grid before generating GPU mipmaps.
    // Sampling only the diagonal can skip narrow wisps aligned with that diagonal.
    let value = 0, combedValue = 0;
    for (let s = 0; s < parameters.samples; s++) {
      const offsetX = ((s % sampleSide) + 0.5) / sampleSide;
      const offsetY = (Math.floor(s / sampleSide) + 0.5) / sampleSide;
      value += energy((x + offsetX) / width, (y + offsetY) / height);
      combedValue += combedEnergy((x + offsetX) / width, (y + offsetY) / height);
    }
    const encoded = Math.round(clamp(value / parameters.samples * parameters.exposure) * 255);
    const combedEncoded = Math.round(clamp(combedValue / parameters.samples * parameters.exposure) * 255);
    const at = line + 1 + x * 4;
    pixels[at] = pixels[at + 2] = encoded;
    pixels[at + 1] = combedEncoded;
    pixels[at + 3] = 255;
    minimum = Math.min(minimum, encoded); maximum = Math.max(maximum, encoded);
    sum += encoded; if (encoded > 100) lit++;
    combedMinimum = Math.min(combedMinimum, combedEncoded); combedMaximum = Math.max(combedMaximum, combedEncoded);
    combedSum += combedEncoded; if (combedEncoded > 100) combedLit++;
  }
  // Work backwards so each residual uses the original preceding RGBA pixel.
  // This is lossless: filtering changes transfer size, not material detail.
  for (let i = width * 4; i > 4; i--) pixels[line + i] = (pixels[line + i] - pixels[line + i - 4]) & 255;
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let j = 0; j < 8; j++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(name, data) {
  const type = Buffer.from(name), content = Buffer.concat([type, data]);
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
  chunk('tEXt', Buffer.from('Description\0Deterministic periodic linear plasma flow; R/B original, G same irregular flow with gentler displacement; U azimuth, V disk radius.')),
  chunk('IDAT', deflateSync(pixels, {level: 9})), chunk('IEND', Buffer.alloc(0)),
]);
const output = new URL('../public/assets/plasma-flow.png', import.meta.url);
await mkdir(new URL('../public/assets/', import.meta.url), {recursive: true});
await writeFile(output, png);
console.log(JSON.stringify({output: fileURLToPath(output), width, height, seed, bytes: png.length,
  seconds: +((performance.now() - started) / 1000).toFixed(2), minimum, maximum,
  mean: +(sum / (width * height)).toFixed(2), brightFraction: +(lit / (width * height)).toFixed(4),
  combed: {minimum: combedMinimum, maximum: combedMaximum,
    mean: +(combedSum / (width * height)).toFixed(2), brightFraction: +(combedLit / (width * height)).toFixed(4)},
  periodicError}, null, 2));
