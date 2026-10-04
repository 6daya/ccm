import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message)};
const cell=value=>String(value??'').replaceAll('|','\\|').replace(/\r?\n/g,' ');
const json=value=>'```json\n'+JSON.stringify(value,null,2)+'\n```';
export function renderReport(engine,run,state=engine.read()) {
 const usage=Object.values(state.usage).filter(u=>u.run===run.id),reconciliations=state.reconciliations.filter(u=>u.run===run.id);
 const usd=[...usage,...reconciliations].reduce((sum,u)=>sum+u.usd,0),tasks=Object.values(run.tasks),roots=run.scope?.roots||engine.config.roots;
 const changed=[...new Set(tasks.flatMap(t=>t.changed||[]))];
 return `# ${run.goal}\n\nRun: ${run.id}\nProject: ${run.project||'default'}\nSession: ${run.session}\nStatus: ${run.status}\n${run.status==='accepted'?'业务已验收；以下是归档时保存的结果。':'未完成交付；不可当作已验收结果。'}\n\n`+
  `Estimated USD: ${usd.toFixed(6)} (configured prices; not gateway bill)\n实际网关总账单：未知。用量为记录时快照，可能不含尚未到达的主会话消息；未观测用量不等于零。\n\n## 仓库与修改\n\n`+
  roots.map(root=>`- ${root}\n  已记录修改：${changed.filter(file=>file===root||file.startsWith(root+path.sep)).join(', ')||'无'}`).join('\n')+
  '\n\n## 子任务结果与验收\n\n| Task | Role | Status | Attempts | Model |\n| --- | --- | --- | --- | --- |\n'+
  tasks.map(t=>`| ${cell(t.id)} | ${t.role} | ${t.status} | ${t.attempts.length} | ${cell(t.attempts.map(a=>a.model).join(', '))} |`).join('\n')+'\n\n'+
  tasks.map(t=>`### ${t.id}\n\nAcceptance: ${t.acceptance.join('; ')}\n\n${t.result||'(no result)'}\n\nChecks:\n\n${json(t.checksRun)}`).join('\n\n')+
  '\n\n## 来源（原有真实性标记保持不变）\n\n'+json(Object.values(run.evidence).map(({excerpt,...reference})=>reference))+
  '\n\n## 已观测用量与核账\n\n'+json({usage,reconciliations,unsettledAttempts:tasks.flatMap(t=>t.attempts).filter(a=>!a.settled).map(a=>({id:a.id,task:a.task,tier:a.tier,reserve:a.reserve}))})+
  '\n\n## 剩余问题\n\n结果中的未知项、风险和待核实来源仍然有效；归档只导出既有记录，不新增验证结论。\n';
}
function location(engine,run) {
 const project=run.project||'default';
 need(/^[\w-]{1,64}$/.test(project)&&/^[\w-]{1,64}$/.test(run.id),'Invalid archive identity');
 return path.join(engine.dir,'archive',project,run.id);
}
function realDirectory(dir,create=false) {
 if(!fs.existsSync(dir)){
  need(create,'Archive directory missing');
  realDirectory(path.dirname(dir),true);fs.mkdirSync(dir,{mode:0o700});
 }
 need(fs.lstatSync(dir).isDirectory()&&fs.realpathSync(dir)===dir,'Archive directory must be real; symlinks are refused');
}
export function archiveStatus(engine,run) {
 try {
  const directory=location(engine,run);
  // Check existing ancestors even if the final archive does not exist.
  let ancestor=directory;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);realDirectory(ancestor);
  if(!fs.existsSync(directory))return {status:'not-created',directory};
  realDirectory(directory);
  const report=path.join(directory,'report.md'),manifest=path.join(directory,'manifest.json');
  for(const file of [report,manifest])need(fs.lstatSync(file).isFile()&&fs.realpathSync(file)===file,'Archive files must be regular files; symlinks are refused');
  const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
  need(data.version===1&&data.status==='complete'&&data.runId===run.id&&data.projectId===(run.project||'default'),'Archive manifest is incomplete or belongs to another run');
  need(digest(fs.readFileSync(report))===data.report.sha256,'Archive report digest mismatch; preserve it for inspection');
  return {status:'complete',directory,report,manifest,archivedAt:data.archivedAt,runStatus:data.runStatus};
 }catch(error){return {status:'failed',error:error.message}}
}
function write(file,text) {
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
export function archiveRun(engine,runID) {
 const state=engine.read(),run=engine.run(state,runID),existing=archiveStatus(engine,run);
 if(existing.status==='complete')return {...existing,reused:true};
 need(existing.status==='not-created',existing.error||'Existing archive cannot be overwritten');
 // Unfinished reports are snapshots too. Do not freeze an active run under its final archive ID.
 need(['accepted','cancelled','failed'].includes(run.status),'Active run: use report for a current snapshot; final archive requires a terminal run');
 const directory=location(engine,run),base=path.dirname(directory);realDirectory(base,true);
 // The caller holds Engine's existing state lock. No second lock/recovery protocol.
 let pending;
 try {
  const again=archiveStatus(engine,run);if(again.status==='complete')return {...again,reused:true};
  need(again.status==='not-created',again.error||'Archive already exists');
  pending=fs.mkdtempSync(path.join(base,'.pending-'+run.id+'-'));fs.chmodSync(pending,0o700);
  const report=renderReport(engine,run,state),tasks=Object.values(run.tasks);
  const manifest={version:1,status:'complete',runId:run.id,projectId:run.project||'default',runStatus:run.status,
   archivedAt:new Date().toISOString(),snapshot:'Persisted state at export; no new checks, model calls or repository scan.',
   report:{file:'report.md',sha256:digest(report)},roots:run.scope?.roots||engine.config.roots,
   checkDigests:run.scope?.checkDigests||{},ruleDigests:Object.assign({},...tasks.flatMap(t=>t.attempts).map(a=>a.contextDigests||{})),
   sources:Object.values(run.evidence).map(({excerpt,...reference})=>reference),
   checks:tasks.flatMap(t=>Object.values(t.checksRun).map(check=>({task:t.id,id:check.id,pass:check.pass,at:check.at,targetAttempt:check.targetAttempt,receiptInReport:true}))),
   receipts:tasks.flatMap(t=>t.attempts).map(a=>({attempt:a.id,task:a.task,file:path.relative(directory,path.join(engine.dir,'receipts',a.id+'.txt')),recorded:fs.existsSync(path.join(engine.dir,'receipts',a.id+'.txt')),status:a.status})),
   billing:{gatewayTotalUsd:null,usageSnapshot:true,unsettledAttempts:tasks.flatMap(t=>t.attempts).filter(a=>!a.settled).map(a=>a.id)},
   privacy:'Local private report. Does not copy provider backups or package runtime/business repositories; check before sharing.'};
  write(path.join(pending,'report.md'),report);write(path.join(pending,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if(process.platform!=='win32'){const dirFD=fs.openSync(pending,'r');try{fs.fsyncSync(dirFD)}finally{fs.closeSync(dirFD)}}
  fs.renameSync(pending,directory);pending=null;
  if(process.platform!=='win32'){const dirFD=fs.openSync(base,'r');try{fs.fsyncSync(dirFD)}finally{fs.closeSync(dirFD)}}
  return {...archiveStatus(engine,run),reused:false};
 }finally {
  // A crash may leave a private .pending directory. A retry uses a fresh one and never replays work.
  if(pending)fs.rmSync(pending,{recursive:true,force:true});
 }
}
