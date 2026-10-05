import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import plugin from '../src/plugin.mjs';
import {Engine} from '../src/engine.mjs';
import {defaults,init} from '../src/init.mjs';
import {requireV2,normalizeVersion} from '../src/runtime.mjs';
async function harness(t,layout=false) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ccm-v2-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=defaults(root,'internal/free');config.models.expert={id:'internal/expert',free:false,price:{input:10,output:50,cacheRead:1,cacheWrite:10}};config.mcpIds=['knowledge'];
 if(layout){const repo=path.join(root,'workspace','initial');fs.mkdirSync(repo,{recursive:true});spawnSync('git',['init','-q'],{cwd:repo});config.layout='ccm-workspace';config.roots=['workspace/initial'];config.projects=[{id:'initial',roots:['workspace/initial'],checkIds:[],requiredBuilderChecks:[]}]}
 init(root,config);
 const hooks=new Map(),tools=new Map(),agents=new Map(),sessions=new Map(),messages=new Map(),servers=new Map([['knowledge',{type:'remote',url:'https://internal.invalid'}],['public',{type:'remote',url:'https://public.invalid'}]]);
 let answer=[],questions=0;
 tools.set('question',{name:'question',async execute(){questions++;return {output:{answers:[answer]}}}});
 const registration={async dispose(){}};
 const hook=domain=>async(name,fn)=>{hooks.set(domain+'.'+name,fn);return registration};
 const context={app:{version:'2.0.23'},location:{directory:root},
  tool:{hook:hook('tool'),async list(){return [...tools.values()]},async transform(fn){fn({add(tool){assert.equal(tool.input.type,'object');tools.set(tool.name,tool)}});return registration}},
  agent:{async transform(fn){fn({list(){return [...agents.values()]},remove(id){agents.delete(id)},update(id,fn){const agent=agents.get(id)||{id,request:{}};fn(agent);agents.set(id,agent)},default(){}});return registration}},
  model:{async transform(fn){fn({default:{set(){}}});return registration}},
  mcp:{async transform(fn){fn({list(){return [...servers]},update(id,fn){fn(servers.get(id))}});return registration}},
  websearch:{async transform(fn){fn({default:{set(value){assert.equal(value,false)}}});return registration}},
  command:{async transform(fn){fn({add(){}});return registration}},
  permission:{hook:hook('permission')},
  session:{hook:hook('session'),async get({sessionID}){return sessions.get(sessionID)||{id:sessionID,location:{directory:root}}},async context({sessionID}){return messages.get(sessionID)||[]},async interrupt({sessionID,continue:keep}){assert.equal(keep,false);messages.set(sessionID,[{type:'idle',outcome:'interrupted'}])}},
  event:{subscribe({signal}){return {[Symbol.asyncIterator]:async function*(){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))}}}},
 };
 const cleanup=await plugin.setup(context);t.after(cleanup);
 const e=new Engine(root),callContext={sessionID:'primary',agent:'jarvis',id:'call-test',messageID:'m-test'};
 const call=async(name,input={},ctx=callContext)=>{await hooks.get('tool.execute.before')({tool:name,input,...ctx});return JSON.parse((await tools.get(name).execute(input,ctx)).content)};
 const dispatch=(role='scout')=>{const r=e.start('primary','test');e.plan(r.id,{id:'a',role,goal:'decision',acceptance:['source'],dependencies:[],writeFiles:[],checks:[]});const ev=e.evidence(r.id,{file:path.join(root,'source.txt')});const p=e.prepare(r.id,'a',[ev.id],role==='expert'?'boundary: source-backed ambiguity':'');e.dispatch('primary',p.args);sessions.set('child',{id:'child',title:p.args.description,parentID:'primary',location:{directory:root}});return {r,p}};
 fs.writeFileSync(path.join(root,'source.txt'),'source facts');
 return {root,e,hooks,tools,agents,servers,sessions,messages,call,callContext,dispatch,setAnswer(v){answer=v},questions:()=>questions};
}
test('runtime rejects V1 before plugin setup and normalizes the actual V2 CLI version',()=>{
 assert.equal(normalizeVersion('opencode v2.0.23'),'2.0.23');assert.equal(requireV2('2.0.23'),'2.0.23');assert.throws(()=>requireV2('1.18.34'),/requires OpenCode V2/);
});
test('V2 model and tool guards retain role boundaries and disable paid auxiliary calls and retries',async t=>{
 const h=await harness(t);const compaction={sessionID:'primary',agent:'jarvis',model:{providerID:'internal',id:'free'},system:[]};await h.hooks.get('session.compaction')(compaction);assert.equal(compaction.system[0].type,'text');assert.match(compaction.system[0].text,/Persisted CCM state/);const {p}=h.dispatch('expert');
 const event={sessionID:'child',agent:'th-expert',model:{providerID:'internal',id:'expert'},tools:{shell:{},execute:{},harness_read:{}},options:{}};
 await h.hooks.get('session.context')(event);assert.deepEqual(event.tools,{});assert.equal(event.options.maxTokens,h.e.config.limits.expertOutputTokens);
 await assert.rejects(h.hooks.get('session.model.request')({...event,model:{providerID:'internal',id:'free'},kind:'primary'}),/routing denied/);
 await assert.rejects(h.hooks.get('session.model.request')({...event,kind:'compaction'}),/auxiliary/);
 await assert.rejects(h.hooks.get('session.generate')(event),/transient/);
 await assert.rejects(h.hooks.get('tool.execute.before')({tool:'subagent',input:p.args,...event}),/Tool denied/);
 const retry={decision:{retry:true,delay:1}};await h.hooks.get('session.retry')(retry);assert.deepEqual(retry.decision,{retry:false});
 await h.hooks.get('session.http.request')({...event,kind:'primary'});await assert.rejects(h.hooks.get('session.http.request')({...event,kind:'primary'}),/transport replay/);
 const restored=new Engine(h.root);assert.ok(restored.locate(restored.read(),'child').a.requestIssued);
 await assert.rejects(h.hooks.get('session.experimental.ws.handshake')({...event,kind:'primary'}),/WebSocket/);
});
test('native V2 subagent args refuse continuation, model overrides, altered prompts and background execution',async t=>{
 const h=await harness(t),r=h.e.start('primary','test');h.e.plan(r.id,{id:'a',role:'scout',goal:'source',acceptance:['source'],dependencies:[],writeFiles:[],checks:[]});const p=h.e.prepare(r.id,'a');
 assert.equal(p.args.agent,'th-scout');assert.equal(p.args.subagent_type,undefined);
 for(const change of [{model:'internal/expert'},{sessionID:'old'},{prompt:'tampered'},{background:true}])assert.throws(()=>h.e.dispatch('primary',{...p.args,...change}),/immutable contract/);
 h.e.dispatch('primary',p.args);assert.throws(()=>h.e.dispatch('primary',p.args),/Duplicate/);
});
test('V2 completed/error subagent output is captured and usage is idempotent',async t=>{
 const h=await harness(t),{p,r}=h.dispatch('scout');
 h.messages.set('child',[{id:'usage',type:'assistant',model:{providerID:'internal',id:'free'},time:{completed:1},tokens:{input:100,output:20},content:[{type:'text',text:'source-linked result'}],finish:'stop'},{type:'idle',outcome:'succeeded'}]);
 await h.hooks.get('tool.execute.after')({tool:'subagent',sessionID:'primary',input:p.args,status:'completed',result:{output:{sessionID:'child',status:'completed',output:'source-linked result'},content:'<subagent>wrapped</subagent>'}});
 assert.equal(h.e.status(r.id).tasks.a.result,'source-linked result');assert.equal(h.e.status(r.id).tasks.a.status,'verifying');assert.equal(Object.keys(h.e.read().usage).length,1);
});
test('resume preserves live/ambiguous V2 jobs and only recovers a terminal idle marker',async t=>{
 const h=await harness(t),{p,r}=h.dispatch();await h.hooks.get('session.context')({sessionID:'child',agent:'th-scout',model:{providerID:'internal',id:'free'},tools:{},options:{}});
 let result=await h.call('harness_resume',{run:r.id});assert.equal(result.tasks.a.status,'running');assert.equal(result.unresolved.length,1);assert.throws(()=>h.e.retry(r.id,'a'),/cannot be retried/i);
 h.messages.set('child',[{id:'m1',type:'assistant',model:{providerID:'internal',id:'free'},time:{completed:1},content:[{type:'text',text:'recovered'}],finish:'stop'},{type:'idle',outcome:'succeeded'}]);
 result=await h.call('harness_resume',{run:r.id});assert.equal(result.tasks.a.status,'verifying');assert.equal(result.tasks.a.attempts[0].id,p.attempt);
});
test('project registration requires an actual native confirmation answer; rejection preserves config',async t=>{
 const h=await harness(t,true),repo=path.join(h.root,'workspace','business');fs.mkdirSync(repo);assert.equal(spawnSync('git',['init','-q'],{cwd:repo}).status,0);
 const definition={id:'new',roots:[repo],checks:[]},before=fs.readFileSync(path.join(h.root,'.ccm','config.json'),'utf8');
 h.setAnswer(['取消']);await assert.rejects(h.call('harness_register_project',definition),/not confirmed/);assert.equal(fs.readFileSync(path.join(h.root,'.ccm','config.json'),'utf8'),before);
 h.setAnswer(['确认登记']);const result=await h.call('harness_register_project',definition);assert.equal(result.project,'new');assert.equal(h.questions(),2);
});
test('MCP stays directly callable only in its approved role; unapproved sources are disabled',async t=>{
 const h=await harness(t);assert.equal(h.servers.get('knowledge').codemode,false);assert.equal(h.servers.get('public').disabled,true);
 h.dispatch('scout');const event={sessionID:'child',agent:'th-scout',model:{providerID:'internal',id:'free'},tools:{knowledge_search:{},public_search:{},shell:{},harness_read:{}},options:{}};
 await h.hooks.get('session.context')(event);assert.deepEqual(Object.keys(event.tools).sort(),['harness_read','knowledge_search']);
 await assert.rejects(h.hooks.get('tool.execute.before')({...event,tool:'public_search',input:{}}),/Tool denied/);
});

