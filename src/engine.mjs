import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {normalizeConfig,projectList,projectChecks,validateProjects,repositoryContext,discoverRepositories,gitView,inspectRepository} from './projects.mjs';
import {sensitivePath,sensitiveSearchArgs} from './sensitive-paths.mjs';
import {archiveRun,archiveStatus} from './archive.mjs';
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const fail = message => {throw new Error(message)};
const need = (condition, message) => condition || fail(message);
const now = () => new Date().toISOString();
const terminal = ['accepted','failed','cancelled'];
const inside = (p,root) => p===root || p.startsWith(root+path.sep);
export class Engine {
  constructor(directory,{config}={}) {
    this.directory=fs.realpathSync(directory);
    this.dir=path.join(this.directory,'.team-harness');
    this.config=normalizeConfig(this.directory,config||JSON.parse(fs.readFileSync(path.join(this.dir,'config.json'),'utf8')));
    this.validateConfig();
    if(!config)fs.mkdirSync(path.join(this.dir,'receipts'),{recursive:true});
    this.stateFile=path.join(this.dir,'state.json');
    this.lock=path.join(this.dir,'state.lock');
  }
  validateConfig() {
    const c=this.config;
    let ccm=false;try{ccm=JSON.parse(fs.readFileSync(path.join(this.directory,'package.json'),'utf8')).name==='ccm'}catch{}
    if(ccm)need(c.layout==='ccm-workspace','CCM root requires the ccm-workspace layout; do not grant business access to harness sources');
    need(c.version===1,'Unsupported configuration version');
    need(c.models?.free?.id && c.models.free.free===true,'Free model must be explicitly attested free');
    for(const [tier,m] of Object.entries(c.models)) {
      need(/^[^/]+\/.+/.test(m.id),'Model ID must be provider/model');
      if(tier!=='free' && !m.free) need(['input','output','cacheRead','cacheWrite'].every(k=>Number.isFinite(m.price?.[k])&&m.price[k]>=0),'Paid model requires all USD/million prices');
    }
    need(c.roots?.length>0 && c.roots.every(r=>path.isAbsolute(r)&&fs.existsSync(r)),'Configure existing absolute repository roots');
    need(c.limits?.maxAttempts>=1&&c.limits.maxNodes>=1&&c.limits.freeConcurrency>=1&&c.limits.paidConcurrency>=1,'Invalid task limits');
    need(c.budget.runUsd>=0&&c.budget.monthUsd>=0,'Invalid budget');
    need(Array.isArray(c.checks),'Checks array required');
    need(new Set(c.checks.map(x=>x.id)).size===c.checks.length,'Check IDs must be unique');
    for(const check of c.checks){
      need(/^[\w-]+$/.test(check.id),'Invalid check ID');
      if(check.type==='mcp'){
        need(/^[a-zA-Z0-9_]+$/.test(check.mcpId||'')&&Array.isArray(check.steps)&&check.steps.length>0&&check.steps.length<=12,'MCP check needs an MCP ID and 1–12 fixed steps');
        for(const step of check.steps){need(['browser_navigate','browser_click','browser_evaluate','browser_type','browser_select_option','browser_wait_for','browser_run_code','browser_snapshot','browser_take_screenshot','browser_console_messages','browser_network_requests'].includes(step.tool),'Unapproved browser MCP tool');need(step.args&&typeof step.args==='object','MCP step arguments required');need(typeof step.expectedPattern==='string'&&step.expectedPattern.length<=500,'MCP step needs a deterministic result assertion');new RegExp(step.expectedPattern);if(step.tool==='browser_navigate'){const url=new URL(step.args.url);need((c.browserOrigins||[]).includes(url.origin),'Browser navigation origin must be explicitly allowed')}}
      }else need(Array.isArray(check.argv)&&check.argv.length&&check.argv.every(a=>typeof a==='string')&&path.isAbsolute(check.cwd)&&c.roots.some(r=>inside(fs.realpathSync(check.cwd),fs.realpathSync(r))),'Command check requires argv and an allowed cwd');
    }
    need((c.requiredBuilderChecks||[]).every(id=>c.checks.some(check=>check.id===id)),'Mandatory checks must be configured');
    need((c.protectedWriteRoots||[]).every(r=>path.isAbsolute(r)),'Protected module roots must be absolute');
    validateProjects(c,this.directory);
  }
  projects() {return projectList(this.config)}
  scope(run) {return run.scope||{roots:this.config.roots,checkIds:this.config.checks.map(x=>x.id),requiredBuilderChecks:this.config.requiredBuilderChecks||[]}}
  assertRunConfig(run) {
    for(const [id,digest] of Object.entries(run.scope?.checkDigests||{})){const check=this.config.checks.find(c=>c.id===id);need(check&&hash(canonical(check))===digest,'Registered check changed during this run: '+id+'; restore its rules or start a new run')}
  }
  selected(session,projectID) {
    const active=Object.values(this.read().runs).find(r=>r.session===session&&r.status==='active');
    if(active){need(!projectID||projectID===active.project,'Finish/cancel the active run before switching projects');return {id:active.project||'default',...this.scope(active)}}
    const id=projectID||this.read().sessionProjects?.[session]||(this.projects().length===1?this.projects()[0].id:null);
    return this.projects().find(p=>p.id===id)||fail('Select a project; clarify which repositories the user intends');
  }
  selectProject(session,id) {
    const p=this.selected(session,id);
    return this.transaction(s=>{s.sessionProjects??={};s.sessionProjects[session]=p.id;return {project:p.id,roots:p.roots,configurationChanged:false,selectionPersisted:true}});
  }
  context(session,{project,files=[]}={}) {
    const p=this.selected(session,project),run=Object.values(this.read().runs).find(r=>r.session===session&&r.status==='active');
    return repositoryContext(this,p,{files,runID:run?.id});
  }
  discover() {return discoverRepositories(this.directory)}
  repository(runID,args) {return gitView(this,runID,args)}
  registerProject({id,name,roots,checks=[],checkIds=[],requiredBuilderChecks=[],protectedWriteRoots=[]}) {
    need(this.config.layout==='ccm-workspace','Project registration requires the CCM/workspace layout');
    need(!this.projects().some(p=>p.id===id),'Project already exists; existing rules are not overwritten');
    need(Array.isArray(roots)&&roots.length>0,'Repository paths required');
    need(!Object.values(this.read().runs).some(r=>r.status==='active'),'Finish/cancel active runs before registering project rules');
    for(const check of checks)need(check.type!=='mcp'&&!this.config.checks.some(c=>c.id===check.id),'Only new command checks may be registered; existing checks and MCP permissions are immutable');
    const resolved=roots.map(root=>path.resolve(this.directory,root));
    const inherited=this.projects().filter(p=>p.roots.some(root=>resolved.some(next=>inside(root,next)||inside(next,root)))).flatMap(p=>p.requiredBuilderChecks||[]).filter(id=>{
      const check=this.config.checks.find(c=>c.id===id);return check&&(check.type==='mcp'||resolved.some(root=>inside(check.cwd,root)));
    });
    requiredBuilderChecks=[...new Set([...requiredBuilderChecks,...inherited])];checkIds=[...new Set([...checkIds,...inherited])];
    const file=path.join(this.dir,'config.json'),raw=JSON.parse(fs.readFileSync(file,'utf8'));
    raw.projects.push({id,name:name||id,roots,checkIds:[...new Set([...checkIds,...checks.map(x=>x.id)])],requiredBuilderChecks});
    raw.roots=[...new Set([...(raw.roots||[]),...raw.projects.flatMap(p=>p.roots)])];raw.checks.push(...checks);raw.protectedWriteRoots=[...new Set([...(raw.protectedWriteRoots||[]),...protectedWriteRoots])];
    const normalized=normalizeConfig(this.directory,raw);
    new Engine(this.directory,{config:raw});
    return this.transaction(s=>{
      need(!Object.values(s.runs).some(r=>r.status==='active'),'Finish/cancel active runs before registering project rules');
      const disk=normalizeConfig(this.directory,JSON.parse(fs.readFileSync(file,'utf8')));
      need(canonical(disk)===canonical(this.config),'Configuration changed externally; restart before applying');
      fs.mkdirSync(path.join(this.dir,'backups'),{recursive:true});
      fs.copyFileSync(file,path.join(this.dir,'backups','config.before-project-'+crypto.randomUUID()+'.json'));
      const tmp=file+'.'+crypto.randomUUID();fs.writeFileSync(tmp,JSON.stringify(raw,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
      Object.assign(this.config,normalized);
      return {project:id,roots:this.projects().find(p=>p.id===id).roots,repositories:resolved.map(root=>({root,...inspectRepository(root)})),registeredChecks:checks.map(x=>x.id),inheritedMandatoryChecks:[...new Set(inherited)],requiredBuilderChecks,restartRequired:false,analysisOnly:!raw.projects.at(-1).checkIds.length,checksExecuted:false};
    });
  }
  read() {return fs.existsSync(this.stateFile)?JSON.parse(fs.readFileSync(this.stateFile,'utf8')):{version:1,runs:{},usage:{},reconciliations:[]};}
  transaction(fn) {
    let fd;
    try {fd=fs.openSync(this.lock,'wx')} catch {fail('State is locked. Use doctor; never delete a live lock.')}
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:now()}));
    try {
      const s=this.read(), result=fn(s);
      const tmp=this.stateFile+'.'+crypto.randomUUID();
      const out=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(out,JSON.stringify(s,null,2));fs.fsyncSync(out);fs.closeSync(out);fs.renameSync(tmp,this.stateFile);
      // Windows does not expose a portable fsync for directory handles. The state
      // file is still flushed and replaced atomically; do not fail every commit.
      if(process.platform!=='win32'){const d=fs.openSync(this.dir,'r');fs.fsyncSync(d);fs.closeSync(d)}
      return result;
    } finally {fs.closeSync(fd);fs.unlinkSync(this.lock)}
  }
  run(s,id) {return s.runs[id] || fail('Unknown run: '+id)}
  task(s,r,id) {return this.run(s,r).tasks[id] || fail('Unknown task: '+id)}
  log(run,type,detail) {run.events.push({at:now(),type,...detail})}
  safePath(file,write=false,runID) {
    need(path.isAbsolute(file),'Use an absolute path');
    const p=path.resolve(file);
    need(this.config.roots.some(r=>inside(p,fs.realpathSync(r))),'Path is outside configured repositories');
    if(runID)need(this.scope(this.status(runID)).roots.some(root=>inside(p,root)),'Path is outside the active project');
    if(this.config.layout==='ccm-workspace')need(inside(p,path.join(this.directory,'workspace')),'CCM implementation is protected from business tasks');
    need(!p.split(path.sep).some(x=>['.team-harness','.opencode','.git'].includes(x)),'Runtime/configuration paths are protected');
    need(!sensitivePath(p),'Sensitive credential paths are protected');
    let ancestor=p;while(!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
    const actual=path.join(fs.realpathSync(ancestor),path.relative(ancestor,p));
    need(actual===p,'Symlink paths are not allowed');
    if(!write) need(fs.statSync(p).isFile(),'Expected an existing regular file');
    return p;
  }
  search({root,pattern='',glob,mode='text',maxResults=40},runID) {
    const canonical=fs.realpathSync(root);
    need(canonical===path.resolve(root),'Symlink search roots are not allowed');
    need(this.config.roots.some(r=>inside(canonical,fs.realpathSync(r))),'Search outside repository roots');
    if(runID)need(this.scope(this.status(runID)).roots.some(root=>inside(canonical,root)),'Search outside the active project');
    need(!canonical.split(path.sep).some(p=>['.git','.opencode','.team-harness','node_modules'].includes(p)),'Protected search root');
    need(!sensitivePath(canonical),'Sensitive credential search roots are protected');
    need(typeof pattern==='string'&&pattern.length<=300&&Number.isInteger(maxResults)&&maxResults>=1&&maxResults<=80,'Invalid bounded search');
    need(['files','text'].includes(mode),'Search mode must be files or text');
    if(mode==='text')need(pattern.trim(),'Text search requires a narrow pattern');
    const args=['--no-heading','--color','never'];
    if(glob){need(typeof glob==='string'&&glob.length<=200,'Invalid glob');args.push('-g',glob)}
    // Mandatory exclusions follow user glob so a broad include cannot override them.
    args.push('-g','!**/.team-harness/**','-g','!**/.opencode/**','-g','!**/.git/**','-g','!**/node_modules/**',...sensitiveSearchArgs());
    if(mode==='files')args.push('--files','--null',canonical);else args.push('--json','--max-count','3','--',pattern,canonical);
    const out=spawnSync('rg',args,{encoding:'utf8',timeout:5000,maxBuffer:1e6});
    need(!out.error,'Search unavailable/too broad: install rg or narrow the scope');
    need(out.status===0||out.status===1,'Search failed: '+out.stderr?.slice(0,500));
    const lines=mode==='files'?out.stdout.split('\0').filter(Boolean):out.stdout.split('\n').filter(Boolean).flatMap(line=>{const item=JSON.parse(line);if(item.type!=='match'||!item.data.path.text||!item.data.lines.text)return [];return [{file:item.data.path.text,line:item.data.line_number,text:item.data.lines.text.trimEnd()}]});
    const safe=lines.filter(line=>{try{this.safePath(mode==='files'?line:line.file,false,runID);return true}catch{return false}}).map(line=>mode==='files'?line:`${line.file}:${line.line}:${line.text}`);
    return {root:canonical,mode,results:safe.slice(0,maxResults),truncated:safe.length>maxResults,next:'Read relevant source excerpts via harness_read; search hits are not verification evidence.'};
  }
  start(session,goal,projectID) {
    need(goal.trim().length>0,'A goal is required');
    return this.transaction(s=>{
      const existing=Object.values(s.runs).find(r=>r.session===session&&!['accepted','cancelled'].includes(r.status));
      if(existing){need(!projectID||projectID===existing.project,'Active run is bound to another project');return existing}
      const project=this.selected(session,projectID),checks=projectChecks(this.config,project);
      const r={id:crypto.randomUUID(),session,goal,project:project.id,scope:{roots:[...project.roots],checkIds:checks.map(x=>x.id),checkDigests:Object.fromEntries(checks.map(check=>[check.id,hash(canonical(check))])),requiredBuilderChecks:[...new Set([...(this.config.requiredBuilderChecks||[]),...(project.requiredBuilderChecks||[])])]},status:'active',created:now(),tasks:{},evidence:{},events:[]};
      s.runs[r.id]=r;this.log(r,'started',{});return r;
    });
  }
  plan(runID,definition) {
    return this.transaction(s=>{
      const r=this.run(s,runID);need(r.status==='active','Run is not active');
      this.assertRunConfig(r);
      const d=definition;
      need(/^[a-zA-Z0-9_-]{1,64}$/.test(d.id),'Invalid task ID');need(!r.tasks[d.id],'Task contract is immutable; retry or create a new ID');
      need(Object.keys(r.tasks).length<this.config.limits.maxNodes,'Node limit reached');
      need(['scout','planner','builder','verifier','expert'].includes(d.role),'Unknown role');
      need(typeof d.goal==='string'&&d.goal.trim(),'Task goal required');
      need(Array.isArray(d.acceptance)&&d.acceptance.length>0&&d.acceptance.every(a=>typeof a==='string'&&a.trim()),'Acceptance criteria required');
      need(Array.isArray(d.dependencies)&&d.dependencies.every(id=>r.tasks[id]),'Unknown dependencies');
      need(Array.isArray(d.writeFiles)&&d.writeFiles.every(f=>this.safePath(f,true,runID)),'Explicit writeFiles required');
      for(const f of d.writeFiles)need(!(this.config.protectedWriteRoots||[]).some(root=>inside(f,path.resolve(root))),'Write contract touches a user-protected module');
      if(d.role==='builder')need(this.scope(r).requiredBuilderChecks.every(id=>d.checks.includes(id)),'Builder contract omits a mandatory project check');
      need(d.role==='builder'||d.writeFiles.length===0,'Only builders may write');
      need(Array.isArray(d.checks)&&d.checks.every(id=>this.config.checks.some(c=>c.id===id)),'Unknown check');
      need(d.checks.every(id=>this.scope(r).checkIds.includes(id)),'Check belongs to another project');
      if(d.role==='builder')need(d.writeFiles.length>0&&d.checks.length>0,'Builders require file scopes and executable acceptance checks');
      if(d.role==='verifier')need(d.target&&r.tasks[d.target]&&r.tasks[d.target].role!=='verifier','Verifier requires a candidate target');
      const t={...d,tier:d.role==='expert'?'expert':'free',status:'queued',attempts:[],created:now(),result:null,checksRun:{}};
      r.tasks[d.id]=t;this.log(r,'planned',{task:d.id});return t;
    });
  }
  evidence(runID,{file,start=1,end=start+60,uri,content}) {
    need(Number.isInteger(start)&&Number.isInteger(end)&&start>=1&&end>=start&&end-start<200,'Evidence is at most 200 lines');
    let entry;
    if(file) {
      const p=this.safePath(file,false,runID),raw=fs.readFileSync(p,'utf8');need(raw.length<=2e6,'File too large; narrow source');
      entry={kind:'file',file:p,start,end,excerpt:raw.split('\n').slice(start-1,end).join('\n'),digest:hash(raw),at:now()};
    }else {
      need(typeof uri==='string'&&this.config.mcpIds.some(id=>uri.startsWith('mcp://'+id+'/')),'MCP evidence must identify an allowed internal connector');
      need(typeof content==='string'&&content.length<=12000&&content.trim(),'MCP excerpt required (12k chars max)');
      entry={kind:'mcp',uri,excerpt:content,digest:hash(content),at:now(),provenance:'agent-supplied; connector authenticity not independently attested'};
    }
    entry.id=hash(JSON.stringify(entry)).slice(0,16);
    return this.transaction(s=>{const r=this.run(s,runID);r.evidence[entry.id]=entry;this.log(r,'evidence',{id:entry.id});return entry});
  }
  fresh(e) {if(e.kind==='file')need(fs.existsSync(e.file)&&hash(fs.readFileSync(e.file,'utf8'))===e.digest,'Stale evidence: '+e.id)}
  prepare(runID,taskID,evidenceIDs=[],reason='') {
    return this.transaction(s=>{
      const r=this.run(s,runID),t=this.task(s,runID,taskID),c=this.config;
      this.assertRunConfig(r);
      need(r.status==='active','Run is not active');need(t.status==='queued','Task is not queued');
      need(Date.now()-Date.parse(r.created)<c.limits.runMinutes*60000,'Run time limit reached; create a new run');
      need(t.dependencies.every(id=>r.tasks[id].status==='accepted'),'Dependencies must be accepted');
      need(t.attempts.length<c.limits.maxAttempts,'Attempt limit reached');
      const packet=evidenceIDs.map(id=>{const e=r.evidence[id];need(e,'Unknown evidence');this.fresh(e);return e});
      if(t.role==='verifier')need(r.tasks[t.target].status==='verifying','Target is not ready for verification');
      const model=c.models[t.tier];need(model,'Tier not configured');
      if(t.tier!=='free') {
        need(packet.length>0&&reason.trim().length>=12,'Paid escalation requires evidence and a concrete reason');
        need(['boundary','semantic-failure','source-conflict','design-failure','user-request'].some(x=>reason.startsWith(x+':')),'Unsupported escalation reason');
      }
      const context=t.role==='expert'?{project:r.project,roots:this.scope(r).roots}:repositoryContext(this,{id:r.project,...this.scope(r)},{runID,files:t.writeFiles.length?t.writeFiles:(t.target?r.tasks[t.target].writeFiles:[])});
      const contextDigests=Object.fromEntries((context.repositories||[]).flatMap(repo=>repo.rules).map(rule=>[rule.file,rule.digest]));
      const prompt=JSON.stringify({harness:{run:runID,task:taskID,role:t.role,attempt:t.attempts.length+1,project:r.project},context,goal:t.goal,acceptance:t.acceptance,writeFiles:t.writeFiles,checks:t.checks,evidence:packet,target:t.target?{id:t.target,attempt:r.tasks[t.target].attempts.at(-1)?.id,result:r.tasks[t.target].role==='builder'?undefined:r.tasks[t.target].result?.slice(0,12000),changed:r.tasks[t.target].changed||[],checkIds:r.tasks[t.target].checks,checks:r.tasks[t.target].checksRun}:undefined});
      need(prompt.length<=c.limits.maxPacketChars,'Evidence packet too large; select narrower excerpts');
      const reserve=t.tier==='free'?0:(c.limits.maxPacketChars+c.limits.systemReserveTokens)*model.price.input/1e6+c.limits.expertOutputTokens*model.price.output/1e6;
      const outstanding=Object.values(s.runs).flatMap(x=>Object.values(x.tasks)).flatMap(x=>x.attempts).filter(a=>!a.settled);
      const active=outstanding.filter(a=>a.status==='running');
      need(active.filter(a=>a.tier===t.tier).length<(t.tier==='free'?c.limits.freeConcurrency:c.limits.paidConcurrency),'Concurrency limit reached');
      const month=now().slice(0,7);const usage=Object.values(s.usage).filter(u=>u.month===month);
      const runSpent=usage.filter(u=>u.run===runID).reduce((v,u)=>v+u.usd,0)+s.reconciliations.filter(u=>u.run===runID).reduce((v,u)=>v+u.usd,0);
      const monthSpent=usage.reduce((v,u)=>v+u.usd,0)+s.reconciliations.filter(u=>u.month===month).reduce((v,u)=>v+u.usd,0);
      need(runSpent+outstanding.filter(a=>a.run===runID).reduce((v,a)=>v+a.reserve,0)+reserve<=c.budget.runUsd,'Run budget reservation exceeded');
      need(monthSpent+outstanding.reduce((v,a)=>v+a.reserve,0)+reserve<=c.budget.monthUsd,'Monthly budget reservation exceeded');
      if(t.tier!=='free')need(Object.values(r.tasks).filter(x=>x.tier!=='free'&&x.attempts.length).length<c.limits.maxPaidNodes||t.attempts.length,'Paid node limit reached');
      const a={id:crypto.randomUUID(),run:runID,task:taskID,tier:t.tier,model:model.id,status:'prepared',reserve,settled:false,at:now(),promptHash:hash(prompt),contextDigests,evidenceIDs,reason,base:Object.fromEntries(t.writeFiles.map(f=>[f,fs.existsSync(f)?hash(fs.readFileSync(f)):null]))};
      if(t.role==='verifier')a.targetAttempt=r.tasks[t.target].attempts.at(-1)?.id;
      t.attempts.push(a);t.status='prepared';this.log(r,'prepared',{task:taskID,attempt:a.id,tier:t.tier,reserve});
      return {run:runID,task:taskID,attempt:a.id,args:{description:'TH:'+a.id,prompt,subagent_type:'th-'+t.role,background:false}};
    });
  }
  locate(s,id) {if(!id)return null;for(const r of Object.values(s.runs))for(const t of Object.values(r.tasks)){const a=t.attempts.find(a=>a.id===id||a.session===id);if(a)return{r,t,a}}return null}
  dispatch(parent,args) {
    return this.transaction(s=>{
      const id=/^TH:([\w-]+)$/.exec(args.description||'')?.[1],x=this.locate(s,id);need(x,'Use harness_prepare before task');
      const {r,t,a}=x;need(r.session===parent,'Only the owning main session may dispatch');
      this.assertRunConfig(r);
      need(r.status==='active'&&t.status==='prepared'&&a.status==='prepared','Duplicate, cancelled, or invalid dispatch');
      need(!args.task_id&&args.background!==true&&args.subagent_type==='th-'+t.role&&hash(args.prompt)===a.promptHash,'Task arguments do not match the immutable contract');
      for(const [file,digest] of Object.entries(a.contextDigests||{}))need(fs.existsSync(file)&&hash(fs.readFileSync(file))===digest,'Project rules changed; re-prepare the task');
      const active=Object.values(s.runs).flatMap(x=>Object.values(x.tasks)).flatMap(x=>x.attempts).filter(x=>x.status==='running');
      need(active.filter(x=>x.tier===a.tier).length<(a.tier==='free'?this.config.limits.freeConcurrency:this.config.limits.paidConcurrency),'Concurrency limit reached at dispatch');
      for(const x of active){const other=this.locate(s,x.id);need(!t.writeFiles.some(f=>other.t.writeFiles.includes(f)),'Concurrent write conflict')}
      a.status='running';t.status='running';this.log(r,'dispatched',{task:t.id,attempt:a.id});return a;
    });
  }
  bind(id,session) {return this.transaction(s=>{const x=this.locate(s,id);if(!x)return;need(!x.a.session||x.a.session===session,'Attempt session mismatch');x.a.session=session;return x.a})}
  finish(id,output,error=false) {
    return this.transaction(s=>{
      const x=this.locate(s,id);need(x,'Unknown attempt');const {r,t,a}=x;
      need(['running','unknown'].includes(a.status),'Attempt already finished');
      const file=path.join(this.dir,'receipts',a.id+'.txt');fs.writeFileSync(file,output,{mode:0o600});
      t.result=output;t.receipt=file;a.status=error?'failed':'completed';a.completed=now();
      a.settled=a.tier==='free'||(!error&&Object.values(s.usage).some(u=>u.session===a.session));
      if(r.status!=='cancelled')t.status=error?'failed':'verifying';
      if(t.role==='verifier'&&!error){try{const text=output.match(/<task_result>([\s\S]*?)<\/task_result>/)?.[1]??output;t.verdict=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{t.verdict=null}}
      this.log(r,'finished',{task:t.id,status:t.status,settled:a.settled});return t;
    });
  }
  usage(message) {
    if(message.role!=='assistant'||!message.time?.completed)return;
    return this.transaction(s=>{
      if(s.usage[message.id])return;
      const x=this.locate(s,message.sessionID),sessionRuns=Object.values(s.runs).filter(r=>r.session===message.sessionID);
      const root=sessionRuns.find(r=>r.status==='active')||sessionRuns.at(-1);
      if(!x&&!root)return;
      const tier=x?.a.tier||'free',m=this.config.models[tier],tokens=message.tokens||{};
      const price=m.price||{};
      const usd=m.free?0:((tokens.input||0)*(price.input||0)+(tokens.output||0)*(price.output||0)+(tokens.reasoning||0)*(price.output||0)+(tokens.cache?.read||0)*(price.cacheRead||0)+(tokens.cache?.write||0)*(price.cacheWrite||0))/1e6;
      s.usage[message.id]={id:message.id,session:message.sessionID,run:x?.r.id||root.id,tier,model:message.modelID,month:now().slice(0,7),tokens,usd,reportedCost:message.cost,source:'configured-price-estimate'};
    });
  }
  write(session,file,content) {
    const live=this.locate(this.read(),session),p=this.safePath(file,true,live?.r.id);need(typeof content==='string'&&Buffer.byteLength(content)<1e6,'Write limited to 1MB');
    return this.transaction(s=>{const x=this.locate(s,session);need(x&&x.a.status==='running'&&x.r.status==='active'&&x.t.role==='builder','Only an active builder can write');
      this.assertRunConfig(x.r);
      need(x.t.writeFiles.includes(p),'Write outside approved module/file scope');
      for(const [file,digest] of Object.entries(x.a.contextDigests||{}))need(fs.existsSync(file)&&hash(fs.readFileSync(file))===digest,'Project rules changed during task; preserve files and re-plan');
      const expected=x.a.base[p],actual=fs.existsSync(p)?hash(fs.readFileSync(p)):null;need(actual===expected,'File changed externally; preserve user edits and re-plan');
      fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);x.a.base[p]=hash(fs.readFileSync(p));x.t.changed=[...new Set([...(x.t.changed||[]),p])];this.log(x.r,'write',{task:x.t.id,file:p,digest:x.a.base[p]});return {file:p,digest:x.a.base[p]};
    });
  }
  check(session,id) {
    const s=this.read(),x=this.locate(s,session);need(x&&x.a.status==='running'&&x.r.status==='active'&&['builder','verifier'].includes(x.t.role),'Checks require an active builder or verifier');
    this.assertRunConfig(x.r);
    const target=x.t.role==='verifier'?this.task(s,x.r.id,x.t.target):x.t;need(target.checks.includes(id),'Check is not in the acceptance contract');
    const spec=this.config.checks.find(c=>c.id===id);need(spec,'Unknown check');
    if(spec.type==='mcp')return this.armMcp(session,id);
    const command=spawnSync(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,timeout:spec.timeoutMs||60000,maxBuffer:2e6,encoding:'utf8',env:{...process.env,...spec.env}});
    const receipt={id,bySession:session,byTask:x.t.id,targetAttempt:target.attempts.at(-1)?.id,at:now(),pass:command.status===0&&!command.error,exitCode:command.status,error:command.error?.message,stdout:command.stdout?.slice(-12000),stderr:command.stderr?.slice(-12000),argv:spec.argv,cwd:spec.cwd,files:Object.fromEntries(target.writeFiles.map(f=>[f,fs.existsSync(f)?hash(fs.readFileSync(f)):null]))};
    return this.transaction(s=>{const x=this.locate(s,session);need(x?.r.status==='active','Run cancelled during check');this.task(s,x.r.id,target.id).checksRun[id]=receipt;this.log(x.r,'check',{task:target.id,id,pass:receipt.pass});return receipt});
  }
  armMcp(session,id) {
    return this.transaction(s=>{
      const x=this.locate(s,session);need(x&&x.t.role==='verifier'&&x.a.status==='running'&&x.r.status==='active','Playwright MCP checks require an independent live verifier');
      const target=this.task(s,x.r.id,x.t.target),spec=this.config.checks.find(c=>c.id===id);need(target.checks.includes(id)&&spec?.type==='mcp','Unknown MCP acceptance check');
      // One shared browser per MCP endpoint: serialize checks, including across logical tasks.
      for(const run of Object.values(s.runs))for(const t of Object.values(run.tasks))for(const attempt of t.attempts)if(attempt.mcpPending?.mcpId===spec.mcpId&&attempt.status==='running')fail('Browser MCP is already leased by a verifier');
      x.a.mcpPending={id,mcpId:spec.mcpId,index:0,receipts:[],files:Object.fromEntries(target.writeFiles.map(f=>[f,fs.existsSync(f)?hash(fs.readFileSync(f)):null]))};
      return {id,status:'waiting_mcp',instructions:'Call these exact native MCP tools in order. The harness records actual tool outputs; do not declare success yourself.',steps:spec.steps.map(step=>({tool:spec.mcpId+'_'+step.tool,args:step.args}))};
    });
  }
  mcpBefore(session,tool,args) {
    const s=this.read(),x=this.locate(s,session);need(x&&x.t.role==='verifier'&&x.a.status==='running'&&x.r.status==='active','Only an active independent verifier may use Playwright MCP');
    this.assertRunConfig(x.r);
    const p=x.a.mcpPending;need(p,'Arm a registered MCP check via harness_check first');
    const step=this.config.checks.find(c=>c.id===p.id).steps[p.index];
    need(step&&tool===p.mcpId+'_'+step.tool&&canonical(args)===canonical(step.args),'Browser tool/arguments do not match the registered acceptance step');
    return p;
  }
  mcpAfter(session,tool,args,output) {
    this.mcpBefore(session,tool,args);
    return this.transaction(s=>{
      const x=this.locate(s,session),p=x.a.mcpPending,spec=this.config.checks.find(c=>c.id===p.id),step=spec.steps[p.index],text=output.output??(Array.isArray(output.content)?output.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):undefined)??(output.structuredContent?JSON.stringify(output.structuredContent):'');
      const pass=!output.isError&&!output.metadata?.isError&&new RegExp(step.expectedPattern).test(text);
      p.receipts.push({tool,args,outputKeys:Object.keys(output),digest:hash(text),output:text.slice(-12000),pass,at:now()});p.index++;
      if(!pass||p.index===spec.steps.length){
        const target=this.task(s,x.r.id,x.t.target),receipt={id:p.id,type:'mcp',mcpId:p.mcpId,bySession:session,byTask:x.t.id,targetAttempt:target.attempts.at(-1)?.id,at:now(),pass:pass&&p.receipts.every(r=>r.pass),files:p.files,steps:p.receipts};
        target.checksRun[p.id]=receipt;delete x.a.mcpPending;this.log(x.r,'check',{task:target.id,id:p.id,pass:receipt.pass,type:'mcp'});return receipt;
      }
      return {id:p.id,status:'waiting_mcp',nextStep:p.index};
    });
  }
  accept(runID,taskID,reviewID) {
    return this.transaction(s=>{const r=this.run(s,runID),t=this.task(s,runID,taskID);need(r.status==='active'&&t.status==='verifying','Candidate is not ready');
      this.assertRunConfig(r);
      if(t.role==='verifier'){need(t.verdict&&['pass','fail'].includes(t.verdict.verdict),'Verifier must return a valid verdict JSON');t.status='accepted';return t}
      const v=this.task(s,runID,reviewID);need(v.role==='verifier'&&v.target===taskID&&v.status==='accepted','Independent accepted verifier required');
      need(v.attempts.at(-1)?.targetAttempt===t.attempts.at(-1)?.id,'Review belongs to an older candidate attempt');
      need(v.verdict?.verdict==='pass','Verifier rejected the candidate');need(Array.isArray(v.verdict.evidenceIds)&&v.verdict.evidenceIds.length>0,'Verification needs evidence references');
      need(t.acceptance.every((_,i)=>v.verdict.acceptance?.[String(i)]===true),'Every acceptance criterion must pass');
      for(const id of v.verdict.evidenceIds){const e=r.evidence[id];need(e,'Unknown review evidence');this.fresh(e)}
      for(const id of t.checks){const check=t.checksRun[id];need(check?.pass,'Required executable check failed/missing: '+id);need(check.byTask===v.id&&check.targetAttempt===t.attempts.at(-1).id,'Independent verifier must run the current attempt checks: '+id);for(const [f,digest] of Object.entries(check.files))need((fs.existsSync(f)?hash(fs.readFileSync(f)):null)===digest,'Artifact changed after verification')}
      for(const a of t.attempts)for(const id of a.evidenceIDs){const ev=r.evidence[id];if(!t.writeFiles.includes(ev.file))this.fresh(ev)}
      t.status='accepted';this.log(r,'accepted',{task:taskID,review:reviewID});return t;
    });
  }
  retry(runID,taskID) {return this.transaction(s=>{const r=this.run(s,runID),t=this.task(s,runID,taskID);need(r.status==='active'&&['failed','verifying','unknown','prepared'].includes(t.status),'Task cannot be retried');
    need(t.attempts.every(a=>a.settled||a.status==='prepared'),'Unknown paid usage must be reconciled first');
    for(const a of t.attempts)if(a.status==='prepared'){a.status='cancelled';a.settled=true}
    need(t.attempts.length<this.config.limits.maxAttempts,'Attempt limit reached');t.status='queued';t.verdict=null;t.checksRun={};this.log(r,'retried',{task:taskID});return t});}
  markInterrupted(session) {return this.transaction(s=>{const x=this.locate(s,session);if(x&&x.a.status==='running'){x.a.status='unknown';if(x.r.status==='active')x.t.status='unknown';x.a.settled=x.a.tier==='free';this.log(x.r,'interrupted',{task:x.t.id})}})}
  reconcile(runID,taskID,usd,note) {need(Number.isFinite(usd)&&usd>=0&&note.trim(),'Gateway reconciliation amount/reason required');return this.transaction(s=>{const t=this.task(s,runID,taskID);const a=t.attempts.at(-1);need(a&&!a.settled&&a.status!=='running','No unresolved completed/interrupted request');const recorded=Object.values(s.usage).filter(u=>u.session===a.session).reduce((v,u)=>v+u.usd,0);need(usd>=recorded,'Reconciliation must cover already recorded usage');s.reconciliations.push({run:runID,task:taskID,attempt:a.id,usd:usd-recorded,month:now().slice(0,7),note,at:now()});a.settled=true;return a});}
  cancel(runID) {return this.transaction(s=>{const r=this.run(s,runID);r.status='cancelled';for(const t of Object.values(r.tasks))if(!terminal.includes(t.status)){t.status='cancelled';const a=t.attempts.at(-1);if(a?.status==='prepared'){a.status='cancelled';a.settled=true}}this.log(r,'cancelled',{});return r});}
  archiveStatus(runID) {return archiveStatus(this,this.status(runID))}
  archive(runID) {try{return this.transaction(()=>archiveRun(this,runID))}catch(error){return {status:'failed',error:error.message,retry:'Retry archive only; do not rerun accepted tasks. For a stale state lock use doctor.'}}}
  complete(runID) {
    const r=this.transaction(s=>{const r=this.run(s,runID);if(r.status==='accepted')return r;need(r.status==='active'&&Object.keys(r.tasks).length>0&&Object.values(r.tasks).every(t=>['accepted','cancelled'].includes(t.status)),'All required tasks must be accepted');need(Object.values(r.tasks).flatMap(t=>t.attempts).every(a=>a.settled),'Unreconciled usage prevents final completion');r.status='accepted';this.log(r,'delivered',{});return r});
    return {...r,archive:this.archive(runID)};
  }
  status(runID) {const s=this.read();return runID?this.run(s,runID):s;}
}
