import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
export const runtimeSources={
 node:'https://nodejs.org/en/download',
 pnpm:'https://pnpm.io/installation',
 ripgrep:'https://github.com/BurntSushi/ripgrep/releases',
 git:'https://git-scm.com/downloads',
};
export function trustedRuntimeUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&(u.protocol==='https:')&&(
 u.hostname==='nodejs.org'||u.hostname==='pnpm.io'||u.hostname==='git-scm.com'||
 (u.hostname==='github.com'&&/^\/(BurntSushi\/ripgrep|pnpm\/pnpm|nodejs\/node)(\/|$)/.test(u.pathname)))}catch{return false}}
export function pnpmEntry() {
 if(process.platform!=='win32')return {binary:'pnpm',prefix:[]};
 for(const dir of (process.env.PATH||'').split(path.delimiter))for(const relative of ['node_modules/pnpm/bin/pnpm.cjs','node_modules/corepack/dist/pnpm.js']) {
  const file=path.join(dir,relative);if(fs.existsSync(file))return {binary:process.execPath,prefix:[file]};
 }
 throw Error('找不到可直接用 Node 启动的 pnpm。请通过已批准的开发环境安装方案提供入口。');
}
export function inspectEnvironment(){
 const tools=Object.fromEntries(['node','pnpm','rg','git'].map(binary=>{
  let result;try{const p=binary==='pnpm'?pnpmEntry():{binary,prefix:[]};result=spawnSync(p.binary,[...p.prefix,'--version'],{encoding:'utf8',timeout:5000,maxBuffer:10000})}catch{result={status:1}}
  return [binary,{available:result.status===0,version:result.status===0?result.stdout.trim().slice(0,200):null}];
 }));
 const node=tools.node.version?.replace(/^v/,'').split('.').map(Number),nodeCompatible=!!node&&((node[0]===22&&(node[1]>22||node[1]===22&&node[2]>=2))||(node[0]===24&&(node[1]>15||node[1]===15&&node[2]>=0))||node[0]>24);
 const directories=[...(process.env.PATH||'').split(path.delimiter).filter(Boolean),'/usr/local/bin','/opt/homebrew/bin',path.join(os.homedir(),'.local','bin')];
 const nvm=path.join(os.homedir(),'.nvm','versions','node');
 try{directories.push(...fs.readdirSync(nvm).sort().slice(-10).map(v=>path.join(nvm,v,'bin')))}catch{}
 const existingLocations=Object.fromEntries(['node','pnpm','rg','git'].map(binary=>[binary,[...new Set(directories)].map(dir=>path.join(dir,binary+(process.platform==='win32'?binary==='pnpm'?'.cmd':'.exe':''))).filter(file=>{try{return fs.statSync(file).isFile()}catch{return false}}).slice(0,20)]));
 return {platform:process.platform,arch:process.arch,hostRuntime:process.execPath,existingLocations,tools,nodeCompatible,needsSetup:!nodeCompatible||Object.values(tools).some(t=>!t.available),sources:runtimeSources,
  workflow:'先查找已有兼容运行时和 PATH；确实缺失再按系统/架构选择官方稳定版。展示版本、来源、校验、安装位置、PATH 改动及回退方案，经用户确认后安装。公司管理环境先遵循公司镜像/规范。无活动业务 run 时才可维护；子代理无安装权限。'};
}
