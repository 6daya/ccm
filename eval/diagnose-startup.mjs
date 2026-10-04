import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
const arg=k=>{const i=process.argv.indexOf('--'+k);return i<0?undefined:process.argv[i+1]};
if(process.platform==='win32')throw Error('This bounded process-group diagnostic currently supports Unix only; Windows validation is pending.');
const root=path.resolve(arg('out')||path.join('eval-results','cold-start-'+new Date().toISOString().replace(/[:.]/g,'-')));
if(fs.existsSync(root))throw Error('Use a fresh diagnostic directory');
fs.mkdirSync(root,{recursive:true});
const binary=arg('opencode')||process.env.OPENCODE_BIN||'opencode';
const version=spawnSync(binary,['--version'],{encoding:'utf8',timeout:10000});
if(version.status!==0)throw Error('OpenCode version check failed; pass a working --opencode binary.');
let requests=0;
const server=http.createServer(async(req,res)=>{
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
 let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests++;
 const base={id:'diagnostic-'+requests,created:Math.floor(Date.now()/1000),model:'free'};
 const usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
 if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'diagnostic fixture'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage})+'\n\n');res.end('data: [DONE]\n\n');}
 else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...base,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'diagnostic fixture'},finish_reason:'stop'}],usage}));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const profile={model:'diagnostic/free',enabled_providers:['diagnostic'],provider:{diagnostic:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'local-fixture-not-a-secret'},models:{free:{name:'Not a real LLM',limit:{context:32000,output:1024}}}}},autoupdate:false,share:'disabled'};
const summary={date:new Date().toISOString(),opencode:version.stdout.trim(),notRealLLM:true,harnessLoaded:false,providerCredentialsCopied:false,timeoutMs:45000,registryChanged:false,runs:[]};
try {
 for(const label of ['native-only','native-local-plugin']) {
 requests=0;
 const dir=path.join(root,label);fs.mkdirSync(path.join(dir,'.opencode'),{recursive:true});const config={...profile};if(label==='native-local-plugin'){fs.writeFileSync(path.join(dir,'diagnostic-plugin.mjs'),'export default async () => ({});\n');config.plugin=[path.join(dir,'diagnostic-plugin.mjs')];}fs.writeFileSync(path.join(dir,'opencode.json'),JSON.stringify(config));
 const isolated=path.join(root,label+'-isolated');
 const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(binary.includes(path.sep)?path.dirname(path.resolve(binary))+path.delimiter:'')+(process.env.PATH||''),XDG_CONFIG_HOME:path.join(isolated,'config'),XDG_DATA_HOME:path.join(isolated,'data'),XDG_CACHE_HOME:path.join(isolated,'cache'),XDG_STATE_HOME:path.join(isolated,'state'),OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_SHARE:'true',npm_config_cache:path.join(isolated,'npm-cache')};
 for(const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_CONFIG_DIR'])delete env[key];
 const registry=spawnSync('pnpm',['config','get','registry'],{cwd:dir,env,encoding:'utf8',timeout:10000});
 try {const u=new URL(registry.stdout.trim());summary.registry={pnpmReference:u.origin+u.pathname,scope:'pnpm reference only; OpenCode npm loader uses each config directory as cwd',exit:registry.status};}catch{summary.registry={pnpmReference:null,exit:registry.status};}
 const argv=['run','--print-logs','--log-level','DEBUG','--format','json','--dir',dir,'Reply with diagnostic fixture.'];
 const start=Date.now();let stdout='',stderr='',timedOut=false;
 const child=spawn(binary,argv,{cwd:dir,env,detached:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM')}catch{}},45000);
 const force=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},48000);
 const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exit,signal)=>resolve({exit,signal}));});clearTimeout(timer);clearTimeout(force);
 // This profile has no real credentials. Redact URLs with userinfo defensively.
 const redact=s=>s.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[REDACTED]@');
 fs.writeFileSync(path.join(root,label+'.stdout.jsonl'),redact(stdout));fs.writeFileSync(path.join(root,label+'.stderr.log'),redact(stderr));
 summary.runs.push({label,argv:argv.map(x=>x===dir?'$DIAGNOSTIC/'+label:x),...ended,ms:Date.now()-start,timedOut,modelRequests:requests,configDependencies:fs.existsSync(path.join(isolated,'config/opencode/node_modules')),projectDependencies:fs.existsSync(path.join(dir,'.opencode/node_modules')),lastLogLines:redact(stderr).split('\n').filter(Boolean).slice(-10)});
}
} finally {await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
