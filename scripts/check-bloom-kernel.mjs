// CPU-only regression for the actual shader's bloom sampling footprint.
// This does not compile GLSL or replace fixed-camera GPU image comparisons.
// Run from any directory: node scripts/check-bloom-kernel.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/blackhole.js', import.meta.url), 'utf8');
const number = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function readTaps(text) {
  const shader = text.match(/const\s+blurFragment\s*=\s*`([\s\S]*?)`;/)?.[1];
  assert.ok(shader, 'Cannot find the bloom fragment shader');
  const main = withoutComments(shader).match(/void\s+main\s*\(\s*\)\s*\{([\s\S]*?)gl_FragColor/)?.[1];
  assert.ok(main, 'Cannot find the bloom kernel body');
  const centerPattern = new RegExp(String.raw`vec3\s+c\s*=\s*sampleLight\(\s*vUv\s*\)\s*\*\s*(${number})\s*;`);
  const center = main.match(centerPattern);
  assert.ok(center, 'Unrecognized center sample; update the parser before changing kernel syntax');
  const taps = [{ offset: 0, weight: Number(center[1]) }];
  const pairPattern = new RegExp(String.raw`c\s*\+=\s*\(\s*sampleLight\(\s*vUv\s*\+\s*uStep\s*\*\s*(${number})\s*\)\s*\+\s*sampleLight\(\s*vUv\s*-\s*uStep\s*\*\s*(${number})\s*\)\s*\)\s*\*\s*(${number})\s*;`, 'g');
  let remaining = main.replace(centerPattern, '');
  remaining = remaining.replace(pairPattern, (_, positive, negative, weight) => {
    taps.push({ offset: Number(positive), weight: Number(weight) });
    taps.push({ offset: -Number(negative), weight: Number(weight) });
    return '';
  });
  assert.equal(remaining.trim(), '', 'Unparsed bloom arithmetic; refusing an incomplete kernel check');
  assert.ok(taps.length > 1, 'Bloom must include surrounding samples');
  return taps;
}

function readSteps(text) {
  const draw = withoutComments(text).match(/function\s+draw\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*function\s+sceneVisible/)?.[1];
  assert.ok(draw, 'Cannot find the draw function');
  const uniforms = [...draw.matchAll(/gl\.uniform2f\(\s*stepUniform\s*,\s*([^,;]+)\s*,\s*([^);]+)\s*\)/g)];
  assert.equal(uniforms.length, 2, 'Expected one horizontal and one vertical bloom step');
  const scale = (expression, dimension) => {
    const value = expression.trim().match(new RegExp(String.raw`^(${number})\s*\/\s*bloomA\.${dimension}$`));
    assert.ok(value, `Unrecognized bloom step: ${expression.trim()}`);
    return Number(value[1]);
  };
  assert.equal(Number(uniforms[0][2].trim()), 0, 'Horizontal blur must not step vertically');
  assert.equal(Number(uniforms[1][1].trim()), 0, 'Vertical blur must not step horizontally');
  return [scale(uniforms[0][1], 'width'), scale(uniforms[1][2], 'height')];
}

// A fractional tap covers the two neighboring integer texels. Expand the
// sampling weights, including the real uniform scale, to expose missing texels.
// This describes the footprint, not a linear-light response: the shader still
// decodes logarithmic texture values after hardware interpolation.
function expand(taps, step) {
  const kernel = new Map();
  const add = (index, weight) => kernel.set(index, (kernel.get(index) ?? 0) + weight);
  for (const { offset, weight } of taps) {
    const position = offset * step;
    const lower = Math.floor(position);
    const fraction = position - lower;
    add(lower, weight * (1 - fraction));
    if (fraction > 0) add(lower + 1, weight * fraction);
  }
  return kernel;
}

function moments(kernel) {
  const sum = [...kernel.values()].reduce((total, weight) => total + weight, 0);
  const mean = [...kernel].reduce((total, [index, weight]) => total + index * weight, 0) / sum;
  const variance = [...kernel].reduce((total, [index, weight]) => total + (index - mean) ** 2 * weight, 0) / sum;
  return { sum, mean, variance };
}

const legacyTaps = [
  { offset: 0, weight: .227027 },
  { offset: 1.384615, weight: .316216 }, { offset: -1.384615, weight: .316216 },
  { offset: 3.230769, weight: .070270 }, { offset: -3.230769, weight: .070270 },
];
const legacyVariance = moments(expand(legacyTaps, 1.8)).variance;

function validate(kernel, label) {
  const { sum, mean, variance } = moments(kernel);
  assert.ok(Math.abs(sum - 1) < 1e-5, `${label}: weights must sum to 1 (got ${sum})`);
  assert.ok(Math.abs(mean) < 1e-8, `${label}: kernel must stay centered`);
  const radius = Math.max(...[...kernel.keys()].map(Math.abs));
  for (let i = -radius; i <= radius; i++) {
    const weight = kernel.get(i) ?? 0;
    assert.ok(weight > 1e-10, `${label}: sampling gap at texel ${i}`);
    assert.ok(Math.abs(weight - (kernel.get(-i) ?? 0)) < 1e-8, `${label}: asymmetric texel ${i}`);
    if (i > 0) assert.ok(weight <= kernel.get(i - 1) + 1e-8, `${label}: weight increases away from center at texel ${i}`);
  }
  // Match the previous halo's spread without retaining its sparse sampling.
  assert.ok(Math.abs(variance / legacyVariance - 1) < .1,
    `${label}: halo variance ${variance.toFixed(6)} differs too far from ${legacyVariance.toFixed(6)}`);
  return { radius, sum, variance };
}

const taps = readTaps(source);
const steps = readSteps(source);
assert.equal(steps[0], steps[1], 'Horizontal and vertical bloom must use the same scale');
for (const [index, axis] of ['horizontal', 'vertical'].entries()) {
  const result = validate(expand(taps, steps[index]), axis);
  console.log(`PASS ${axis}: ${taps.length} samples, step ${steps[index]}, ${result.radius * 2 + 1} contiguous texels, sum ${result.sum.toFixed(9)}, variance ${result.variance.toFixed(6)}`);
}

// Negative controls prove that the original regression and a uniform-only
// reintroduction cannot pass because the parser silently ignored the scale.
assert.throws(() => validate(expand(legacyTaps, 1.8), 'legacy'), /sampling gap|weight increases/);
const wrongStepSource = source.replace(/gl\.uniform2f\(\s*stepUniform\s*,\s*[^;]+;/g,
  statement => statement.replace(new RegExp(String.raw`${number}\s*\/\s*bloomA\.(width|height)`, 'g'), '1.8/bloomA.$1'));
const wrongSteps = readSteps(wrongStepSource);
assert.deepEqual(wrongSteps, [1.8, 1.8], 'Negative control did not mutate both uniforms');
for (const step of wrongSteps) assert.throws(() => validate(expand(taps, step), 'wrong step'), /sampling gap|weight increases|halo variance/);
console.log('PASS negative controls: legacy sparse kernel and restored 1.8 uniform scale are rejected');
console.log('CPU sampling-footprint checks only; visual quality and GPU cost require browser capture measurements.');
