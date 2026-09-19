// Keep icon refresh in the existing sync entry point used by Pages.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
const windows=process.platform==='win32';
let python=windows?'python':'python3';
const run=(program,args)=>execFileSync(program,args,{cwd:root,stdio:'inherit'});
if(process.env.GITHUB_ACTIONS==='true'){
 // Install the pinned decoder in an isolated runner environment, never system Python.
 const environment=join(process.env.RUNNER_TEMP||tmpdir(),'portfolio-icon-python');
 run(python,['-m','venv',environment]);
 python=join(environment,windows?'Scripts/python.exe':'bin/python');
 run(python,['-m','pip','install','--disable-pip-version-check','-r','scripts/requirements-icons.txt']);
}
run(python,['-m','unittest','discover','-s','scripts','-p','test_*.py']);
run(python,['scripts/sync-icons.py']);
