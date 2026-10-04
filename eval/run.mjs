import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {defaults,init,packageRoot} from '../src/init.mjs';
import {Engine} from '../src/engine.mjs';
import {fixtures,domFixture} from './fixtures.mjs';
import {serve,browserCheck as mcpCheck} from './case-server.mjs';
import {gateway} from './gateway.mjs';
const arg=k=>{const i=process.argv.indexOf('--'+k);return i<0?undefined:process.argv[i+1]};
const binary=arg('opencode')||process.env.OPENCODE_BIN||'opencode';
const root=path.resolve(arg('out')||path.join(packageRoot,'eval-results',new Date().toISOString().replace(/[:.]/g,'-')));
if(fs.existsSync(path.join(root,'ccm')))throw Error('Evaluation output already contains CCM. Use a fresh --out directory; existing files will not be overwritten.');
fs.mkdirSync(root,{recursive:true});
const consoleRoot=path.join(root,'ccm');
fs.cpSync(packageRoot,consoleRoot,{recursive:true,filter:p=>!['node_modules','.git','.team-harness','eval-results','workspace','artifacts','opencode.json','opencode.jsonc'].includes(path.relative(packageRoot,p).split(path.sep)[0])});
fs.symlinkSync(fs.realpathSync(path.join(packageRoot,'node_modules')),path.join(consoleRoot,'node_modules'),'junction');
const workspace=path.join(consoleRoot,'workspace/web');fs.mkdirSync(workspace,{recursive:true});
const mcpUrl=arg('playwright-mcp-url');
const realMcp=!process.argv.includes('--mcp-fixture')||!!mcpUrl;
fixtures(workspace);
const topologyFiles=[path.join(workspace,'repos/web/ARCHITECTURE.md')];
for(const name of ['orders','payments']){
 const repo=path.join(consoleRoot,'workspace',name);fs.mkdirSync(repo,{recursive:true});fs.copyFileSync(path.join(workspace,'repos',name,'README.md'),path.join(repo,'README.md'));topologyFiles.push(path.join(repo,'README.md'));
}
fs.writeFileSync(path.join(workspace,'AGENTS.md'),'Business events belong in apps/orders.js; common/ is protected. Never change acceptance checks.\n');
fs.writeFileSync(path.join(workspace,'package.json'),'{"name":"web","type":"module"}\n');
for(const repo of ['web','orders','payments'].map(name=>path.join(consoleRoot,'workspace',name))){
 for(const args of [['init','-q'],['add','.'],['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture baseline']]){
  const result=spawnSync('git',args,{cwd:repo,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);
 }
}
if(!realMcp){const slimRequire=createRequire(import.meta.resolve('oh-my-opencode-slim'));domFixture(workspace,slimRequire.resolve('jsdom'))}
const browserCheck='playwright';
const pageServer=await serve(workspace);
const gw=await gateway(workspace,browserCheck,{project:'orders-system',topologyFiles}),config=defaults(consoleRoot,'eval/free');
config.models.expert={id:'eval/expert',free:false,price:{input:10,output:50,cacheRead:1,cacheWrite:10}};
config.projects=[{id:'orders-system',roots:['workspace/web','workspace/orders','workspace/payments'],checkIds:['boundary',browserCheck],requiredBuilderChecks:['boundary',browserCheck]}];
config.protectedWriteRoots=['workspace/web/common','workspace/web/checks'];config.requiredBuilderChecks=[];
config.checks=[{id:'boundary',cwd:'workspace/web',argv:[process.execPath,'checks/boundary.mjs']},mcpCheck(pageServer.origin,'playwright',!realMcp)];
if(pageServer)config.browserOrigins=[pageServer.origin];
const mcpCommand=realMcp?[process.execPath,path.join(packageRoot,'node_modules/@playwright/mcp/cli.js'),'--headless','--isolated','--no-webmcp','--output-dir',path.join(workspace,'artifacts/mcp'),...(process.env.HARNESS_EVAL_BROWSER?['--executable-path',process.env.HARNESS_EVAL_BROWSER]:[])]:[process.execPath,path.join(packageRoot,'eval/mcp-fixture.mjs'),workspace];
fs.writeFileSync(path.join(consoleRoot,'opencode.json'),JSON.stringify({$schema:'https://opencode.ai/config.json',provider:{eval:{npm:'@ai-sdk/openai-compatible',name:'Deterministic local test gateway (not LLM)',options:{baseURL:gw.url,apiKey:'local-test-not-a-secret'},models:{free:{name:'free fixture',tool_call:true,limit:{context:128000,output:8192}},expert:{name:'expert fixture',tool_call:true,limit:{context:128000,output:8192}}}}},enabled_providers:['eval'],...({mcp:{playwright:mcpUrl?{type:'remote',url:mcpUrl,enabled:true}:{type:'local',command:mcpCommand,enabled:true}}})},null,2));
init(consoleRoot,config);
const home=path.join(root,'isolated');fs.mkdirSync(home,{recursive:true});
const nativeCache=arg('native-config-cache');
if(nativeCache){
 const cache=path.resolve(nativeCache),pkg=JSON.parse(fs.readFileSync(path.join(cache,'package.json'),'utf8'));
 assert.equal(pkg.dependencies?.['@opencode-ai/plugin'],'1.18.34','Use an existing official OpenCode 1.18.34 native config cache');
 for(const dir of [path.join(consoleRoot,'.opencode'),path.join(home,'config/opencode')]){
  fs.mkdirSync(dir,{recursive:true});for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(cache,file),path.join(dir,file));
  fs.symlinkSync(fs.realpathSync(path.join(cache,'node_modules')),path.join(dir,'node_modules'),'junction');
 }
}
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+path.dirname(path.resolve(binary))+path.delimiter+process.env.PATH,XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),XDG_CACHE_HOME:path.join(home,'cache'),XDG_STATE_HOME:path.join(home,'state'),OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_SHARE:'true',npm_config_cache:path.join(home,'npm-cache')};
const commands=[];
async function run(label,message,session) {
 console.log('Running '+label+' through real OpenCode + Slim');
 const argv=['run','--print-logs','--log-level','INFO','--format','json','--dir',consoleRoot,'--title',label,...session?['--session',session]:[],message];
 const start=Date.now();let stdout='',stderr='';
 const child=spawn(binary,argv,{env,cwd:consoleRoot,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});clearTimeout(timer);
 fs.writeFileSync(path.join(root,label+'.jsonl'),stdout);fs.writeFileSync(path.join(root,label+'.stderr.log'),stderr);
 commands.push({label,exit,ms:Date.now()-start});
 if(exit!==0)throw Error(label+' failed ('+exit+'): '+stderr.slice(-3000));
 const events=stdout.split('\n').flatMap(s=>{try{return[JSON.parse(s)]}catch{return[]}});
 const errors=events.filter(e=>e.type==='error');if(errors.length)throw Error(label+': '+JSON.stringify(errors));
 return {stdout,events};
}
let ok=false;
try {
 await run('topology','EVAL_TOPOLOGY: analyze order topology across repositories using internal file evidence; verify independently.');
 const e=new Engine(consoleRoot),topology=Object.values(e.read().runs).find(r=>r.goal.includes('EVAL_TOPOLOGY'));
 assert.equal(topology?.status,'accepted','topology run must be accepted');
 assert.equal(topology.project,'orders-system');assert.equal(topology.scope.roots.length,3);
 const commonBefore=fs.readFileSync(path.join(workspace,'common/telemetry.js'),'utf8');
 const phase=await run('observability-phase1','EVAL_OBSERVABILITY: implement order observability. Simulate an incorrect common module insertion, gated expert decision, and pause for restart.');
 assert.ok(phase.stdout.includes('EVAL_PAUSE'),'phase1 must pause intentionally');
 const r=Object.values(e.read().runs).find(r=>r.goal.includes('EVAL_OBSERVABILITY'));
 assert.equal(r.status,'active');assert.equal(r.tasks.broken.status,'queued');
 assert.equal(fs.readFileSync(path.join(workspace,'common/telemetry.js'),'utf8'),commonBefore,'common module must stay unchanged');
 const expertRequests=gw.requests.filter(x=>x.role==='expert').length;
 await run('observability-resumed','EVAL_OBSERVABILITY: 继续，从持久化状态恢复。',r.session);
 const final=e.status(r.id);assert.equal(final.status,'accepted');assert.equal(final.tasks.broken.attempts.length,2);
 assert.equal(gw.requests.filter(x=>x.role==='expert').length,expertRequests,'resumption must not repeat paid expert');
 assert.equal(final.tasks.broken.checksRun[browserCheck].pass,true);assert.equal(final.tasks.broken.checksRun.boundary.pass,true);
 assert.ok(gw.requests.filter(x=>x.role==='expert').every(x=>x.model==='expert'&&!x.tool),'expert must be bounded and tool-less');
 assert.ok(gw.requests.filter(x=>x.role!=='expert').every(x=>x.model==='free'),'all other requests must be free');
 assert.ok(gw.requests.filter(x=>x.task).every(x=>x.project==='orders-system'&&x.contextProject==='orders-system'),'every child must receive the selected project context');
 assert.equal(gw.errors.length,0);ok=true;
 console.log('PASS: two end-to-end fixtures, module boundary, independent acceptance, restart and no paid replay');
}finally {
 const state=fs.existsSync(path.join(consoleRoot,'.team-harness/state.json'))?new Engine(consoleRoot).read():null;
const report={ok,browserMode:realMcp?'real-playwright-mcp':'native-mcp-protocol-fixture-jsdom-not-browser',kind:'deterministic-gateway-real-opencode-integration',notRealLLM:true,nativeDependencyCacheReused:!!nativeCache,layout:'ccm-workspace',versions:{opencode:'1.18.34',slim:'3.0.2',playwrightMcp:'0.0.83'},commands,requests:gw.requests,errors:gw.errors,state};
 fs.writeFileSync(path.join(root,'evaluation.json'),JSON.stringify(report,null,2));
 if(pageServer)await pageServer.close();
 await gw.close();console.log('Evaluation artifacts: '+root);
}
