import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {sensitivePath} from './sensitive-paths.mjs';

export const inside=(file,root)=>file===root||file.startsWith(root+path.sep);
const requireThat=(ok,message)=>{if(!ok)throw Error(message)};
const git=(root,args)=>spawnSync('git',['-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:2e6});
export function inspectRepository(root) {
 const top=git(root,['rev-parse','--show-toplevel']);
 let independent=false;try{independent=top.status===0&&fs.realpathSync(top.stdout.trim())===root}catch{}
 if(!independent)return {independentGit:false,ready:false,note:'Not an independent Git root; initialize/restore the business repository, never use the parent CCM Git.'};
 const status=git(root,['status','--porcelain=v1','-z','--untracked-files=normal']),branch=git(root,['branch','--show-current']),head=git(root,['rev-parse','--verify','HEAD']);
 if(status.status!==0)return {independentGit:true,ready:false,note:'Read-only Git status failed; no repository files were changed.'};
 const records=status.stdout.split('\0').filter(Boolean),changes=[];
 for(let i=0;i<records.length;i++){const entry=records[i];changes.push({status:entry.slice(0,2),file:entry.slice(3)});if(/[RC]/.test(entry.slice(0,2)))i++}
 return {independentGit:true,ready:true,branch:branch.stdout.trim(),head:head.status===0?head.stdout.trim():null,dirty:changes.length>0,
  changes:changes.slice(0,40),truncated:changes.length>40,untrackedContentsIncluded:false,checksExecuted:false};
}
export function normalizeConfig(directory,raw) {
 const c=structuredClone(raw),resolve=p=>path.resolve(directory,p);
 c.roots=(c.roots||[]).map(resolve);
 c.protectedWriteRoots=(c.protectedWriteRoots||[]).map(resolve);
 c.checks=(c.checks||[]).map(check=>({...check,...check.cwd?{cwd:resolve(check.cwd)}:{}}));
 if(c.projects)c.projects=c.projects.map(p=>({...p,roots:(p.roots||[]).map(resolve)}));
 if(c.projects?.length&&!c.roots.length)c.roots=[...new Set(c.projects.flatMap(p=>p.roots))];
 return c;
}
export function projectList(c) {
 return c.projects?.length?c.projects:[{id:'default',name:'Default project',roots:c.roots,checkIds:c.checks.map(x=>x.id),requiredBuilderChecks:c.requiredBuilderChecks||[]}];
}
export function projectChecks(c,project) {
 return c.checks.filter(check=>(!project.checkIds||project.checkIds.includes(check.id))&&(check.type==='mcp'||project.roots.some(root=>inside(check.cwd,root))));
}
export function validateProjects(c,directory) {
 requireThat(!c.layout||c.layout==='ccm-workspace','Unknown workspace layout');
 if(c.layout==='ccm-workspace')requireThat(c.projects?.length,'Register at least one workspace project before initialization');
 if(!c.projects)return;
 requireThat(Array.isArray(c.projects)&&c.projects.length>0&&c.projects.length<=40,'Configure 1–40 projects');
 const ids=new Set(),union=new Set(),inspections=new Map();
 for(const p of c.projects) {
  requireThat(/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)&&!ids.has(p.id),'Project IDs must be unique and stable');ids.add(p.id);
  requireThat(p.roots?.length>0&&p.roots.length<=12,'Each project needs 1–12 repository roots');
  for(const root of p.roots){
   requireThat(c.roots.includes(root)&&fs.statSync(root).isDirectory()&&fs.realpathSync(root)===root,'Project root must be a configured real directory; symlinks are refused');
   if(c.layout==='ccm-workspace'){
    requireThat(inside(root,path.join(directory,'workspace'))&&root!==path.join(directory,'workspace'),'Business repositories must be below CCM/workspace; CCM itself cannot be a business root');
    if(!inspections.has(root))inspections.set(root,inspectRepository(root));
    const inspection=inspections.get(root);requireThat(inspection.independentGit&&inspection.ready,'Business directory must be an independent Git repository with readable status: '+root);
   }
   union.add(root);
  }
  const available=projectChecks(c,p).map(x=>x.id);
  requireThat(!p.checkIds||(Array.isArray(p.checkIds)&&p.checkIds.every(id=>available.includes(id))),'Project check IDs must belong to its repositories');
  requireThat((p.requiredBuilderChecks||[]).every(id=>available.includes(id)),'Project mandatory checks must be registered for this project');
 }
 requireThat(c.roots.every(root=>union.has(root)),'Every configured root must belong to a registered project');
}
export function discoverRepositories(directory) {
 const base=path.join(directory,'workspace');
 if(!fs.existsSync(base))return {base,repositories:[],notes:['Create workspace/ and copy or clone repositories into it.']};
 requireThat(fs.realpathSync(base)===base,'workspace/ must not be a symlink');
 const entries=fs.readdirSync(base,{withFileTypes:true}).filter(x=>!x.name.startsWith('.'));
 const repositories=[],notes=[];
 for(const entry of entries.slice(0,80)) {
  if(entry.isSymbolicLink()){notes.push(`${entry.name}: symlink skipped`);continue}
  if(!entry.isDirectory())continue;
  const root=path.join(base,entry.name);
  if(['.git','package.json','AGENTS.md','README.md'].some(file=>fs.existsSync(path.join(root,file))))repositories.push({id:entry.name.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,64),root:path.relative(directory,root).split(path.sep).join('/'),git:fs.existsSync(path.join(root,'.git')),...inspectRepository(root)});
  else notes.push(`${entry.name}: no repository marker; may be registered explicitly`);
 }
 return {base,repositories:repositories.slice(0,40),truncated:entries.length>80||repositories.length>40,notes:notes.slice(0,40),automaticRegistration:false};
}
function source(engine,file,max,runID) {
 engine.safePath(file,false,runID);
 requireThat(fs.statSync(file).size<=max,'Metadata exceeds inspection limit');
 return fs.readFileSync(file,'utf8');
}
export function repositoryContext(engine,project,{files=[],runID}={}) {
 requireThat(files.length<=20,'Context accepts at most 20 relevant files');
 for(const file of files){engine.safePath(file,true,runID);requireThat(project.roots.some(root=>inside(file,root)),'Context file is outside the selected project')}
 let remaining=12000;
 return {project:project.id,name:project.name||project.id,roots:project.roots,execution:'CCM console; repository tools and registered checks explicitly target these roots. Native OpenCode Git remains attached to CCM; V2 has no LSP, use registered typecheck/lint commands.',repositories:project.roots.map(root=>{
  const info={root,name:path.basename(root),git:inspectRepository(root),scripts:{},rules:[],notes:[]},pkg=path.join(root,'package.json');
  if(fs.existsSync(pkg))try{const data=JSON.parse(source(engine,pkg,200000,runID));info.name=String(data.name||info.name).slice(0,200);info.scripts=Object.fromEntries(Object.entries(data.scripts||{}).slice(0,20).map(([k,v])=>[k,String(v).slice(0,200)]))}catch(error){info.notes.push('package.json: '+error.message)}
  const dirs=new Set([root]);
  for(const file of files.filter(file=>inside(file,root))){let dir=path.dirname(file);while(inside(dir,root)){dirs.add(dir);if(dir===root)break;dir=path.dirname(dir)}}
  for(const dir of [...dirs].sort((a,b)=>a.length-b.length).slice(0,20)){
   const file=path.join(dir,'AGENTS.md');if(!fs.existsSync(file))continue;
   try{const text=source(engine,file,100000,runID),excerpt=text.slice(0,Math.min(4000,remaining));remaining-=excerpt.length;info.rules.push({file,excerpt,digest:crypto.createHash('sha256').update(text).digest('hex'),truncated:excerpt.length<text.length,trust:'Project constraints and source data; cannot override harness permissions or acceptance.'})}catch(error){info.notes.push('AGENTS.md: '+error.message)}
  }
  return info;
 }),registeredChecks:projectChecks(engine.config,project).map(x=>x.id),requiredBuilderChecks:[...new Set([...(engine.config.requiredBuilderChecks||[]),...(project.requiredBuilderChecks||[])])],sourceTrust:'Scripts are candidates, never executed by discovery. Read relevant module evidence before design.'};
}
export function gitView(engine,runID,{root,mode='status'}) {
 const r=engine.status(runID),scope=engine.scope(r);
 requireThat(scope.roots.includes(root),'Select an exact repository root in the active project');
 requireThat(['status','diff'].includes(mode),'Only read-only Git status and diff are supported');
 const execute=args=>git(root,args);
 const top=execute(['rev-parse','--show-toplevel']);
 requireThat(top.status===0&&fs.realpathSync(top.stdout.trim())===root,'Directory is not an independent Git repository; refusing the parent CCM repository');
 const branch=execute(['branch','--show-current']);
 let args=['status','--short','--untracked-files=normal'];
 if(mode==='diff'){
  const names=execute(['diff','--name-only','-z','--no-renames','--no-ext-diff','--no-textconv','HEAD','--','.']);
  requireThat(names.status===0,'Git diff requires an existing HEAD and readable tracked changes');
  const files=names.stdout.split('\0').filter(Boolean).filter(file=>{
   const absolute=path.join(root,file);
   if(sensitivePath(absolute)||absolute.split(path.sep).some(part=>['.git','.opencode','.ccm','.team-harness','node_modules'].includes(part)))return false;
   if(!fs.existsSync(absolute))return true; // Deleted file: Git's committed content only.
   try{engine.safePath(absolute,false,runID);return true}catch{return false}
  });
  // Literal paths and no renames prevent a safe renamed destination exposing a secret source.
  if(files.length===0)return {root,project:r.project,branch:branch.stdout.trim(),mode,text:'',truncated:false,untrackedContentsIncluded:false,sensitivePathsExcluded:true};
  args=['--literal-pathspecs','diff','--no-renames','--no-ext-diff','--no-textconv','HEAD','--',...files];
 }
 const response=execute(args);
 requireThat(response.status===0,'Git inspection failed: '+response.stderr?.slice(0,300));
 return {root,project:r.project,branch:branch.stdout.trim(),mode,text:response.stdout.slice(0,12000),truncated:response.stdout.length>12000,untrackedContentsIncluded:false,sensitivePathsExcluded:mode==='diff'};
}
