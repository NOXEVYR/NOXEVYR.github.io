import assert from 'node:assert/strict';
import {findReadmePackage} from './readme-packages.mjs';
const link = (repo, name, version, owner = 'NOXEVYR') => `https://raw.githubusercontent.com/${owner}/${repo}/main/releases/${name}-v${version}-Windows-x64.zip`;
const current = link('frameweave', 'PrismCanvas', '0.5.0');
assert.deepEqual(findReadmePackage('frameweave', `[下载](${current})`), {url: current, version: '0.5.0'});
assert.equal(findReadmePackage('frameweave', `${link('frameweave', 'FrameWeave', '0.3.0', 'turnsolesama')}\n${current}`).url, current);
assert.equal(findReadmePackage('frameweave', `${current}\n${link('frameweave', 'PrismCanvas', '0.10.0')}`).version, '0.10.0');
assert.equal(findReadmePackage('frameweave', link('frameweave', 'FrameWeave', '0.3.0', 'turnsolesama')).version, '0.3.0');
assert.equal(findReadmePackage('ai-hub', link('ai-hub', 'AI-Hub', '2.6.0')).version, '2.6.0');
assert.equal(findReadmePackage('ai-hub', link('ai-hub', 'AI-Hub', '2.6.0', 'turnsolesama')).url, link('ai-hub', 'AI-Hub', '2.6.0'));
assert.equal(findReadmePackage('frameweave', link('frameweave', 'FrameWeave', '0.3.0', 'turnsolesama')).url, link('frameweave', 'FrameWeave', '0.3.0'));
for (const bad of [current.replace('/NOXEVYR/', '/unknown/'), current.replace('/frameweave/', '/another/'), current + '.txt', current.replace('0.5.0', '0.6.0-preview'), current.replace('Windows-x64', 'Source')]) {
  assert.equal(findReadmePackage('frameweave', bad), null, bad);
}
assert.equal(findReadmePackage('unknown', current), null);
console.log('PASS README package rename, history, version order and source boundaries (13 cases)');
