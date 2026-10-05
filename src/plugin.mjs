import {Plugin} from '@opencode/plugin';
import {z} from 'zod';
import {Engine} from './engine.mjs';
import {coordinator,worker} from './prompts.mjs';
import {describeWorkspace} from './workspace.mjs';
import {inspectEnvironment,trustedRuntimeUrl} from './environment.mjs';
import {requireV2} from './runtime.mjs';
const stringify=x=>JSON.stringify(x,null,2);
const rootTools=['harness_environment','harness_runtime_prepare','harness_start','harness_result','harness_status','harness_workspace','harness_discover','harness_select_project','harness_context','harness_repository','harness_register_project','harness_plan','harness_prepare','harness_accept','harness_retry','harness_resume','harness_cancel','harness_complete','harness_search','harness_read','harness_evidence','subagent','question'];
const childTools=['harness_search','harness_read','harness_evidence','harness_write','harness_check','harness_context','harness_repository'];
const ref=id=>{const [providerID,...parts]=id.split('/');return {providerID,id:parts.join('/')}};
const text=result=>typeof result.content==='string'?result.content:(result.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
export default Plugin.define({id:'ccm.v2',async setup(ctx) {
  requireV2(ctx.app.version);
  const e=new Engine(ctx.location.directory),c=e.config,registrations=[],controller=new AbortController();
  const browserMcpIds=[...new Set(c.checks.filter(x=>x.type==='mcp').map(x=>x.mcpId))];
  const owner=(runID,session)=>{const r=e.status(runID);if(r.session!==session)throw Error('Run belongs to another primary session; resume that session');return r};
  const active=session=>{const s=e.read(),x=e.locate(s,session);if(x)return x.r;const r=Object.values(s.runs).find(r=>r.session===session&&r.status==='active');if(!r)throw Error('Call harness_start first');return r};
  const lookup=async session=>{
    let x=e.locate(e.read(),session);if(x)return x;
    const info=await ctx.session.get({sessionID:session});
    const id=/^TH:([\w-]+)$/.exec(info.title||'')?.[1];
    const pending=e.locate(e.read(),id);
    if(pending&&info.parentID===pending.r.session&&info.location.directory===ctx.location.directory)e.bind(id,session);
    return e.locate(e.read(),session);
  };
  const usage=(sessionID,m)=>{if(m.type==='assistant')e.usage({...m,role:'assistant',sessionID,modelID:m.model.providerID+'/'+m.model.id})};
  const record=async session=>{const messages=await ctx.session.context({sessionID:session});for(const m of messages)usage(session,m);return messages};
  const resume=async runID=>{
    const r=e.status(runID),unresolved=[];
    for(const t of Object.values(r.tasks))for(const a of t.attempts.filter(a=>['running','unknown'].includes(a.status))){
      if(!a.session){unresolved.push({attempt:a.id,reason:'Child session not bound; no replay authorized'});continue}
      const messages=await record(a.session),idle=messages.at(-1);
      // A missing idle marker may be a live job or an interrupted process. Neither authorizes replay.
      if(idle?.type!=='idle'){unresolved.push({attempt:a.id,reason:'No terminal V2 idle marker; preserve reservation and do not replay'});continue}
      const last=messages.filter(m=>m.type==='assistant').at(-1),output=last?.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      if(idle.outcome==='succeeded'&&last?.time.completed&&last.finish==='stop'&&output)e.finish(a.id,output,false);
      else e.markInterrupted(a.session);
    }
    return {...e.status(runID),unresolved};
  };
  const schema=(description,args,fn)=>({description,input:z.toJSONSchema(z.object(args)),options:{codemode:false},async execute(a,t){await lookup(t.sessionID);a=z.object(args).parse(a);const output=await fn(a,t);return {content:stringify(output)}}});
  const missingRuntimes=new Set(),maintenance=new Map(),installing=new Map();
  const noRuns=()=>!Object.values(e.read().runs).some(r=>r.status==='active');
  const canMaintain=session=>missingRuntimes.has(session)&&noRuns();
  const confirmation=async(question,label,t)=>{
    const native=(await ctx.tool.list()).find(tool=>tool.name==='question');
    if(!native)throw Error('Native V2 confirmation unavailable');
    const answer=await native.execute({questions:[{header:'运行时维护',question,options:[{label,description:'按显示的具体步骤执行'},{label:'取消',description:'保留环境'}]}]},t);
    if(answer.output?.answers?.[0]?.length!==1||answer.output.answers[0][0]!==label)throw Error('Runtime installation was not confirmed by the user');
  };
  const tools={
    harness_environment:schema('Inspect fixed runtime versions and official installation sources. Missing dependencies may be repaired only after presenting a concrete plan and native approval, with no active business runs.',{},(_,t)=>{const result=inspectEnvironment();if(result.needsSetup)missingRuntimes.add(t.sessionID);else {missingRuntimes.delete(t.sessionID);maintenance.delete(t.sessionID)}return result}),
    harness_runtime_prepare:schema('Ask a native user form to authorize a concrete runtime plan. No active runs; commands are single-use, ordered and session-local. Includes probes, download verification, install/PATH, verification and rollback.',{runtimes:z.array(z.enum(['node','pnpm','rg','git'])).min(1).max(4),versions:z.string().min(1).max(1000),sources:z.array(z.string().url()).min(1).max(10),verification:z.string().min(1).max(3000),paths:z.string().min(1).max(3000),rollback:z.string().min(1).max(3000),steps:z.array(z.object({command:z.string().min(1).max(8000),timeout:z.number().int().min(1).max(300000)})).min(1).max(20)},async(a,t)=>{
      if(!canMaintain(t.sessionID)||installing.has(t.sessionID))throw Error('Inspect missing runtimes first; finish/cancel all runs and pending maintenance');
      if(a.sources.some(url=>!trustedRuntimeUrl(url)))throw Error('Runtime source is not an approved official publisher; company-managed installs require the company procedure');
      // Replacing a plan revokes its previous grant, including when the new form is cancelled.
      maintenance.delete(t.sessionID);
      await confirmation('确认以下运行时维护方案？不修改业务仓库、模型、预算、验收或 registry。下载先校验，失败停止。\n'+stringify(a),'确认安装',t);
      if(!canMaintain(t.sessionID))throw Error('A business run started while awaiting approval');
      maintenance.set(t.sessionID,a.steps);
      return {approved:true,steps:a.steps,expires:'session restart, business run, failed step or completed plan; changed commands require a new confirmation'};
    }),
    harness_workspace:schema('Read-only workspace rules, project scripts and configuration. Does not execute or register discovered checks.',{},()=>describeWorkspace(e)),
    harness_discover:schema('List immediate workspace/ repository candidates only. Does not scan code, clone repositories or grant access.',{},()=>e.discover()),
    harness_select_project:schema('Select a registered project for this primary session. Blocked while a run in another project is active.',{project:z.string()},(a,t)=>e.selectProject(t.sessionID,a.project)),
    harness_context:schema('Read selected project metadata and root/ancestor AGENTS.md for relevant files; discovered scripts are not executed.',{files:z.array(z.string()).max(20).optional()},(a,t)=>{const x=e.locate(e.read(),t.sessionID);return e.context(x?.r.session||t.sessionID,a)}),
    harness_repository:schema('Read status or tracked diff in an exact active business repository. Never acts on the parent CCM Git repository.',{root:z.string(),mode:z.enum(['status','diff'])},(a,t)=>e.repository(active(t.sessionID).id,a)),
    harness_register_project:schema('APPROVAL REQUIRED: register a new workspace project and explicit command checks. Preserve models, budget, existing checks and protections. Blocked during any active run.',{id:z.string(),name:z.string().optional(),roots:z.array(z.string()),checkIds:z.array(z.string()).optional(),requiredBuilderChecks:z.array(z.string()).optional(),protectedWriteRoots:z.array(z.string()).optional(),checks:z.array(z.object({id:z.string(),cwd:z.string(),argv:z.array(z.string()),timeoutMs:z.number().int().min(1).max(300000).optional()})).optional()},async(a,t)=>{
      const question=(await ctx.tool.list()).find(tool=>tool.name==='question');
      if(!question)throw Error('Native V2 question tool unavailable; project registration denied');
      const answer=await question.execute({questions:[{header:'项目接入',question:'确认登记以下具体规则？已有模型、预算与检查不会更改。\n'+stringify(a),options:[{label:'确认登记',description:'按所示范围、保护和命令接入项目'},{label:'取消',description:'保留当前工作区规则'}]}]},t);
      if(answer.output?.answers?.[0]?.length!==1||answer.output.answers[0][0]!=='确认登记')throw Error('Project registration was not confirmed by the user');
      return e.registerProject(a);
    }),
    harness_start:schema('Register a goal bound to the selected project in this primary session. Clarify project ambiguity first.',{goal:z.string(),project:z.string().optional()},(a,t)=>{if(installing.size)throw Error('Runtime maintenance is executing; wait for its result');maintenance.clear();const r=e.start(t.sessionID,a.goal,a.project);return {run:r.id,session:r.session,project:r.project,roots:r.scope.roots,status:r.status,goal:r.goal}}),
    harness_status:schema('Inspect compact persisted task state and available configured checks.',{run:z.string().optional()},(a,t)=>{if(a.run)owner(a.run,t.sessionID);const s=e.read();const runs=Object.values(s.runs).filter(r=>r.session===t.sessionID&&(!a.run||r.id===a.run));return {config:{models:c.models,roots:c.roots,mcpIds:c.mcpIds,checks:c.checks,budget:c.budget,limits:c.limits},runs:runs.map(r=>({id:r.id,session:r.session,goal:r.goal,status:r.status,archive:e.archiveStatus(r.id),tasks:Object.values(r.tasks).map(t=>({id:t.id,role:t.role,status:t.status,acceptance:t.acceptance,dependencies:t.dependencies,target:t.target,resultPreview:t.result?.slice(0,1800),checks:Object.fromEntries(Object.entries(t.checksRun).map(([k,v])=>[k,{pass:v.pass,at:v.at}])),attempts:t.attempts.map(a=>({id:a.id,session:a.session,status:a.status,model:a.model,settled:a.settled,reserve:a.reserve}))}))})),estimatedUsd:Object.values(s.usage).filter(u=>runs.some(r=>r.id===u.run)).reduce((v,u)=>v+u.usd,0)}}),
    harness_result:schema('Read a bounded slice of a persisted child result; use rather than copying entire histories.',{run:z.string(),task:z.string(),offset:z.number().int().min(0).optional(),length:z.number().int().min(1).max(12000).optional()},(a,t)=>{owner(a.run,t.sessionID);const task=e.task(e.read(),a.run,a.task);return {task:a.task,status:task.status,totalChars:task.result?.length||0,text:task.result?.slice(a.offset||0,(a.offset||0)+(a.length||4000))}}),
    harness_plan:schema('Register immutable task contract. dependencies must exist. Verifier target is a candidate task.',{run:z.string(),id:z.string(),role:z.enum(['scout','planner','builder','verifier','expert']),goal:z.string(),acceptance:z.array(z.string()),dependencies:z.array(z.string()),writeFiles:z.array(z.string()),checks:z.array(z.string()),target:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);const{run,...d}=a;return e.plan(run,d)}),
    harness_prepare:schema('Validate dispatch and reserve budget. Copy returned args exactly into native subagent.',{run:z.string(),task:z.string(),evidenceIds:z.array(z.string()),reason:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);return e.prepare(a.run,a.task,a.evidenceIds,a.reason||'')}),
    harness_accept:schema('Accept independent verifier, or accept a candidate with its accepted verifier ID.',{run:z.string(),task:z.string(),review:z.string().optional()},(a,t)=>{owner(a.run,t.sessionID);return e.accept(a.run,a.task,a.review)}),
    harness_retry:schema('Release a prepared/failed/unknown attempt and queue a bounded new attempt. Cannot replay live or unreconciled paid work.',{run:z.string(),task:z.string()},(a,t)=>{owner(a.run,t.sessionID);return e.retry(a.run,a.task)}),
    harness_resume:schema('Reconcile stored attempts with actual OpenCode child statuses and completed messages. Does not blindly repeat requests.',{run:z.string()},async(a,t)=>{owner(a.run,t.sessionID);return resume(a.run)}),
    harness_cancel:schema('Cancel a run and abort its live child sessions. Keep unresolved billing reservations.',{run:z.string()},async(a,t)=>{owner(a.run,t.sessionID);const r=e.cancel(a.run);for(const task of Object.values(r.tasks))for(const attempt of task.attempts)if(attempt.status==='running'&&attempt.session){await ctx.session.interrupt({sessionID:attempt.session,continue:false});e.markInterrupted(attempt.session)}return e.status(a.run)}),
    harness_complete:schema('Accept a completed run and automatically archive saved results. For an accepted run retry archive only; never dispatch or bill again. Archive failure is separate from business acceptance.',{run:z.string()},(a,t)=>{owner(a.run,t.sessionID);return e.complete(a.run)}),
    harness_search:schema('Bounded discovery inside the active project only. Free workers; no expert search.',{root:z.string(),pattern:z.string().optional(),glob:z.string().optional(),mode:z.enum(['files','text']),maxResults:z.number().int().min(1).max(80).optional()},(a,t)=>e.search(a,active(t.sessionID).id)),
    harness_read:schema('Read a bounded source excerpt inside allowed repositories (max 200 lines).', {file:z.string(),start:z.number().int().min(1).optional(),end:z.number().int().min(1).optional()},(a,t)=>e.evidence(active(t.sessionID).id,a)),
    harness_evidence:schema('Record source-linked local evidence or an excerpt from configured internal MCP. MCP authenticity is agent-supplied.',{file:z.string().optional(),start:z.number().int().min(1).optional(),end:z.number().int().min(1).optional(),uri:z.string().optional(),content:z.string().optional()},(a,t)=>e.evidence(active(t.sessionID).id,a)),
    harness_write:schema('Write an exact contract-scoped file. Refuses external edits, symlinks and runtime paths.',{file:z.string(),content:z.string()},(a,t)=>e.write(t.sessionID,a.file,a.content)),
    harness_check:schema('Run a registered command check or arm a fixed Playwright MCP sequence by ID. MCP checks only for independent verifiers. Records digest-bound check receipt.',{id:z.string()},(a,t)=>e.check(t.sessionID,a.id)),
  };
  const allowed=x=>x?x.t.role==='expert'?[]:childTools.filter(t=>t!=='harness_write'||x.t.role==='builder').filter(t=>t!=='harness_check'||['builder','verifier'].includes(x.t.role)):rootTools;
  const internal=(x,name)=>x?.t.role==='scout'&&c.mcpIds.filter(id=>!browserMcpIds.includes(id)).some(id=>name.startsWith(id+'_'));
  const browser=name=>browserMcpIds.some(id=>name.startsWith(id+'_'));
  const on=async(domain,name,fn)=>registrations.push(await domain.hook(name,fn));
  registrations.push(await ctx.tool.transform(editor=>{for(const [name,definition] of Object.entries(tools))editor.add({name,...definition})}));
  registrations.push(await ctx.agent.transform(editor=>{
    const ids=['jarvis',...['scout','planner','builder','verifier',...(c.models.expert?['expert']:[])].map(r=>'th-'+r)];
    for(const agent of editor.list())if(!ids.includes(agent.id))editor.remove(agent.id);
    const permissions=names=>[{action:'*',resource:'*',effect:'deny'},...names.map(action=>({action,resource:'*',effect:'allow'}))];
    editor.update('jarvis',a=>Object.assign(a,{name:'Jarvis',mode:'primary',hidden:false,model:ref(c.models.free.id),system:coordinator,description:'Jarvis（贾维斯）：CCM 项目与任务助手',steps:c.limits.rootSteps,permissions:[...permissions(rootTools.filter(n=>n!=='subagent')),{action:'shell',resource:'*',effect:'ask'},{action:'webfetch',resource:'*',effect:'ask'},...ids.filter(id=>id.startsWith('th-')).map(resource=>({action:'subagent',resource,effect:'allow'}))]}));
    for(const role of ['scout','planner','builder','verifier','expert']){
      if(role==='expert'&&!c.models.expert)continue;
      const names=allowed({t:{role}});
      if(role==='scout')names.push(...c.mcpIds.filter(id=>!browserMcpIds.includes(id)).map(id=>id+'_*'));
      if(role==='verifier')names.push(...c.checks.filter(x=>x.type==='mcp').flatMap(check=>check.steps.map(step=>check.mcpId+'_'+step.tool)));
      editor.update('th-'+role,a=>Object.assign(a,{name:'th-'+role,mode:'subagent',hidden:true,model:ref(role==='expert'?c.models.expert.id:c.models.free.id),system:worker(role),description:'Harness '+role,permissions:permissions(names),steps:role==='expert'?1:c.limits.workerSteps}));
    }
    editor.default('jarvis');
  }));
  registrations.push(await ctx.model.transform(editor=>editor.default.set(ref(c.models.free.id).providerID,ref(c.models.free.id).id)));
  registrations.push(await ctx.mcp.transform(editor=>{for(const [id] of editor.list())editor.update(id,mcp=>{if(!c.mcpIds.includes(id)&&!browserMcpIds.includes(id))mcp.disabled=true;else mcp.codemode=false})}));
  registrations.push(await ctx.websearch.transform(editor=>editor.default.set(false)));
  registrations.push(await ctx.command.transform(editor=>{for(const name of ['onboard','workspace'])editor.add({name,description:'检查 CCM 工作区与规则',async execute({sessionID,prompt,delivery}){await ctx.session.prompt({sessionID,delivery,...prompt,text:'Inspect harness_workspace and explain current rules. Do not alter existing models, budgets or checks. '+(prompt.text||'')})}})}));
  await on(ctx.tool,'execute.before',async event=>{
    const x=await lookup(event.sessionID);
    if(x&&(x.r.status!=='active'||x.a.status!=='running'))throw Error('Subtask is not active');
    if(!x&&event.agent!=='jarvis')throw Error('Unregistered agent entry denied');
    if(!x&&canMaintain(event.sessionID)&&event.tool==='webfetch'){
      if(!trustedRuntimeUrl(event.input?.url))throw Error('Runtime documentation must use an official source');return;
    }
    if(!x&&canMaintain(event.sessionID)&&event.tool==='shell'){
      const steps=maintenance.get(event.sessionID),input=event.input;
      if(installing.has(event.sessionID)||!steps?.length||input?.command!==steps[0].command||input.timeout!==steps[0].timeout||input.background===true||input.workdir&&input.workdir!==ctx.location.directory||Object.keys(input).some(k=>!['command','timeout','background','workdir'].includes(k)))throw Error('Shell requires the next exact user-approved runtime step');
      const step=steps.shift();installing.set(event.sessionID,{id:event.id,step});return;
    }
    if(browser(event.tool)){e.mcpBefore(event.sessionID,event.tool,event.input);return}
    if(!allowed(x).includes(event.tool)&&!internal(x,event.tool))throw Error('Tool denied for constrained agent: '+event.tool);
    if(event.tool==='subagent')e.dispatch(event.sessionID,event.input);
  });
  await on(ctx.permission,'evaluate',event=>{
    if(event.action!=='shell')return;
    const permit=installing.get(event.sessionID);
    event.effect=canMaintain(event.sessionID)&&permit&&event.source?.type==='tool'&&event.source.id===permit.id?'allow':'deny';
  });
  await on(ctx.tool,'execute.after',async event=>{
    if(event.tool==='shell'){
      const permit=installing.get(event.sessionID);
      if(permit?.id===event.id){
        installing.delete(event.sessionID);
        if(event.status==='error'||event.result.output?.exit!==0||!maintenance.get(event.sessionID)?.length)maintenance.delete(event.sessionID);
      }
      return;
    }
    if(browser(event.tool)){e.mcpAfter(event.sessionID,event.tool,event.input,event.status==='error'?{isError:true,output:event.error.message}:{...event.result,output:text(event.result)});return}
    if(event.tool!=='subagent')return;
    const id=/^TH:([\w-]+)$/.exec(event.input?.description||'')?.[1],x=e.locate(e.read(),id);
    if(!x||!['running','unknown'].includes(x.a.status))return;
    const result=event.status==='completed'?event.result.output:undefined;
    const session=result?.sessionID||event.result?.metadata?.sessionID||x.a.session;
    if(session){e.bind(id,session);await record(session)}
    if(event.status==='error')e.finish(id,event.error.message,true);
    else if(result?.status==='completed')e.finish(id,result.output||'',false);
    // Native background promotion keeps the attempt live. harness_resume reads its terminal marker.
  });
  const guard=async event=>{
    const x=await lookup(event.sessionID),actual=event.model.providerID+'/'+event.model.id;
    if(x&&(x.r.status!=='active'||x.a.status!=='running'))throw Error('Attempt is not live');
    const expected=x?.a.model||c.models.free.id;
    if(actual!==expected)throw Error('Model routing denied: expected '+expected+', received '+actual);
    if(x?.a.tier==='expert'&&event.kind&&event.kind!=='primary')throw Error('Paid auxiliary request denied');
    if(!x&&event.agent&&event.agent!=='jarvis')throw Error('Unregistered agent entry denied');
    if(x&&event.agent&&event.agent!=='th-'+x.t.role)throw Error('Attempt agent mismatch');
    return x;
  };
  await on(ctx.session,'context',async event=>{
    const x=await guard(event);
    for(const name of Object.keys(event.tools))if(!allowed(x).includes(name)&&!(!x&&canMaintain(event.sessionID)&&(name==='webfetch'||name==='shell'&&maintenance.get(event.sessionID)?.length))&&!internal(x,name)&&!(x?.t.role==='verifier'&&browser(name)))delete event.tools[name];
    if(x?.a.tier==='expert')event.options.maxTokens=c.limits.expertOutputTokens;
  });
  await on(ctx.session,'model.request',guard);
  await on(ctx.session,'http.request',async event=>{const x=await guard(event);if(x?.a.tier==='expert')e.admitPaidRequest(event.sessionID)});
  await on(ctx.session,'experimental.ws.handshake',async event=>{const x=await guard(event);if(x?.a.tier==='expert')throw Error('Paid WebSocket transport is not validated; use an HTTP company gateway')});
  await on(ctx.session,'retry',event=>{event.decision={retry:false}});
  // Deterministic titles add no model request; preserve TH attempt identity.
  await on(ctx.session,'title',async event=>{const info=await ctx.session.get({sessionID:event.sessionID});event.result=info.title||'CCM Jarvis'});
  await on(ctx.session,'compaction',async event=>{
    const x=await lookup(event.sessionID);if(x?.a.tier==='expert')throw Error('Paid compaction denied');
    await guard(event);
    const runs=Object.values(e.read().runs).filter(r=>r.session===event.sessionID).map(r=>({id:r.id,project:r.project,status:r.status,tasks:Object.values(r.tasks).map(t=>({id:t.id,role:t.role,status:t.status}))}));
    event.system.push({type:'text',text:'Persisted CCM state is authoritative. Use harness_status/result/resume; never replay paid attempts. '+stringify(runs)});
  });
  await on(ctx.session,'generate',async event=>{const x=await guard(event);if(x?.a.tier==='expert')throw Error('Paid transient generation denied')});
  const consume=(async()=>{
    for await(const event of ctx.event.subscribe({signal:controller.signal})){
      if(event.location?.directory!==ctx.location.directory)continue;
      const d=event.data;
      if(event.type==='session.created'){
        const id=/^TH:([\w-]+)$/.exec(d.title||'')?.[1],x=e.locate(e.read(),id);
        if(x&&d.parentID===x.r.session)e.bind(id,d.sessionID);
      }
      if(['session.step.ended','session.step.failed'].includes(event.type))await record(d.sessionID);
    }
  })().catch(error=>{if(!controller.signal.aborted){controller.abort();console.error('CCM V2 event accounting interrupted:',error.message)}});
  return async()=>{controller.abort();await consume;for(const registration of registrations.reverse())await registration.dispose()};
}});