async function missingEnvironment(h) {
 const previous=process.env.PATH;process.env.PATH='';
 try {assert.equal((await h.call('harness_environment')).needsSetup,true)}finally {process.env.PATH=previous}
}
const runtimePlan={runtimes:['node'],versions:'Official compatible stable Node',sources:['https://nodejs.org/en/download'],verification:'Verify publisher SHA256 before extraction, then node --version',paths:'User approved test location; no shell profile change',rollback:'Remove only this installation',steps:[{command:'node --version',timeout:10000}]};
test('runtime maintenance requires real confirmation, exact single-use commands and no active business runs',async t=>{
 const h=await harness(t);await missingEnvironment(h);
 h.setAnswer(['取消']);await assert.rejects(h.call('harness_runtime_prepare',runtimePlan),/not confirmed/);
 const shell={...h.callContext,tool:'shell',input:runtimePlan.steps[0]};
 await assert.rejects(h.hooks.get('tool.execute.before')(shell),/user-approved/);
 h.setAnswer(['确认安装']);await h.call('harness_runtime_prepare',runtimePlan);
 await assert.rejects(h.hooks.get('tool.execute.before')({...shell,input:{...shell.input,command:'node --version; rm file'}}),/exact/);
 await assert.rejects(h.hooks.get('tool.execute.before')({...shell,sessionID:'different'}),/Tool denied/);
 await h.hooks.get('tool.execute.before')(shell);
 const permission={sessionID:'primary',action:'shell',source:{type:'tool',id:'other'},effect:'ask'};
 await h.hooks.get('permission.evaluate')(permission);assert.equal(permission.effect,'deny');
 permission.source.id=shell.id;await h.hooks.get('permission.evaluate')(permission);assert.equal(permission.effect,'allow');
 await assert.rejects(h.call('harness_start',{goal:'business'}),/maintenance is executing/);
 await h.hooks.get('tool.execute.after')({...shell,status:'completed',result:{output:{exit:0}}});
 await assert.rejects(h.hooks.get('tool.execute.before')(shell),/user-approved/);
 h.e.start('primary','business');await assert.rejects(h.call('harness_runtime_prepare',runtimePlan),/finish\/cancel/);
});
test('runtime approval is revoked on failure or a business start; unofficial research and children remain blocked',async t=>{
 const h=await harness(t);await missingEnvironment(h);h.setAnswer(['确认安装']);
 await assert.rejects(h.call('harness_runtime_prepare',{...runtimePlan,sources:['https://nodejs.org.evil.test/file']}),/official publisher/);
 await assert.rejects(h.hooks.get('tool.execute.before')({...h.callContext,tool:'webfetch',input:{url:'https://example.com/node'}}),/official source/);
 await h.call('harness_runtime_prepare',{...runtimePlan,steps:[...runtimePlan.steps,{command:'pnpm --version',timeout:10000}]});
 const shell={...h.callContext,tool:'shell',input:runtimePlan.steps[0]};await h.hooks.get('tool.execute.before')(shell);
 await h.hooks.get('tool.execute.after')({...shell,status:'completed',result:{output:{exit:1}}});
 await assert.rejects(h.hooks.get('tool.execute.before')({...shell,input:{command:'pnpm --version',timeout:10000}}),/user-approved/);
 await h.call('harness_runtime_prepare',runtimePlan);await h.call('harness_start',{goal:'business'});
 await assert.rejects(h.hooks.get('tool.execute.before')(shell),/Tool denied/);
 h.e.cancel(Object.values(h.e.read().runs)[0].id);h.dispatch();
 await assert.rejects(h.call('harness_environment',{}, {...h.callContext,sessionID:'child',agent:'th-scout'}),/Tool denied/);
});
