#!/usr/bin/env node
// Bootstrap must run before ANY third-party dependency is installed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {defaults} from '../src/defaults.mjs';
import {discoverRepositories} from '../src/projects.mjs';
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const cmd=process.argv[2]||'probe';
const output=x=>console.log(JSON.stringify(x,null,2));
function version(binary,args=['--version']) {
 const r=spawnSync(binary,args,{encoding:'utf8',timeout:10000,maxBuffer:200000});
 return r.status===0?r.stdout.trim().slice(0,200):null;
}
function pnpmEntry() {
 if(process.platform!=='win32')return {binary:'pnpm',prefix:[]};
 // pnpm.cmd cannot be spawned with shell:false. Use a known JS entry instead.
 for(const dir of (process.env.PATH||'').split(path.delimiter))for(const relative of ['node_modules/pnpm/bin/pnpm.cjs','node_modules/corepack/dist/pnpm.js']) {
  const file=path.join(dir,relative);if(fs.existsSync(file))return {binary:process.execPath,prefix:[file]};
 }
 throw Error('找不到可直接用 Node 启动的 pnpm。请由开发环境提供 pnpm 的 Node 入口；不会执行任意 cmd 包装脚本。');
}
function installed() {
 const expected=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).dependencies;
 return Object.fromEntries(Object.entries(expected).map(([name,want])=>{
  let actual=null;try{actual=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version}catch{}
  return [name,{expected:want,actual,ready:actual===want}];
 }));
}
async function main() {
 if(fs.realpathSync(process.cwd())!==root)throw Error('请在解压后的工作区根目录运行 onboarding。');
 const deps=installed(),ready=Object.values(deps).every(x=>x.ready);
 if(cmd==='probe') {
  let pnpm=null;try{const p=pnpmEntry();pnpm=version(p.binary,[...p.prefix,'--version'])}catch{}
  output({workspace:root,node:process.version,pnpm,opencode:version('opencode'),ripgrep:version('rg'),initialized:fs.existsSync(path.join(root,'.team-harness/config.json')),dependencies:deps,ready,
   next:ready?'生成并核对 .team-harness/onboard.json，然后 apply':'使用已有公司 registry 执行 install；不要切换公共源'});return;
 }
 if(cmd==='models') {
  const r=spawnSync('opencode',['models'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:200000});
  if(r.status!==0)throw Error('OpenCode 无法列出模型。请先完成已有公司 provider 配置；不读取或输出 API key。');
  const ids=r.stdout.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/).filter(s=>/^[\w.-]+\/\S+$/.test(s));
  output({models:ids.slice(0,500),truncated:ids.length>500});return;
 }
 if(cmd==='example'){output(defaults(root));return}
 if(cmd==='projects'){output(discoverRepositories(root));return}
 if(cmd==='install') {
  if(ready){output({installed:true,changed:false});return}
  const p=pnpmEntry();
  const r=spawnSync(p.binary,[...p.prefix,'install','--frozen-lockfile','--ignore-scripts'],{cwd:root,stdio:'inherit',timeout:300000});
  if(r.status!==0)throw Error('依赖安装失败；请检查公司 registry/网络，不要自动换源。');
  if(!Object.values(installed()).every(x=>x.ready))throw Error('安装后依赖版本不匹配。');
  output({installed:true,changed:true});return;
 }
 if(cmd==='apply') {
  if(!ready)throw Error('依赖未就绪，先完成 install。');
  if(fs.existsSync(path.join(root,'.team-harness/config.json')))throw Error('已初始化；不会覆盖规则或预算。使用 /workspace 查看当前规则。');
  const file=path.join(root,'.team-harness/onboard.json');
  if(fs.realpathSync(file)!==file)throw Error('Onboarding 配置不允许使用符号链接。');
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  const {Engine}=await import('../src/engine.mjs');
  const {init}=await import('../src/init.mjs');
  new Engine(root,{config});
  output({...init(root,config),restartRequired:true,next:'退出并重新打开 opencode，与 Jarvis 说继续或描述业务任务。'});return;
 }
 throw Error('支持 probe | models | projects | example | install | apply');
}
main().catch(err=>{console.error('Onboard:',err.message);process.exitCode=1});
