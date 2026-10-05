import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageRoot,defaults,init} from '../src/init.mjs';
import {Engine} from '../src/engine.mjs';
import {describeWorkspace} from '../src/workspace.mjs';
function temporary(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'th-onboard-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
test('fresh downloaded workspace discovers bootstrap with no node_modules and no external imports',t=>{
 const root=temporary(t);
 for(const file of ['bin/onboard.mjs','src/defaults.mjs','src/environment.mjs','src/runtime.mjs','src/opencode-models.mjs','src/projects.mjs','src/sensitive-paths.mjs','package.json','.opencode/opencode.jsonc','.opencode/agents/jarvis.md','.opencode/commands/onboard.md']){
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(packageRoot,file),path.join(root,file));
 }
 const r=spawnSync(process.execPath,['bin/onboard.mjs','probe'],{cwd:root,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);
 assert.equal(p.ready,false);assert.equal(p.initialized,false);assert.ok(Object.values(p.dependencies).every(d=>d.actual===null));
 assert.equal(fs.existsSync(path.join(root,'node_modules')),false);assert.equal(fs.existsSync(path.join(root,'.opencode/plugins')),false);
 const example=spawnSync(process.execPath,['bin/onboard.mjs','example'],{cwd:root,encoding:'utf8'});
 assert.equal(example.status,0);assert.deepEqual(JSON.parse(example.stdout).roots,[]);assert.equal(JSON.parse(example.stdout).layout,'ccm-workspace');
 const apply=spawnSync(process.execPath,['bin/onboard.mjs','apply'],{cwd:root,encoding:'utf8'});
 assert.notEqual(apply.status,0);assert.match(apply.stderr,/依赖未就绪/);assert.equal(fs.existsSync(path.join(root,'opencode.jsonc')),false);
});
test('workspace guide discovers rules and check candidates without executing scripts or starting runs',t=>{
 const root=temporary(t),c=defaults(root,'internal/free');
 init(root,c);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'web',scripts:{test:'touch SHOULD_NOT_EXIST'}}));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'Business events stay in apps/orders.');
 const e=new Engine(root),before=e.read(),info=describeWorkspace(e);
 assert.equal(info.context.repositories[0].name,'web');assert.equal(info.context.repositories[0].scripts.test,'touch SHOULD_NOT_EXIST');
 assert.match(info.context.repositories[0].rules[0].excerpt,/apps\/orders/);assert.deepEqual(info.checks,[]);
 assert.equal(fs.existsSync(path.join(root,'SHOULD_NOT_EXIST')),false);assert.deepEqual(e.read(),before);
});
test('workspace guide refuses symlinked project rules without reading the target',t=>{
 const root=temporary(t),c=defaults(root,'internal/free');init(root,c);
 fs.symlinkSync('/etc/hosts',path.join(root,'AGENTS.md'));
 const info=describeWorkspace(new Engine(root));assert.deepEqual(info.context.repositories[0].rules,[]);assert.match(info.context.repositories[0].notes[0],/Symlink/);
});
