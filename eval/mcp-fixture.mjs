// Protocol fixture only. This is NOT Microsoft Playwright MCP and does not run a browser.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const root=process.argv[2];let buffer='';
const result=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
const tools=[{name:'browser_click',description:'Fixture click (no browser)',inputSchema:{type:'object',properties:{target:{type:'string'},element:{type:'string'}},required:['target']}},{name:'browser_navigate',description:'Fixture navigation (HTTP fetch; not a browser)',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}},{name:'browser_evaluate',description:'Fixture check invokes actual app code in jsdom and a real local HTTP collector, not a browser',inputSchema:{type:'object',properties:{function:{type:'string'}},required:['function'],additionalProperties:false}}];
async function handle(m){
 if(m.method==='initialize')return result(m.id,{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'harness-protocol-fixture-NOT-playwright',version:'0.1.0'}});
 if(m.method==='ping')return result(m.id,{});
 if(m.method==='tools/list')return result(m.id,{tools});
 if(m.method==='resources/list')return result(m.id,{resources:[]});
 if(m.method==='prompts/list')return result(m.id,{prompts:[]});
 if(m.method==='tools/call') {
  try {
   if(m.params.name==='browser_navigate'){const r=await fetch(m.params.arguments.url);if(!r.ok)throw Error('fixture page HTTP '+r.status);return result(m.id,{content:[{type:'text',text:'fixture_navigation_ok: HTTP page received; no browser launched'}]})}
   if(m.params.name==='browser_click')return result(m.id,{content:[{type:'text',text:'### Ran Playwright code\nfixture click; no browser'}]});
   const check=spawnSync(process.execPath,['checks/dom.mjs'],{cwd:root,encoding:'utf8',timeout:30000});
   if(check.status!==0)throw Error(check.stderr||'DOM check failed');
   return result(m.id,{content:[{type:'text',text:JSON.stringify({harnessPass:'orders-observability-v1',kind:'jsdom-http-protocol-fixture-not-browser',events:JSON.parse(fs.readFileSync(root+'/artifacts/events-dom.json','utf8'))})}]});
  }catch(error){return result(m.id,{isError:true,content:[{type:'text',text:error.message}]})}
 }
 if(m.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unknown method'}})+'\n');
}
process.stdin.on('data',data=>{buffer+=data;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())handle(JSON.parse(line)).catch(e=>process.stderr.write(e.stack+'\n'))}});
