// Dependency-free V2 catalog probe. The CLI's first models snapshot can precede
// plugin settlement; a private loopback server lets us wait without model calls.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export async function availableModels(directory,{binary='opencode',timeoutMs=30000}={}) {
 const password=randomUUID(),child=spawn(binary,['serve','--stdio','--hostname','127.0.0.1','--port','0'],{cwd:directory,env:{...process.env,PWD:directory,OPENCODE_SERVER_PASSWORD:password},stdio:['pipe','pipe','pipe']});
 let stdout='',failed=false;child.on('error',()=>failed=true);child.on('exit',()=>failed=true);child.stdout.on('data',chunk=>stdout=(stdout+chunk).slice(-4000));child.stderr.resume();
 const deadline=Date.now()+timeoutMs;
 try {
  while(Date.now()<deadline&&!failed){
   const endpoint=/http:\/\/127\.0\.0\.1:\d+/.exec(stdout)?.[0];
   if(endpoint){
    const query=new URLSearchParams({'location[directory]':directory});
    try{
     const response=await fetch(endpoint+'/api/model?'+query,{headers:{authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64')},signal:AbortSignal.timeout(Math.min(3000,Math.max(1,deadline-Date.now())))});
     if(response.ok){const {data}=await response.json();if(Array.isArray(data)&&data.length)return data.map(model=>model.providerID+'/'+model.id).sort()}
    }catch{}
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('OpenCode V2 未能提供可用模型目录。请核对已有公司 provider；不会请求或输出 API key。');
 }finally{
  child.stdin.end();
  if(!failed){child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),2000);await new Promise(resolve=>{child.once('exit',()=>{clearTimeout(force);resolve()});if(child.exitCode!==null){clearTimeout(force);resolve()}})}
 }
}
