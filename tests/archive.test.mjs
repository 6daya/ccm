import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Engine,hash} from '../src/engine.mjs';
import {defaults,init,packageRoot} from '../src/init.mjs';

function fixture(t) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ccm-archive-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=defaults(root,'internal/free');config.mcpIds=['knowledge'];init(root,config);
 const e=new Engine(root),run=e.start('primary','Analyze ownership');
 fs.writeFileSync(path.join(root,'source.md'),'Owner: orders');
 const ev=e.evidence(run.id,{file:path.join(root,'source.md')}),mcp=e.evidence(run.id,{uri:'mcp://knowledge/orders',content:'Source supplied by agent'});
 const plan=(id,role,extra={})=>e.plan(run.id,{id,role,goal:'Analyze',acceptance:['Source linked'],dependencies:[],writeFiles:[],checks:[],...extra});
 const finish=(id,text)=>{const p=e.prepare(run.id,id,[ev.id,mcp.id]);e.dispatch('primary',p.args);e.bind(p.attempt,'child-'+id);e.finish(p.attempt,text)};
 plan('map','scout');finish('map','Owner: orders. Missing deployment documentation remains unknown.');
 plan('review','verifier',{target:'map'});finish('review',JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id]}));e.accept(run.id,'review');e.accept(run.id,'map','review');
 return {root,e,run};
}
test('completion archives saved results once, preserves source trust/unknown billing and never replays attempts',t=>{
 const {root,e,run}=fixture(t),result=e.complete(run.id);assert.equal(result.status,'accepted');assert.equal(result.archive.status,'complete');
 const manifest=JSON.parse(fs.readFileSync(result.archive.manifest)),report=fs.readFileSync(result.archive.report,'utf8');
 assert.equal(manifest.report.sha256,hash(report));assert.equal(manifest.billing.gatewayTotalUsd,null);assert.match(report,/Missing deployment/);
 assert.match(manifest.sources.find(s=>s.kind==='mcp').provenance,/agent-supplied/);assert.ok(manifest.sources.every(s=>!('excerpt' in s)));
 assert.ok(!report.includes('REPLACE_FREE_MODEL'));assert.ok(manifest.receipts.every(r=>fs.existsSync(path.resolve(result.archive.directory,r.file))));
 const before=e.read(),mtime=fs.statSync(result.archive.report).mtimeMs;
 const restored=new Engine(root),retry=restored.complete(run.id);assert.equal(retry.archive.reused,true);assert.deepEqual(restored.read(),before);assert.equal(fs.statSync(retry.archive.report).mtimeMs,mtime);
});
test('archive failure keeps business accepted; retry exports only and preserves unrelated pending output',t=>{
 const {root,e,run}=fixture(t),base=path.join(e.dir,'archive');fs.writeFileSync(base,'blocked');
 const result=e.complete(run.id);assert.equal(result.status,'accepted');assert.equal(result.archive.status,'failed');assert.equal(e.status(run.id).status,'accepted');
 const attempts=JSON.stringify(e.status(run.id).tasks);fs.unlinkSync(base);fs.mkdirSync(path.join(base,'default'),{recursive:true});
 const leftover=path.join(base,'default','.pending-'+run.id+'-interrupted');fs.mkdirSync(leftover);fs.writeFileSync(path.join(leftover,'report.md'),'partial private report');
 assert.equal(new Engine(root).complete(run.id).archive.status,'complete');assert.equal(JSON.stringify(e.status(run.id).tasks),attempts);assert.equal(fs.readFileSync(path.join(leftover,'report.md'),'utf8'),'partial private report');
});
test('existing corrupt or incomplete archive is preserved; symlink destination cannot export elsewhere',t=>{
 const {e,run,root}=fixture(t),result=e.complete(run.id);fs.appendFileSync(result.archive.report,'external edit');
 assert.equal(e.complete(run.id).archive.status,'failed');assert.match(fs.readFileSync(result.archive.report,'utf8'),/external edit$/);
 fs.rmSync(path.join(e.dir,'archive'),{recursive:true});fs.mkdirSync(result.archive.directory,{recursive:true});assert.equal(e.complete(run.id).archive.status,'failed');assert.deepEqual(fs.readdirSync(result.archive.directory),[]);
 fs.rmSync(path.join(e.dir,'archive'),{recursive:true});const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(e.dir,'archive'));
 assert.equal(e.complete(run.id).archive.status,'failed');assert.deepEqual(fs.readdirSync(outside),[]);
});
test('process exit during export leaves acceptance intact; existing doctor recovery and retry do not replay work',t=>{
 const {e,root,run}=fixture(t),tasks=JSON.stringify(e.status(run.id).tasks);
 const script=`import fs from 'node:fs';import {Engine} from ${JSON.stringify(pathToFileURL(path.join(packageRoot,'src/engine.mjs')).href)};
 const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(from).includes('.pending-'))process.exit(77);return rename(from,to)};
 new Engine(${JSON.stringify(root)}).complete(${JSON.stringify(run.id)});`;
 const crash=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(crash.status,77,crash.stderr);
 assert.equal(e.status(run.id).status,'accepted');assert.equal(JSON.stringify(e.status(run.id).tasks),tasks);assert.ok(fs.existsSync(e.lock));
 const repair=spawnSync(process.execPath,[path.join(packageRoot,'bin/cli.mjs'),'doctor','--workspace',root,'--repair-lock'],{encoding:'utf8',timeout:30000});assert.equal(repair.status,0,repair.stderr);assert.match(repair.stdout,/Removed stale process lock/);
 assert.equal(e.complete(run.id).archive.status,'complete');assert.equal(JSON.stringify(e.status(run.id).tasks),tasks);
});
test('CLI exports active snapshot and terminal cancelled archive without turning them into accepted',t=>{
 const {root,e,run}=fixture(t),cli=(args)=>spawnSync(process.execPath,[path.join(packageRoot,'bin/cli.mjs'),'report','--workspace',root,'--run',run.id,...args],{encoding:'utf8'});
 assert.notEqual(cli(['--archive']).status,0);assert.match(cli([]).stdout,/未完成交付/);assert.equal(e.status(run.id).status,'active');
 e.cancel(run.id);const r=cli(['--archive']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(JSON.parse(r.stdout).manifest)).runStatus,'cancelled');assert.equal(e.status(run.id).status,'cancelled');
});
