import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine,hash} from '../src/engine.mjs';
function setup(t,options={}) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'th-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={version:1,models:{free:{id:'internal/free',free:true},expert:{id:'internal/expert',free:false,price:{input:10,output:50,cacheRead:1,cacheWrite:10}}},roots:[root],mcpIds:['knowledge'],budget:{monthUsd:1000,runUsd:10},limits:{maxNodes:20,maxAttempts:2,freeConcurrency:2,paidConcurrency:1,maxPaidNodes:2,runMinutes:120,maxPacketChars:24000,systemReserveTokens:12000,expertOutputTokens:4000},checks:[{id:'check',cwd:root,argv:[process.execPath,'-e','console.log("verified")']}],...options};
 if(typeof options==='function')options(config,root);
 fs.mkdirSync(path.join(root,'.team-harness'));fs.writeFileSync(path.join(root,'.team-harness','config.json'),JSON.stringify(config));
 fs.writeFileSync(path.join(root,'spec.md'),'Order logic belongs in apps/orders.\nCommon telemetry must remain business neutral.\n');
 const e=new Engine(root),r=e.start('root-session','fixture'),ev=e.evidence(r.id,{file:path.join(root,'spec.md'),start:1,end:2});return {root,e,r,ev};
}
const plan=(e,r,id,role='planner',extra={})=>e.plan(r.id,{id,role,goal:'Inspect modules',acceptance:['module ownership respected'],dependencies:[],writeFiles:[],checks:[],...extra});
const dispatch=(e,r,id,ev=[],reason='')=>{const p=e.prepare(r.id,id,ev,reason);e.dispatch('root-session',p.args);e.bind(p.attempt,'child-'+p.attempt);return p};
test('scope blocks common-module insertion and preserves external user edits',t=>{
 const {e,r,root}=setup(t),file=path.join(root,'apps/orders.js'),shared=path.join(root,'common/telemetry.js');
 plan(e,r,'build','builder',{writeFiles:[file],checks:['check']});const p=dispatch(e,r,'build');
 assert.throws(()=>e.write('child-'+p.attempt,shared,'business()'),/scope/);assert.equal(fs.existsSync(shared),false);
 e.write('child-'+p.attempt,file,'correct()');fs.writeFileSync(file,'user_edit()');
 assert.throws(()=>e.write('child-'+p.attempt,file,'overwrite()'),/externally/);assert.equal(fs.readFileSync(file,'utf8'),'user_edit()');
});
test('independent acceptance refuses false verdict, then accepts check-bound correct implementation',t=>{
 const {e,r,root}=setup(t),file=path.join(root,'app.js');
 plan(e,r,'build','builder',{writeFiles:[file],checks:['check']});const b=dispatch(e,r,'build');e.write('child-'+b.attempt,file,'correct');e.check('child-'+b.attempt,'check');e.finish(b.attempt,'implemented');
 assert.throws(()=>e.accept(r.id,'build','build'),/Independent/);
 const ev=e.evidence(r.id,{file,start:1,end:1});plan(e,r,'verify','verifier',{target:'build'});const v=dispatch(e,r,'verify',[ev.id]);
 e.check('child-'+v.attempt,'check');e.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id],findings:[]}));e.accept(r.id,'verify');e.accept(r.id,'build','verify');e.complete(r.id);assert.equal(e.status(r.id).status,'accepted');
});
test('paid escalation requires evidence, known prices and reserve; cannot be used for search',t=>{
 const {e,r,ev}=setup(t);plan(e,r,'expert','expert');
 assert.throws(()=>e.prepare(r.id,'expert',[],'boundary: ambiguous owner'),/evidence/);
 assert.throws(()=>e.prepare(r.id,'expert',[ev.id],'please do broad research'),/Unsupported/);
 const p=e.prepare(r.id,'expert',[ev.id],'boundary: order event ownership ambiguous');assert.ok(p.attempt);assert.ok(e.status(r.id).tasks.expert.attempts[0].reserve>0);
});
test('budget reservation protects concurrent paid dispatches',t=>{
 const {e,r,ev}=setup(t,{budget:{monthUsd:0.7,runUsd:0.7}});plan(e,r,'a','expert');plan(e,r,'b','expert');
 e.prepare(r.id,'a',[ev.id],'boundary: concrete ambiguity');assert.throws(()=>e.prepare(r.id,'b',[ev.id],'boundary: concrete ambiguity'),/budget/);
});
test('interrupted paid attempts cannot retry until reconciled; attempts are distinct',t=>{
 const {e,r,ev}=setup(t);plan(e,r,'a','expert');const p=dispatch(e,r,'a',[ev.id],'boundary: concrete ambiguity');e.markInterrupted('child-'+p.attempt);
 assert.throws(()=>e.retry(r.id,'a'),/reconciled/);e.reconcile(r.id,'a',0.2,'gateway request receipt');e.retry(r.id,'a');const q=dispatch(e,r,'a',[ev.id],'boundary: concrete ambiguity');assert.notEqual(p.attempt,q.attempt);assert.equal(e.status(r.id).tasks.a.attempts.length,2);
});
test('free interrupted task resumes from disk without replaying finished work',t=>{
 const {e,r,root}=setup(t);plan(e,r,'a');const p=dispatch(e,r,'a');e.markInterrupted('child-'+p.attempt);const restored=new Engine(root);assert.equal(restored.status(r.id).tasks.a.status,'unknown');restored.retry(r.id,'a');const q=dispatch(restored,r,'a');assert.notEqual(p.attempt,q.attempt);restored.finish(q.attempt,'recovered');assert.throws(()=>restored.dispatch('root-session',q.args),/Duplicate/);
});
test('stale evidence, missing checks, and changed checked artifacts reject acceptance',t=>{
 const {e,r,root,ev}=setup(t);plan(e,r,'a');fs.appendFileSync(ev.file,'new requirement');assert.throws(()=>e.prepare(r.id,'a',[ev.id]),/Stale/);
 const file=path.join(root,'new.js');plan(e,r,'b','builder',{writeFiles:[file],checks:['check']});const b=dispatch(e,r,'b');e.write('child-'+b.attempt,file,'initial');e.finish(b.attempt,'candidate');const fresh=e.evidence(r.id,{file,start:1,end:1});plan(e,r,'v','verifier',{target:'b'});const v=dispatch(e,r,'v',[fresh.id]);e.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[fresh.id]}));e.accept(r.id,'v');assert.throws(()=>e.accept(r.id,'b','v'),/check failed\/missing/);
});
test('protected config, path traversal and symlinks are refused',t=>{
 const {e,root}=setup(t);assert.throws(()=>e.safePath(path.join(root,'.team-harness/state.json')),/protected/);assert.throws(()=>e.safePath(path.join(root,'../outside')),/outside/);fs.symlinkSync('/etc/hosts',path.join(root,'link'));assert.throws(()=>e.safePath(path.join(root,'link')),/Symlink/);
});
test('cancellation blocks already prepared calls and late writes',t=>{
 const {e,r,root}=setup(t);plan(e,r,'a');const p=e.prepare(r.id,'a');e.cancel(r.id);assert.throws(()=>e.dispatch('root-session',p.args),/cancelled|invalid/i);
});
test('usage is idempotent and counts cache and reasoning at configured prices',t=>{
 const {e,r,ev}=setup(t);plan(e,r,'a','expert');const p=dispatch(e,r,'a',[ev.id],'boundary: concrete ambiguity');const m={id:'m1',sessionID:'child-'+p.attempt,role:'assistant',modelID:'expert',time:{completed:Date.now()},tokens:{input:100,output:20,reasoning:5,cache:{read:50,write:10}},cost:99};e.usage(m);e.usage(m);assert.equal(Object.keys(e.read().usage).length,1);assert.ok(Math.abs(e.read().usage.m1.usd-0.0024)<1e-10);e.finish(p.attempt,'decision');assert.equal(e.status(r.id).tasks.a.attempts[0].settled,true);
});
test('main agent cannot grant protected module writes or omit mandatory checks',t=>{
 const {e,r,root}=setup(t,(c,root)=>{c.protectedWriteRoots=[path.join(root,'common')];c.requiredBuilderChecks=['check']});
 assert.throws(()=>plan(e,r,'bad-scope','builder',{writeFiles:[path.join(root,'common/event.js')],checks:['check']}),/protected module/);
 assert.throws(()=>plan(e,r,'bad-check','builder',{writeFiles:[path.join(root,'app.js')],checks:[]}),/mandatory/);
});
test('parallel writers are serialized and stale prepared args cannot be changed',t=>{
 const {e,r,root}=setup(t),file=path.join(root,'app.js');plan(e,r,'a','builder',{writeFiles:[file],checks:['check']});plan(e,r,'b','builder',{writeFiles:[file],checks:['check']});const a=e.prepare(r.id,'a'),b=e.prepare(r.id,'b');
 assert.throws(()=>e.dispatch('root-session',{...a.args,prompt:'changed'}),/immutable/);e.dispatch('root-session',a.args);assert.throws(()=>e.dispatch('root-session',b.args),/write conflict/);
});
test('unconfigured public MCP source and broad paid evidence packet are blocked',t=>{
 const {e,r,ev}=setup(t);assert.throws(()=>e.evidence(r.id,{uri:'mcp://public-search/1',content:'result'}),/allowed internal/);plan(e,r,'a','expert');e.config.limits.maxPacketChars=10;assert.throws(()=>e.prepare(r.id,'a',[ev.id],'boundary: concrete ambiguity'),/too large/);
});
test('review from an old attempt cannot approve a replacement candidate',t=>{
 const {e,r,ev}=setup(t);plan(e,r,'a');const a=dispatch(e,r,'a');e.finish(a.attempt,'candidate 1');plan(e,r,'v','verifier',{target:'a'});const v=dispatch(e,r,'v',[ev.id]);e.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id]}));e.accept(r.id,'v');e.retry(r.id,'a');const b=dispatch(e,r,'a');e.finish(b.attempt,'candidate 2');assert.throws(()=>e.accept(r.id,'a','v'),/older candidate/);
});
test('Playwright MCP accepts only registered step order/arguments and binds actual receipts',t=>{
 const mcp={id:'pw',type:'mcp',mcpId:'playwright',steps:[{tool:'browser_navigate',args:{url:'http://localhost:3000/'},expectedPattern:'page ready'},{tool:'browser_run_code',args:{code:'async page => ({harnessPass:"suite-v1"})'},expectedPattern:'"harnessPass":"suite-v1"'}]};
 const {e,r,root}=setup(t,c=>{c.browserOrigins=['http://localhost:3000'];c.checks.push(mcp)}),file=path.join(root,'apps/orders.js');
 plan(e,r,'b','builder',{writeFiles:[file],checks:['pw']});const b=dispatch(e,r,'b');e.write('child-'+b.attempt,file,'app');assert.throws(()=>e.check('child-'+b.attempt,'pw'),/independent/);e.finish(b.attempt,'implemented');const ev=e.evidence(r.id,{file,start:1,end:1});
 plan(e,r,'v','verifier',{target:'b'});const v=dispatch(e,r,'v',[ev.id]),session='child-'+v.attempt;const steps=e.check(session,'pw').steps;
 assert.throws(()=>e.mcpBefore(session,steps[1].tool,steps[1].args),/registered acceptance/);
 assert.throws(()=>e.mcpBefore(session,steps[0].tool,{url:'https://public.example/'}),/registered acceptance/);
 e.mcpBefore(session,steps[0].tool,steps[0].args);e.mcpAfter(session,steps[0].tool,steps[0].args,{output:'page ready'});e.mcpAfter(session,steps[1].tool,steps[1].args,{output:'{"harnessPass":"suite-v1"}'});
 e.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id]}));e.accept(r.id,'v');e.accept(r.id,'b','v');assert.equal(e.status(r.id).tasks.b.checksRun.pw.pass,true);
});
test('a failed MCP output cannot be replaced by a passing model verdict',t=>{
 const {e,r,root}=setup(t,c=>c.checks.push({id:'pw',type:'mcp',mcpId:'playwright',steps:[{tool:'browser_run_code',args:{code:'suite'},expectedPattern:'PASS'}]})),file=path.join(root,'app.js');
 plan(e,r,'b','builder',{writeFiles:[file],checks:['pw']});const b=dispatch(e,r,'b');e.write('child-'+b.attempt,file,'app');e.finish(b.attempt,'candidate');const ev=e.evidence(r.id,{file,start:1,end:1});plan(e,r,'v','verifier',{target:'b'});const v=dispatch(e,r,'v',[ev.id]),session='child-'+v.attempt;e.check(session,'pw');e.mcpAfter(session,'playwright_browser_run_code',{code:'suite'},{output:'FAIL'});e.finish(v.attempt,JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:[ev.id]}));e.accept(r.id,'v');assert.throws(()=>e.accept(r.id,'b','v'),/check failed\/missing/);
});
