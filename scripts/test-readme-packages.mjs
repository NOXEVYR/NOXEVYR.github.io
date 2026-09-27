import assert from 'node:assert/strict';
import {findReadmePackage, applyReadmePackage} from './readme-packages.mjs';
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
const compare = (a,b) => a.localeCompare(b, undefined, {numeric:true});
const released = {id:'frameweave', version:'0.11.1', status:'已发布', date:'2026-09-27',
  downloads:[{label:'Windows 0.11.1',url:'https://github.com/NOXEVYR/frameweave/releases/tag/v0.11.1',channel:'stable'}]};
const original = structuredClone(released);
assert.equal(applyReadmePackage(released,{version:'0.11.1',url:link('frameweave','PrismCanvas','0.11.1')},compare),false);
assert.deepEqual(released,original);
assert.equal(applyReadmePackage(released,{version:'0.12.0',url:link('frameweave','PrismCanvas','0.12.0')},compare),true);
assert.equal(released.version,'0.12.0');
assert.equal(released.downloads[0].url,link('frameweave','PrismCanvas','0.12.0'));
const candidate={id:'ai-hub',version:'2.13.2',status:'候选版',downloads:[]};
assert.equal(applyReadmePackage(candidate,{version:'2.13.2',url:link('ai-hub','AI-Hub','2.13.2')},compare),true);
assert.equal(candidate.status,'已发布');
console.log('PASS equal Release precedence, newer README and candidate promotion');
