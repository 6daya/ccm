#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {Engine} from '../src/engine.mjs';
import {defaults,init,packageRoot} from '../src/init.mjs';
import {describeWorkspace} from '../src/workspace.mjs';
const args=process.argv.slice(2),cmd=args.shift()||'help';
const value=(key,fallback)=>{const i=args.indexOf('--'+key);return i>=0?args[i+1]:fallback};
const flag=key=>args.includes('--'+key);
const workspace=path.resolve(value('workspace',process.cwd()));
const output=x=>console.log(JSON.stringify(x,null,2));
async function main() {
 if(cmd==='init') {
  let config;
  if(value('config'))config=JSON.parse(fs.readFileSync(path.resolve(value('config')),'utf8'));
  else {
   config=defaults(workspace,value('free'));
   if(!value('free')) {
    const rl=createInterface({input:stdin,output:stdout});
    try {
     console.log('只读取你已有的 OpenCode provider 配置。请使用 opencode models 显示的 provider/model ID；不会读取或保存 API key。');
     config.models.free.id=(await rl.question('免费主代理/执行模型 ID: ')).trim();
     const expert=(await rl.question('可选付费专家 ID（回车关闭）: ')).trim();
     if(expert){const p=JSON.parse(await rl.question('USD/百万 token 价格 JSON {"input":...,"output":...,"cacheRead":...,"cacheWrite":...}: '));config.models.expert={id:expert,free:false,price:p}}
     const mcps=(await rl.question('允许的内部 MCP 配置 ID，逗号分隔（回车无）: ')).trim();config.mcpIds=mcps?mcps.split(',').map(s=>s.trim()):[];
     if(config.layout==='ccm-workspace')console.log('已发现 workspace/ 项目：'+config.projects.map(p=>p.id).join(', ')+'；跨仓分组与验收请使用配置文件或 Jarvis 向导。');
     else {const roots=(await rl.question('仓库绝对路径，逗号分隔（回车当前目录）: ')).trim();if(roots)config.roots=roots.split(',').map(s=>fs.realpathSync(s.trim()))}
     const budget=(await rl.question('单任务 USD 预算（回车 10）: ')).trim();if(budget)config.budget.runUsd=Number(budget);
     const protectedRoots=(await rl.question('默认禁止修改的公共模块绝对路径，逗号分隔（回车无）: ')).trim();if(protectedRoots)config.protectedWriteRoots=protectedRoots.split(',').map(s=>path.resolve(s.trim()));
    }finally{rl.close()}
   }
  }
  if(value('checks')) {
   const project=JSON.parse(fs.readFileSync(path.resolve(value('checks')),'utf8'));
   for(const key of ['checks','requiredBuilderChecks','browserOrigins','protectedWriteRoots'])if(project[key]!==undefined)config[key]=project[key];
  }
  // Validate first using a temporary directory; no project config mutations on bad input.
  new Engine(workspace,{config});
  output(init(workspace,config));console.log('初始化完成。配置 checks 后，在此目录运行 opencode，正常对话即可。');return;
 }
 if(cmd==='example'){output(defaults(workspace));return}
 if(cmd==='projects'){output(describeWorkspace(new Engine(workspace)));return}
 if(cmd==='project-add'){
  if(!value('config'))throw Error('Provide --config FILE with project roots and explicit checks; existing rules will not be replaced');
  output(new Engine(workspace).registerProject(JSON.parse(fs.readFileSync(path.resolve(value('config')),'utf8'))));return;
 }
 if(cmd==='doctor') {
  const e=new Engine(workspace),binary=value('opencode','opencode');
  const v=spawnSync(binary,['--version'],{encoding:'utf8',timeout:10000});
  const notes=[];if(v.status!==0)notes.push('OpenCode not found: pass --opencode /absolute/path');else if(v.stdout.trim()!=='1.18.34')notes.push('Only OpenCode 1.18.34 is integration-tested; re-run eval for this version');
  if(!e.config.checks.length)notes.push('No executable checks registered: analysis tasks work, builders remain blocked');
  if(spawnSync('rg',['--version'],{encoding:'utf8',timeout:10000}).status!==0)notes.push('ripgrep not found: bounded local discovery requires rg on PATH');
  if(fs.existsSync(e.lock)){const l=JSON.parse(fs.readFileSync(e.lock,'utf8'));let live=true;try{process.kill(l.pid,0)}catch(err){live=err.code!=='ESRCH'};notes.push(`State lock PID ${l.pid}, live=${live}`);if(!live&&flag('repair-lock')){fs.unlinkSync(e.lock);notes.push('Removed stale process lock')}}
  const probe=await import('../src/plugin.mjs');
  output({configValid:true,pluginImport:typeof probe.default==='function',opencode:v.stdout?.trim(),testedSlim:'3.0.2',testedPlaywrightMcp:'0.0.83',platform:process.platform,windowsLiveTested:false,models:e.config.models,roots:e.config.roots,mcpIds:e.config.mcpIds,checks:e.config.checks.map(c=>c.id),notes});return;
 }
 if(cmd==='status'||cmd==='report') {
  const e=new Engine(workspace),state=e.read();const run=value('run');
  if(cmd==='status'){output(run?e.status(run):state);return}
  const rs=run?[e.status(run)]:Object.values(state.runs);
  const text=rs.map(r=>{
   const usage=Object.values(state.usage).filter(u=>u.run===r.id),usd=usage.reduce((s,u)=>s+u.usd,0)+state.reconciliations.filter(u=>u.run===r.id).reduce((s,u)=>s+u.usd,0);
   return `# ${r.goal}\n\nRun: ${r.id}\nProject: ${r.project||"legacy"}\nRepositories: ${(r.scope?.roots||e.config.roots).join(", ")}\nSession: ${r.session}\nStatus: ${r.status}\nEstimated USD: ${usd.toFixed(6)} (configured prices; not gateway bill)\n\n| Task | Role | Status | Attempts | Model |\n| --- | --- | --- | --- | --- |\n`+Object.values(r.tasks).map(t=>`| ${t.id} | ${t.role} | ${t.status} | ${t.attempts.length} | ${t.attempts.map(a=>a.model).join(', ')} |`).join('\n')+'\n\n'+Object.values(r.tasks).map(t=>`## ${t.id}\n\nAcceptance: ${t.acceptance.join('; ')}\n\n${t.result||'(no result)'}\n\nChecks:\n\n\`\`\`json\n${JSON.stringify(t.checksRun,null,2)}\n\`\`\``).join('\n\n');
  }).join('\n\n');if(value('out'))fs.writeFileSync(path.resolve(value('out')),text);else console.log(text);return;
 }
 if(cmd==='resume') {
  const e=new Engine(workspace),r=value('run')?e.status(value('run')):Object.values(e.read().runs).filter(r=>r.status==='active').at(-1);
  if(!r)throw Error('No active run');
  console.log(`主会话: ${r.session}\n恢复入口: opencode --session ${r.session}\n打开后说“继续”；主代理将调用 harness_status / harness_resume。`);return;
 }
 if(cmd==='reconcile') {
  const e=new Engine(workspace);output(e.reconcile(value('run'),value('task'),Number(value('usd')),value('note','')));return;
 }
 if(cmd==='cancel'){const e=new Engine(workspace);output(e.cancel(value('run')));console.log('本地已取消，写入/新派发会被拒绝。若 OpenCode 仍在线，在主会话说取消以主动 abort；供应商在途请求可能继续计费。');return}
 if(cmd==='eval') {await import('../eval/run.mjs');return}
 console.log(`CCM 0.2.0 — OpenCode 1.18.34 / Slim 3.0.2\n\nnode ${path.join(packageRoot,'bin/cli.mjs')} init [--workspace PATH] [--free provider/model] [--config FILE]\n  projects | project-add --config FILE\n  example | doctor [--opencode PATH] [--repair-lock]\n  status [--run ID] | resume [--run ID] | report [--out FILE]\n  reconcile --run ID --task ID --usd TOTAL --note GATEWAY_RECEIPT\n  cancel --run ID\n  eval\n\nAPI keys remain in your existing OpenCode provider config. No actual model is called by init or doctor.`);
}
main().catch(e=>{console.error('Harness:',e.message);process.exitCode=1});
