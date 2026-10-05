import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Engine} from '../src/engine.mjs';
import {defaults,init,packageRoot} from '../src/init.mjs';
import {discoverRepositories} from '../src/projects.mjs';
const plan=(e,r,id,extra={})=>e.plan(r.id,{id,role:'builder',goal:'Scoped change',acceptance:['Correct project and module'],dependencies:[],writeFiles:[],checks:[],...extra});
function fixture(t) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ccm-projects-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'package.json'),'{"name":"ccm"}');fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/private.mjs'),'harness implementation');
 for(const name of ['frontend','backend']){const repo=path.join(root,'workspace',name);fs.mkdirSync(path.join(repo,'apps/orders'),{recursive:true});fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name,scripts:{test:'node check.mjs'}}));fs.writeFileSync(path.join(repo,'AGENTS.md'),`${name}: business code belongs in apps/orders.`);fs.writeFileSync(path.join(repo,'apps/orders/AGENTS.md'),'Orders must whitelist payload fields.');fs.writeFileSync(path.join(repo,'apps/orders/index.js'),'export const event = "old";\n');fs.writeFileSync(path.join(repo,'check.mjs'),'console.log(process.cwd());');}
 for(const name of ['frontend','backend'])assert.equal(spawnSync('git',['init','-q'],{cwd:path.join(root,'workspace',name)}).status,0);
 const c=defaults(root,'company/free');
 c.checks=['frontend','backend'].map(id=>({id:id+'-test',cwd:'workspace/'+id,argv:[process.execPath,'check.mjs']}));
 c.projects.forEach(p=>{p.checkIds=[p.id+'-test'];p.requiredBuilderChecks=[p.id+'-test']});
 c.projects.push({id:'orders',roots:['workspace/frontend','workspace/backend'],checkIds:['frontend-test','backend-test'],requiredBuilderChecks:['frontend-test','backend-test']});
 init(root,c);const e=new Engine(root);return {root,e,c,front:path.join(root,'workspace/frontend'),back:path.join(root,'workspace/backend')};
}
test('discovery is shallow, relative and does not grant access or run repository scripts',t=>{
 const {root,e}=fixture(t);fs.mkdirSync(path.join(root,'workspace/unregistered/deep'),{recursive:true});fs.writeFileSync(path.join(root,'workspace/unregistered/package.json'),'{"scripts":{"test":"touch BAD"}}');
 const before=e.read(),found=discoverRepositories(root);assert.equal(found.automaticRegistration,false);assert.ok(found.repositories.some(p=>p.root==='workspace/unregistered'));
 assert.equal(fs.existsSync(path.join(root,'workspace/unregistered/BAD')),false);assert.deepEqual(e.read(),before);assert.throws(()=>e.safePath(path.join(root,'workspace/unregistered/package.json')),/outside/);
});
test('multiple projects require clarification and selection is persistent per main session',t=>{
 const {e,root}=fixture(t);assert.throws(()=>e.start('a','ambiguous goal'),/Select a project/);
 e.selectProject('a','frontend');e.selectProject('b','backend');assert.equal(new Engine(root).start('a','first').project,'frontend');assert.equal(new Engine(root).start('b','second').project,'backend');
});
test('active project blocks other repository reads, searches, writes and checks',t=>{
 const {e,front,back}=fixture(t),r=e.start('a','frontend change','frontend');
 assert.throws(()=>e.evidence(r.id,{file:path.join(back,'package.json')}),/active project/);
 assert.throws(()=>e.search({root:back,mode:'files'},r.id),/active project/);
 assert.throws(()=>plan(e,r,'wrong-file',{writeFiles:[path.join(back,'apps/orders/index.js')],checks:['frontend-test']}),/active project/);
 assert.throws(()=>plan(e,r,'wrong-check',{writeFiles:[path.join(front,'apps/orders/index.js')],checks:['frontend-test','backend-test']}),/another project/);
 assert.throws(()=>plan(e,r,'missing-check',{writeFiles:[path.join(front,'apps/orders/index.js')],checks:[]}),/mandatory/);
});
test('cross-repository groups are explicit; CCM implementation cannot be business scope',t=>{
 const {e,front,back,root}=fixture(t),r=e.start('a','order topology','orders');
 assert.equal(e.evidence(r.id,{file:path.join(front,'AGENTS.md')}).kind,'file');assert.equal(e.evidence(r.id,{file:path.join(back,'AGENTS.md')}).kind,'file');
 assert.throws(()=>e.evidence(r.id,{file:path.join(root,'src/private.mjs')}),/outside/);
 const bad=JSON.parse(fs.readFileSync(path.join(root,'.ccm/config.json')));bad.roots=[root];bad.projects=[{id:'harness',roots:[root]}];assert.throws(()=>new Engine(root,{config:bad}),/CCM itself/);
});
test('removing the layout flag cannot restore legacy access to CCM source files',t=>{
 const {root}=fixture(t),bad=JSON.parse(fs.readFileSync(path.join(root,'.ccm/config.json')));delete bad.layout;delete bad.projects;bad.roots=[root];assert.throws(()=>new Engine(root,{config:bad}),/CCM root requires/);
});
test('project switch and registration cannot alter an active run; resume retains frozen scope',t=>{
 const {e,root,front}=fixture(t),r=e.start('a','frontend','frontend');
 assert.throws(()=>e.selectProject('a','backend'),/active run/);assert.throws(()=>e.start('a','new goal','backend'),/another project/);
 assert.throws(()=>e.registerProject({id:'another',roots:['workspace/backend']}),/active runs/);
 assert.deepEqual(new Engine(root).status(r.id).scope.roots,[front]);e.cancel(r.id);assert.equal(e.selectProject('a','backend').project,'backend');
});
test('restarting after an external check definition edit cannot silently replace active acceptance',t=>{
 const {e,root,front}=fixture(t),r=e.start('a','change','frontend');plan(e,r,'build',{writeFiles:[path.join(front,'apps/orders/index.js')],checks:['frontend-test']});
 const file=path.join(root,'.ccm/config.json'),raw=JSON.parse(fs.readFileSync(file));raw.checks.find(c=>c.id==='frontend-test').argv=[process.execPath,'-e','process.exit(0)'];fs.writeFileSync(file,JSON.stringify(raw));assert.throws(()=>new Engine(root).prepare(r.id,'build'),/check changed/);
});
test('workers receive bounded root and module rules; rule changes block stale dispatch and writes',t=>{
 const {e,front}=fixture(t),r=e.start('a','change','frontend'),file=path.join(front,'apps/orders/index.js');
 plan(e,r,'build',{writeFiles:[file],checks:['frontend-test']});const p=e.prepare(r.id,'build');const packet=JSON.parse(p.args.prompt);
 assert.equal(packet.context.project,'frontend');assert.equal(packet.context.repositories[0].rules.length,2);assert.match(packet.context.repositories[0].rules[1].excerpt,/whitelist/);
 fs.appendFileSync(path.join(front,'apps/orders/AGENTS.md'),' More constraints.');assert.throws(()=>e.dispatch('a',p.args),/rules changed/);
 e.retry(r.id,'build');const q=e.prepare(r.id,'build');e.dispatch('a',q.args);e.bind(q.attempt,'child');fs.appendFileSync(path.join(front,'AGENTS.md'),' New root constraint.');assert.throws(()=>e.write('child',file,'overwrite'),/rules changed/);assert.match(fs.readFileSync(file,'utf8'),/old/);
});
test('registered checks execute in business cwd and acceptance survives process restart',t=>{
 const {e,root,front}=fixture(t),r=e.start('a','change','frontend'),file=path.join(front,'apps/orders/index.js');plan(e,r,'build',{writeFiles:[file],checks:['frontend-test']});
 const p=e.prepare(r.id,'build');e.dispatch('a',p.args);e.bind(p.attempt,'builder');e.write('builder',file,'export const event = "new";\n');assert.match(e.check('builder','frontend-test').stdout,new RegExp(front));e.finish(p.attempt,'candidate');
 const restored=new Engine(root),ev=restored.evidence(r.id,{file});plan(restored,r,'review',{role:'verifier',writeFiles:[],checks:[],target:'build'});const v=restored.prepare(r.id,'review',[ev.id]);restored.dispatch('a',v.args);restored.bind(v.attempt,'verifier');assert.equal(restored.check('verifier','frontend-test').cwd,front);
 restored.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id]}));restored.accept(r.id,'review');restored.accept(r.id,'build','review');restored.complete(r.id);assert.equal(restored.status(r.id).status,'accepted');
});
test('approved registration adds new checks and protection without changing models, prices or budget',t=>{
 const {e,root}=fixture(t),models=structuredClone(e.config.models),budget=structuredClone(e.config.budget);
 const added=e.registerProject({id:'billing',roots:['workspace/backend'],checks:[{id:'billing-test',cwd:'workspace/backend',argv:[process.execPath,'check.mjs']}],requiredBuilderChecks:['billing-test'],protectedWriteRoots:['workspace/backend/shared']});
 assert.equal(added.restartRequired,false);assert.deepEqual(e.config.models,models);assert.deepEqual(e.config.budget,budget);assert.ok(e.config.protectedWriteRoots.includes(path.join(root,'workspace/backend/shared')));
 assert.ok(added.inheritedMandatoryChecks.includes('backend-test'));assert.ok(added.requiredBuilderChecks.includes('backend-test'));
 assert.throws(()=>e.registerProject({id:'replacement',roots:['workspace/backend'],checks:[{id:'billing-test',cwd:'workspace/backend',argv:['wrong']}]}),/existing checks/);assert.equal(new Engine(root).start('billing-session','new task','billing').project,'billing');
});
test('relative project configuration is portable for new tasks; no absolute roots persisted by init',t=>{
 const {root}=fixture(t),raw=JSON.parse(fs.readFileSync(path.join(root,'.ccm/config.json')));assert.equal(raw.projects[0].roots[0],'workspace/backend');
 const moved=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ccm-moved-')));t.after(()=>fs.rmSync(moved,{recursive:true,force:true}));fs.cpSync(root,moved,{recursive:true});
 const e=new Engine(moved),r=e.start('new','fresh task','frontend');assert.deepEqual(r.scope.roots,[path.join(moved,'workspace/frontend')]);assert.equal(e.config.checks.find(c=>c.id==='frontend-test').cwd,path.join(moved,'workspace/frontend'));
});
test('Git views target the independent business repository and refuse accidental parent CCM context',t=>{
 const {root,e,front,back}=fixture(t),git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout};
 git(root,['init','-q']);git(front,['add','.']);git(front,['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
 const r=e.start('a','inspect git','orders');fs.appendFileSync(path.join(front,'apps/orders/index.js'),'// business change\n');
 assert.match(e.repository(r.id,{root:front,mode:'status'}).text,/apps\/orders\/index.js/);assert.match(e.repository(r.id,{root:front,mode:'diff'}).text,/business change/);
 fs.rmSync(path.join(back,'.git'),{recursive:true});assert.throws(()=>e.repository(r.id,{root:back,mode:'status'}),/independent Git/);assert.throws(()=>e.repository(r.id,{root,mode:'status'}),/active project/);
});
test('fresh CCM configuration excludes business repos from watchers and disables CCM snapshots',t=>{
 const {root}=fixture(t),text=fs.readFileSync(path.join(root,'opencode.jsonc'),'utf8');assert.match(text,/workspace\/\*\*/);assert.match(text,/"snapshots": false/);
 const ignored=spawnSync('git',['check-ignore','--no-index','workspace/customer-repo/package.json'],{cwd:packageRoot,encoding:'utf8'});assert.equal(ignored.status,0);assert.match(ignored.stdout,/customer-repo/);
});
test('empty CCM and symlinked workspace cannot silently become a business project',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ccm-empty-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'package.json'),'{"name":"ccm"}');
 const c=defaults(root,'company/free');assert.deepEqual(c.projects,[]);assert.throws(()=>init(root,c),/roots|project/);assert.equal(fs.existsSync(path.join(root,'.ccm')),false);
 fs.symlinkSync(os.tmpdir(),path.join(root,'workspace'));assert.throws(()=>defaults(root),/symlink/);
});
test('intake refuses parent Git roots and reports dirty paths without modifying files or registration',t=>{
 const {root,e,front}=fixture(t);assert.equal(spawnSync('git',['init','-q'],{cwd:root}).status,0);
 const loose=path.join(root,'workspace/loose');fs.mkdirSync(loose);fs.writeFileSync(path.join(loose,'README.md'),'Preserve me');
 const before=fs.readFileSync(path.join(e.dir,'config.json'),'utf8'),found=e.discover();
 assert.equal(found.repositories.find(r=>r.id==='loose').independentGit,false);
 assert.equal(found.repositories.find(r=>r.id==='frontend').dirty,true);
 assert.ok(found.repositories.find(r=>r.id==='frontend').changes.some(c=>c.file==='package.json'));
 assert.throws(()=>e.registerProject({id:'loose',roots:['workspace/loose']}),/independent Git/);
 assert.equal(fs.readFileSync(path.join(e.dir,'config.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(loose,'README.md'),'utf8'),'Preserve me');
 assert.ok(defaults(root).projects.every(p=>p.id!=='loose'));assert.ok(fs.existsSync(path.join(front,'apps/orders/index.js')));
});
test('sensitive filenames are blocked across source, context, search overrides and tracked Git diff',t=>{
 const {e,front}=fixture(t),r=e.start('a','sensitive policy','frontend');
 const secret='FIXTURE_SECRET_MUST_NOT_ESCAPE',names=['.env','.env.local','.ENV.production','.npmrc','.netrc','auth.json','credentials.json','id_ed25519','private.pem','.aws/credentials'];
 for(const name of names){const file=path.join(front,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,secret);assert.throws(()=>e.evidence(r.id,{file}),/Sensitive/);assert.throws(()=>e.context('a',{files:[file]}),/Sensitive/)}
 fs.writeFileSync(path.join(front,'environment.js'),'const ordinary = "SAFE_HIT";');
 for(const mode of ['files','text']){
  const result=e.search({root:front,mode,pattern:secret,glob:'**/*'},r.id);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(result.results.every(line=>!names.some(name=>line.includes(name))));
 }
 assert.ok(e.search({root:front,mode:'text',pattern:'SAFE_HIT'},r.id).results.some(line=>line.includes('SAFE_HIT')));
 assert.throws(()=>e.search({root:path.join(front,'.aws'),mode:'files'},r.id),/Sensitive/);
 const git=args=>{const out=spawnSync('git',args,{cwd:front,encoding:'utf8'});assert.equal(out.status,0,out.stderr)};
 git(['add','.']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
 for(const name of names)fs.appendFileSync(path.join(front,name),'\n'+secret+'-CHANGED');fs.appendFileSync(path.join(front,'environment.js'),'\n// safe business change');
 const diff=e.repository(r.id,{root:front,mode:'diff'});assert.match(diff.text,/safe business change/);assert.ok(!diff.text.includes(secret));assert.equal(diff.sensitivePathsExcluded,true);
});
