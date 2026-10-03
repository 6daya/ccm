import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import {correctOrders} from './fixtures.mjs';
const call=(name,args)=>({call:{name,args}});
const txt=content=>({text:content});
function content(m){return typeof m.content==='string'?m.content:JSON.stringify(m.content)}
function result(body) {const tools=body.messages.filter(m=>m.role==='tool');const raw=tools.at(-1)?.content;if(typeof raw!=='string')return raw;try{return JSON.parse(raw)}catch{return raw}}
const definition=(run,id,role,extra={})=>({run,id,role,goal:role==='scout'?'Map order flow across web/orders/payments with source references':'Implement and verify order observability in the owning module',acceptance:['ownership and evidence correct'],dependencies:[],writeFiles:[],checks:[],...extra});
export async function gateway(root,browserCheck='browser') {
 const roots={EVAL_TOPOLOGY:{index:0},EVAL_OBSERVABILITY:{index:0,browserCheck}},children=new Map(),requests=[],errors=[];
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'free'},{id:'expert'}]}));return}
   if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return}
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
   const user=body.messages.filter(m=>m.role==='user').map(content).join('\n');
   let contract;
   for(const m of body.messages.filter(m=>m.role==='user')){try{const j=JSON.parse(content(m));if(j.harness)contract=j}catch{}}
   // OpenCode wraps user text in multipart content; extract the JSON text if needed.
   if(!contract)for(const m of body.messages.filter(m=>m.role==='user'))if(Array.isArray(m.content))for(const p of m.content){try{const j=JSON.parse(p.text);if(j.harness)contract=j}catch{}}
   let answer,role=contract?.harness.role||'coordinator',last=result(body);
   if(contract) {
    const key=contract.harness.run+':'+contract.harness.task+':'+contract.harness.attempt;
    let state=children.get(key);if(!state){state={index:0,ev:[]};children.set(key,state)}
    const i=state.index++,h=contract.harness,checkIds=contract.checks.length?contract.checks:contract.target?.checkIds;
    if(role==='scout') {
     const files=['repos/web/ARCHITECTURE.md','repos/orders/README.md','repos/payments/README.md'];
     if(last?.id)state.ev.push(last.id);
     answer=i<files.length?call('harness_read',{file:path.join(root,files[i]),start:1,end:12}):txt(JSON.stringify({topology:'Browser -> API gateway -> orders -> payments',owners:{orders:'checkout',payments:'payments'},risk:'liveness does not imply payment confirmation',evidenceIds:state.ev}));
    }else if(role==='builder') {
     if(h.task==='broken'&&h.attempt===1) {
      answer=i===0?call('harness_write',{file:path.join(root,'common/telemetry.js'),content:'export function trackOrder(){ return "order_submit" }'}):txt('Business insertion into common was rejected by the harness; no files were changed. Need explicit module-boundary decision.');
     }else {
      answer=i===0?call('harness_write',{file:path.join(root,'apps/orders.js'),content:correctOrders}):i===1?call('harness_check',{id:checkIds[0]}):i===2&&checkIds[1]!=='playwright'?call('harness_check',{id:checkIds[1]}):txt('Implemented scoped event assembly in apps/orders.js; boundary and browser checks passed.');
     }
    }else if(role==='expert') {
     answer=txt(JSON.stringify({decision:'Assemble order_submit in apps/orders.js; keep common/telemetry.js neutral. Propagate traceId and whitelist orderId only.',evidenceIds:contract.evidence.map(e=>e.id)}));
    }else if(role==='verifier') {
     if(h.target?.id==='broken'){} // target is at contract.target, not harness.
     if(h.task==='broken-review')answer=txt(JSON.stringify({verdict:'fail',acceptance:{0:false},evidenceIds:contract.evidence.map(e=>e.id),findings:['No valid business-module implementation exists; forbidden common write was blocked.']}));
     else if(contract.target.id==='map'||contract.target.id==='decision')answer=txt(JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:contract.evidence.map(e=>e.id),findings:[]}));
     else {
      if(last?.id&&last.excerpt)state.ev.push(last.id);
      if(last?.status==='waiting_mcp'&&last.steps)state.mcpSteps=last.steps;
      answer=i===0?call('harness_read',{file:path.join(root,'apps/orders.js'),start:1,end:20}):i===1?call('harness_check',{id:checkIds[0]}):i===2?call('harness_check',{id:checkIds[1]}):checkIds[1]==='playwright'&&i<3+(state.mcpSteps?.length||0)?call(state.mcpSteps[i-3].tool,state.mcpSteps[i-3].args):txt(JSON.stringify({verdict:'pass',acceptance:{0:true},evidenceIds:state.ev,findings:[]}));
     }
    }else answer=txt('unsupported scripted role');
   }else {
    const name=user.includes('EVAL_OBSERVABILITY')?'EVAL_OBSERVABILITY':'EVAL_TOPOLOGY',s=roots[name];
    if(last?.run&&!s.run)s.run=last.run;
    if(last?.id&&last.excerpt)s.ev=last.id;
    if(last?.args)s.prepared=last.args;
    const r=s.run;
    const prepare=(id)=>call('harness_prepare',{run:r,task:id,evidenceIds:s.ev?[s.ev]:[],reason:id==='decision'?'boundary: free implementation crossed the documented owning module boundary':''});
    const dispatch=()=>call('task',s.prepared);
    const plan=(id,role,extra)=>call('harness_plan',definition(r,id,role,extra));
    const accept=(id,review)=>call('harness_accept',{run:r,task:id,...review?{review}:{}});
    const topology=[
     ()=>call('harness_status',{}),()=>call('harness_start',{goal:'EVAL_TOPOLOGY: source-linked cross-repository order topology'}),
     ()=>call('harness_evidence',{file:path.join(root,'repos/web/ARCHITECTURE.md'),start:1,end:12}),
     ()=>plan('map','scout'),()=>prepare('map'),dispatch,
     ()=>plan('map-review','verifier',{target:'map'}),()=>prepare('map-review'),dispatch,
     ()=>accept('map-review'),()=>accept('map','map-review'),()=>call('harness_complete',{run:r}),()=>txt('跨仓拓扑已验证：Browser → API gateway → orders → payments。责任边界及健康检查误判风险均有来源。')
    ];
    const observe=[
     ()=>call('harness_status',{}),()=>call('harness_start',{goal:'EVAL_OBSERVABILITY: order page instrumentation, scoped escalation and recovery'}),
     ()=>call('harness_evidence',{file:path.join(root,'repos/web/ARCHITECTURE.md'),start:1,end:12}),
     ()=>plan('broken','builder',{writeFiles:[path.join(root,'apps/orders.js')],checks:['boundary',roots.EVAL_OBSERVABILITY.browserCheck||'browser']}),()=>prepare('broken'),dispatch,
     ()=>plan('broken-review','verifier',{target:'broken'}),()=>prepare('broken-review'),dispatch,
     ()=>accept('broken-review'),()=>accept('broken','broken-review'), // deliberately rejected by fail verdict
     ()=>plan('decision','expert'),()=>prepare('decision'),dispatch,
     ()=>plan('decision-review','verifier',{target:'decision'}),()=>prepare('decision-review'),dispatch,
     ()=>accept('decision-review'),()=>accept('decision','decision-review'),
     ()=>call('harness_retry',{run:r,task:'broken'}),
     ()=>txt('EVAL_PAUSE: 已完成证据与专家决策，在实现重试前主动停机；恢复后继续同一主会话。'),
     ()=>call('harness_status',{}),()=>call('harness_resume',{run:r}),
     ()=>prepare('broken'),dispatch,
     ()=>plan('retry-review','verifier',{target:'broken'}),()=>prepare('retry-review'),dispatch,
     ()=>accept('retry-review'),()=>accept('broken','retry-review'),
     ()=>call('harness_complete',{run:r}),()=>txt('订单页可观测已完成：公共模块越界写入被拒绝，限定专家给出边界决策，恢复后免费代理实现，Playwright 与接收端事件验收通过。')
    ];
    const steps=name==='EVAL_TOPOLOGY'?topology:observe;
    const i=s.index++;answer=steps[i]?.()||txt('script exhausted');
    requests.push({case:name,step:i,model:body.model,role,tool:answer.call?.name,inputBytes:Buffer.byteLength(raw),maxTokens:body.max_tokens||body.max_completion_tokens});
   }
   if(contract)requests.push({task:contract.harness.task,model:body.model,role,tool:answer.call?.name,inputBytes:Buffer.byteLength(raw),maxTokens:body.max_tokens||body.max_completion_tokens});
   const id='chatcmpl-'+crypto.randomUUID(),model=body.model;
   const msg=answer.call?{role:'assistant',content:null,tool_calls:[{id:'call_'+crypto.randomUUID().replaceAll('-',''),type:'function',function:{name:answer.call.name,arguments:JSON.stringify(answer.call.args)}}]}:{role:'assistant',content:answer.text};
   const finish=answer.call?'tool_calls':'stop';
   // Synthetic usage for metering regressions, NEVER a real LLM measurement.
   const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120};
   if(body.stream){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});const delta=msg.tool_calls?{role:'assistant',tool_calls:msg.tool_calls.map((t,index)=>({...t,index}))}:msg;res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta:{},finish_reason:finish}],usage})+'\n\n');res.end('data: [DONE]\n\n')}
   else {res.setHeader('content-type','application/json');res.end(JSON.stringify({id,object:'chat.completion',created:Math.floor(Date.now()/1000),model,choices:[{index:0,message:msg,finish_reason:finish}],usage}))}
  }catch(error){errors.push(error.stack);res.writeHead(500);res.end(JSON.stringify({error:{message:error.message}}))}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:'http://127.0.0.1:'+server.address().port+'/v1',requests,errors,close:()=>new Promise(r=>server.close(r))};
}
