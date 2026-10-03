import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function serve(root,port=0) {
 const events=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/_events'){res.setHeader('content-type','application/json');res.end(JSON.stringify(events));return}
  if(req.url==='/_reset'){events.length=0;res.end('ok');return}
  if(req.url==='/collect'){let body='';for await(const c of req)body+=c;events.push(JSON.parse(body));res.end('ok');return}
  const name=req.url==='/'?'index.html':req.url.split('?')[0].slice(1);
  if(!/^(index\.html|apps\/orders\.js|common\/telemetry\.js)$/.test(name)){res.writeHead(404);res.end();return}
  res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+server.address().port,events,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=await serve(path.resolve(process.argv[2]||process.cwd()),Number(process.argv[3]||3000));console.log(server.origin)}
export function browserCheck(origin,mcpId='playwright',fixture=false) {
 const code=`async () => {
  for(let i=0;i<100 && document.querySelector('#status').textContent!=='Done';i++) await new Promise(r=>setTimeout(r,20));
  const events=await (await fetch('/_events')).json();
  const expected={event:'order_submit',orderId:'order-42',traceId:'trace-fixture-42'};
  if(document.querySelector('#status').textContent!=='Done' || events.length!==1 || Object.keys(events[0]).sort().join(',')!==Object.keys(expected).sort().join(',') || Object.keys(expected).some(k=>events[0][k]!==expected[k])) throw new Error('observability acceptance failed: '+JSON.stringify(events));
  return {harnessPass:'orders-observability-v1',events};
 }`;
 return {id:'playwright',type:'mcp',mcpId,steps:[
  {tool:'browser_navigate',args:{url:origin+'/'},expectedPattern:fixture?'fixture_navigation_ok':'### (Page|Ran Playwright code)'},
  {tool:'browser_click',args:{target:'#buy',element:'Buy button'},expectedPattern:'### Ran Playwright code'},
  {tool:'browser_evaluate',args:{function:code},expectedPattern:'"harnessPass"\\s*:\\s*"orders-observability-v1"'},
  ...fixture?[]:[{tool:'browser_take_screenshot',args:{type:'png',filename:'artifacts/orders.png',fullPage:true,scale:'css'},expectedPattern:'[Ss]creenshot'}]
 ]};
}
