#!/usr/bin/env node
// Bootstrap must run before ANY third-party dependency is installed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {requireV2,normalizeVersion,testedOpenCode} from '../src/runtime.mjs';
import {inspectEnvironment,pnpmEntry} from '../src/environment.mjs';
import {availableModels} from '../src/opencode-models.mjs';
import {defaults} from '../src/defaults.mjs';
import {discoverRepositories} from '../src/projects.mjs';
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const cmd=process.argv[2]||'probe';
const output=x=>console.log(JSON.stringify(x,null,2));
function version(binary,args=['--version']) {
 const r=spawnSync(binary,args,{encoding:'utf8',timeout:10000,maxBuffer:200000});
 return r.status===0?r.stdout.trim().slice(0,200):null;
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
  const opencode=version('opencode');
  output({runtime:'v2-only',testedOpenCode,opencodeCompatible:normalizeVersion(opencode)?.startsWith('2.')===true,workspace:root,environment:inspectEnvironment(),node:process.version,pnpm,opencode,ripgrep:version('rg'),initialized:fs.existsSync(path.join(root,'.ccm/config.json')),dependencies:deps,ready,
   next:ready?'生成并核对 .ccm/onboard.json，然后 apply':'缺失运行时先展示官方安装方案并确认；CCM 包使用已有公司 registry 执行 install，不换源'});return;
 }
 if(cmd==='models') {
  requireV2(version('opencode'));
  const ids=await availableModels(root);
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
  requireV2(version('opencode'));
  if(fs.existsSync(path.join(root,'.ccm/config.json')))throw Error('已初始化；不会覆盖规则或预算。使用 /workspace 查看当前规则。');
  const file=path.join(root,'.ccm/onboard.json');
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
