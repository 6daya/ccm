import {tool} from '@opencode-ai/plugin';
import {OhMyOpenCodeLite} from 'oh-my-opencode-slim';
import {Engine} from './engine.mjs';
import {coordinator,worker} from './prompts.mjs';
import {describeWorkspace} from './workspace.mjs';
const z=tool.schema;
const stringify=x=>JSON.stringify(x,null,2);
const rootTools=['harness_start','harness_result','harness_status','harness_workspace','harness_plan','harness_prepare','harness_accept','harness_retry','harness_resume','harness_cancel','harness_complete','harness_search','harness_read','harness_evidence','task','question'];
const childTools=['harness_search','harness_read','harness_evidence','harness_write','harness_check'];
export default async function Harness(ctx) {
  const e=new Engine(ctx.directory),c=e.config;
  const browserMcpIds=[...new Set(c.checks.filter(x=>x.type==='mcp').map(x=>x.mcpId))];
  const slim=await OhMyOpenCodeLite(ctx);
  const owner=(runID,session)=>{const r=e.status(runID);if(r.session!==session)throw Error('Run belongs to another primary session; resume that session');return r};
  const active=(session)=>{const s=e.read(),x=e.locate(s,session);if(x)return x.r;const r=Object.values(s.runs).find(r=>r.session===session&&r.status==='active');if(!r)throw Error('Call harness_start first');return r};
  const lookup=async session=>{
    let x=e.locate(e.read(),session);if(x)return x;
    const info=(await ctx.client.session.get({path:{id:session},query:{directory:ctx.directory}}))?.data;
    const id=/^TH:([\w-]+)/.exec(info?.title||'')?.[1];
    if(id)e.bind(id,session);
    return e.locate(e.read(),session);
  };
  const resume=async runID=>{
    const r=e.status(runID),statuses=(await ctx.client.session.status({query:{directory:ctx.directory}}))?.data;
    if(!statuses)throw Error('Cannot inspect live OpenCode status; no retries were authorized');
    for(const t of Object.values(r.tasks))for(const a of t.attempts.filter(a=>a.status==='running'||a.status==='unknown')){
      if(!a.session){e.markInterrupted(a.id);continue}
      if(statuses[a.session]?.type==='busy'||statuses[a.session]?.type==='retry')continue;
      const response=await ctx.client.session.messages({path:{id:a.session},query:{directory:ctx.directory}});
      if(response.error||!response.data)throw Error('Cannot inspect child messages');
      for(const m of response.data)e.usage(m.info);
      const last=response.data.filter(m=>m.info.role==='assistant').at(-1);
      const txt=last?.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      if(last?.info?.time?.completed&&last.info.finish==='stop'&&txt)e.finish(a.id,txt,false);
      else e.markInterrupted(a.session);
    }
    return e.status(runID);
  };
  const schema=(description,args,fn)=>tool({description,args,async execute(a,t){await lookup(t.sessionID);return stringify(await fn(a,t))}});
  const tools={
    harness_workspace:schema('Read-only workspace rules, project scripts and configuration. Does not execute or register discovered checks.',{},()=>describeWorkspace(e)),
    harness_start:schema('Register a goal in this primary session. Idempotent for an active run.',{goal:z.string()},(a,t)=>{const r=e.start(t.sessionID,a.goal);return {run:r.id,session:r.session,status:r.status,goal:r.goal}}),
    harness_status:schema('Inspect compact persisted task state and available configured checks.',{run:z.string().optional()},(a,t)=>{if(a.run)owner(a.run,t.sessionID);const s=e.read();const runs=Object.values(s.runs).filter(r=>r.session===t.sessionID&&(!a.run||r.id===a.run));return {config:{models:c.models,roots:c.roots,mcpIds:c.mcpIds,checks:c.checks,budget:c.budget,limits:c.limits},runs:runs.map(r=>({id:r.id,session:r.session,goal:r.goal,status:r.status,tasks:Object.values(r.tasks).map(t=>({id:t.id,role:t.role,status:t.status,acceptance:t.acceptance,dependencies:t.dependencies,target:t.target,resultPreview:t.result?.slice(0,1800),checks:Object.fromEntries(Object.entries(t.checksRun).map(([k,v])=>[k,{pass:v.pass,at:v.at}])),attempts:t.attempts.map(a=>({id:a.id,session:a.session,status:a.status,model:a.model,settled:a.settled,reserve:a.reserve}))}))})),estimatedUsd:Object.values(s.usage).filter(u=>runs.some(r=>r.id===u.run)).reduce((v,u)=>v+u.usd,0)}}),
    harness_result:schema('Read a bounded slice of a persisted child result; use rather than copying entire histories.',{run:z.string(),task:z.string(),offset:z.number().int().min(0).optional(),length:z.number().int().min(1).max(12000).optional()},(a,t)=>{owner(a.run,t.sessionID);const task=e.task(e.read(),a.run,a.task);return {task:a.task,status:task.status,totalChars:task.result?.length||0,text:task.result?.slice(a.offset||0,(a.offset||0)+(a.length||4000))}}),
    harness_plan:schema('Register immutable task contract. dependencies must exist. Verifier target is a candidate task.',{run:z.string(),id:z.string(),role:z.enum(['scout','planner','builder','verifier','expert']),goal:z.string(),acceptance:z.array(z.string()),dependencies:z.array(z.string()),writeFiles:z.array(z.string()),checks:z.array(z.string()),target:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);const{run,...d}=a;return e.plan(run,d)}),
    harness_prepare:schema('Validate dispatch and reserve budget. Copy returned args exactly into native task.',{run:z.string(),task:z.string(),evidenceIds:z.array(z.string()),reason:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);return e.prepare(a.run,a.task,a.evidenceIds,a.reason||'')}),
    harness_accept:schema('Accept independent verifier, or accept a candidate with its accepted verifier ID.',{run:z.string(),task:z.string(),review:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);return e.accept(a.run,a.task,a.review)}),
    harness_retry:schema('Release a prepared/failed/unknown attempt and queue a bounded new attempt. Cannot replay live or unreconciled paid work.',{run:z.string(),task:z.string()},(a,t)=>{owner(a.run,t.sessionID);return e.retry(a.run,a.task)}),
    harness_resume:schema('Reconcile stored attempts with actual OpenCode child statuses and completed messages. Does not blindly repeat requests.',{run:z.string()},async(a,t)=>{owner(a.run,t.sessionID);return resume(a.run)}),
    harness_cancel:schema('Cancel a run and abort its live child sessions. Keep unresolved billing reservations.',{run:z.string()},async(a,t)=>{owner(a.run,t.sessionID);const r=e.cancel(a.run);for(const task of Object.values(r.tasks))for(const attempt of task.attempts)if(attempt.status==='running'&&attempt.session){await ctx.client.session.abort({path:{id:attempt.session},query:{directory:ctx.directory}});e.markInterrupted(attempt.session)}return e.status(a.run)}),
    harness_complete:schema('Mark delivered only when all tasks accepted and usage settled.',{run:z.string()},(a,t)=>{owner(a.run,t.sessionID);return e.complete(a.run)}),
    harness_search:schema('Bounded local file discovery or text search. Free workers only; no expert search.',{root:z.string(),pattern:z.string().optional(),glob:z.string().optional(),mode:z.enum(['files','text']),maxResults:z.number().int().min(1).max(80).optional()},(a,t)=>e.search(a)),
    harness_read:schema('Read a bounded source excerpt inside allowed repositories (max 200 lines).', {file:z.string(),start:z.number().int().min(1).optional(),end:z.number().int().min(1).optional()},(a,t)=>e.evidence(active(t.sessionID).id,a)),
    harness_evidence:schema('Record source-linked local evidence or an excerpt from configured internal MCP. MCP authenticity is agent-supplied.',{file:z.string().optional(),start:z.number().int().min(1).optional(),end:z.number().int().min(1).optional(),uri:z.string().optional(),content:z.string().optional()},(a,t)=>e.evidence(active(t.sessionID).id,a)),
    harness_write:schema('Write an exact contract-scoped file. Refuses external edits, symlinks and runtime paths.',{file:z.string(),content:z.string()},(a,t)=>e.write(t.sessionID,a.file,a.content)),
    harness_check:schema('Run a registered command check or arm a fixed Playwright MCP sequence by ID. MCP checks only for independent verifiers. Records digest-bound check receipt.',{id:z.string()},(a,t)=>e.check(t.sessionID,a.id)),
  };
  return {
    ...slim,
    // Expose only the controlled tool set. Slim still tracks the ONE native task scheduler.
    tool:tools,
    async config(config) {
      if((config.plugin||[]).some(p=>/oh-my-opencode/.test(String(p))))throw Error('Remove the separate orchestration plugin; harness composes pinned Slim itself');
      await slim.config?.(config);
      config.default_agent='jarvis';config.model=c.models.free.id;config.small_model=c.models.free.id;
      config.autoupdate=false;config.share='disabled';
      config.agent??={};
      const permission=allowed=>({'*':'deny',...Object.fromEntries(allowed.map(t=>[t,'allow']))});
      config.agent.jarvis={mode:'primary',model:c.models.free.id,description:'Jarvis（贾维斯）：CCM 项目与任务助手',prompt:coordinator,permission:{...permission(rootTools),task:Object.fromEntries(['scout','planner','builder','verifier',...(c.models.expert?['expert']:[])].map(r=>['th-'+r,'allow']))},steps:c.limits.rootSteps};
      // Preserve old primary sessions and evaluation scripts without another scheduler.
      config.agent.orchestrator={...config.agent.jarvis,hidden:true,description:'Compatibility alias for Jarvis'};
      config.command??={};
      for(const name of ['onboard','workspace'])config.command[name]={description:name==='onboard'?'检查已完成的工作区初始化':'解释项目规则、模型与验收配置',agent:'jarvis',subtask:false,template:'Inspect the initialized workspace via harness_workspace. Explain rules and missing prerequisites; propose changes only, do not apply them. User request: $ARGUMENTS'};
      for(const role of ['scout','planner','builder','verifier','expert']) {
        if(role==='expert'&&!c.models.expert){config.agent['th-expert']={disable:true};continue}
        const allowed=role==='expert'?[]:childTools.filter(t=>t!=='harness_write'||role==='builder').filter(t=>t!=='harness_check'||['builder','verifier'].includes(role));
        const p=permission(allowed);
        if(role==='scout')for(const id of c.mcpIds.filter(id=>!browserMcpIds.includes(id)))p[id+'_*']='allow';
        if(role==='verifier')for(const check of c.checks.filter(x=>x.type==='mcp'))for(const step of check.steps)p[check.mcpId+'_'+step.tool]='allow';
        config.agent['th-'+role]={mode:'subagent',hidden:true,description:'Harness '+role,model:role==='expert'?c.models.expert.id:c.models.free.id,prompt:worker(role),permission:p,steps:role==='expert'?1:c.limits.workerSteps};
      }
      // All alternate entry points and Slim agents disabled, avoiding unmetered model routes.
      for(const name of Object.keys(config.agent))if(!['jarvis','orchestrator','th-scout','th-planner','th-builder','th-verifier','th-expert','title','summary','compaction'].includes(name))config.agent[name]={...config.agent[name],disable:true};
      for(const name of ['title','summary','compaction'])config.agent[name]={...config.agent[name],model:c.models.free.id};
      for(const [id,mcp] of Object.entries(config.mcp||{}))if(!c.mcpIds.includes(id)&&!browserMcpIds.includes(id))mcp.enabled=false;
    },
    async 'tool.execute.before'(input,output) {
      const x=await lookup(input.sessionID);
      if(browserMcpIds.some(id=>input.tool.startsWith(id+'_'))){e.mcpBefore(input.sessionID,input.tool,output.args);return}
      if(input.tool==='task') {e.dispatch(input.sessionID,output.args);await slim['tool.execute.before']?.(input,output);return}
      if(x) {
        if(x.r.status!=='active'||x.a.status!=='running')throw Error('Subtask is not active');
        const allowed=x.t.role==='expert'?[]:childTools.filter(t=>t!=='harness_write'||x.t.role==='builder').filter(t=>t!=='harness_check'||['builder','verifier'].includes(x.t.role));
        const internal=x.t.role==='scout'&&c.mcpIds.some(id=>input.tool.startsWith(id+'_'));
        if(!allowed.includes(input.tool)&&!internal)throw Error('Tool denied for constrained subagent: '+input.tool);
      }else if(!rootTools.includes(input.tool))throw Error('Tool denied for primary agent: '+input.tool);
    },
    async 'tool.execute.after'(input,output) {
      if(browserMcpIds.some(id=>input.tool.startsWith(id+'_'))){e.mcpAfter(input.sessionID,input.tool,input.args,output);return}
      if(browserMcpIds.some(id=>input.tool.startsWith(id+'_'))){e.mcpBefore(input.sessionID,input.tool,output.args);return}
      if(input.tool==='task') {
        const id=/^TH:([\w-]+)$/.exec(input.args.description||'')?.[1];
        const session=output.metadata?.sessionId||/<task id="([^"]+)"/.exec(output.output||'')?.[1];
        if(session){e.bind(id,session);const response=await ctx.client.session.messages({path:{id:session},query:{directory:ctx.directory}});for(const m of response.data||[])e.usage(m.info)}
        e.finish(id,output.output||'',/<task_error>|state="error"/.test(output.output||''));
        await slim['tool.execute.after']?.(input,output);
      }
    },
    async 'chat.params'(input,output) {
      const x=await lookup(input.sessionID);
      const actual=input.model.providerID+'/'+input.model.id;
      const expected=x?.a.model||c.models.free.id;
      if(actual!==expected)throw Error('Model routing denied: expected '+expected+', received '+actual);
      if(x&&x.a.status!=='running')throw Error('Attempt is not live');
      if(x?.a.tier==='expert')output.maxOutputTokens=c.limits.expertOutputTokens;
      // Do not invoke Slim fallback: no automatic paid retries or hidden switches.
    },
    async event(input) {
      const event=input.event;
      if(event.type==='session.created') {
        const info=event.properties?.info,id=/^TH:([\w-]+)/.exec(info?.title||'')?.[1];
        if(id)e.bind(id,info.id);
        // Slim's root-created update checker is intentionally not called.
        if(!info?.parentID)return;
      }
      if(event.type==='message.updated')e.usage(event.properties.info);
      await slim.event?.(input);
    },
    async 'experimental.session.compacting'(input,output) {
      output.context??=[];output.context.push('Persisted harness state (resume instead of repeating):\n'+stringify(Object.values(e.read().runs).filter(r=>r.session===input.sessionID)));
    },
  };
}
