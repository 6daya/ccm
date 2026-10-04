import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,modify,applyEdits} from 'jsonc-parser';
export {defaults} from './defaults.mjs';
export const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function playwrightCommand({origins=[],outputDir,executablePath}={}) {
 return [process.execPath,path.join(packageRoot,'node_modules','@playwright','mcp','cli.js'),'--headless','--isolated','--no-webmcp',
  ...(origins.length?['--allowed-origins',origins.join(';')]:[]),
  ...(outputDir?['--output-dir',outputDir]:[]),...(executablePath?['--executable-path',executablePath]:[])];
}
export function init(workspace,config) {
 const root=fs.realpathSync(workspace),runtime=path.join(root,'.team-harness'),op=path.join(root,'.opencode');
 if(fs.existsSync(path.join(runtime,'config.json')))throw Error('Already initialized. Edit the existing config explicitly; init will not overwrite it.');
 const candidates=['opencode.jsonc','opencode.json','.opencode/opencode.jsonc','.opencode/opencode.json'].map(p=>path.join(root,p));
 // This immutable startup profile selects the dependency-free Jarvis agent.
 // It is not a second machine-specific provider config and must not be rewritten.
 const existing=candidates.filter(p=>fs.existsSync(p)).filter(p=>{
  if(p!==path.join(op,'opencode.jsonc'))return true;
  const errors=[],data=parse(fs.readFileSync(p,'utf8'),errors);
  return !(errors.length===0&&data&&Object.keys(data).length===3&&data.default_agent==='jarvis'&&data.autoupdate===false&&data.share==='disabled');
 });
 if(existing.length>1)throw Error('Multiple project OpenCode configs exist. Consolidate them before init.');
 const target=existing[0]||path.join(root,'opencode.jsonc');
 const raw=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'{}\n',errors=[],parsed=parse(raw,errors);
 if(errors.length||!parsed||typeof parsed!=='object')throw Error('Existing OpenCode JSONC is invalid; no files changed');
 if((parsed.plugin||[]).some(p=>/oh-my-opencode|team-harness/.test(String(p))))throw Error('An orchestration plugin is already configured. Remove/disable it to avoid two schedulers before init.');
 if(fs.existsSync(path.join(op,'oh-my-opencode-slim.json'))||fs.existsSync(path.join(op,'oh-my-opencode-slim.jsonc')))throw Error('Existing Slim config found. Back it up/remove it before using this controlled profile.');
 const pluginDir=path.join(op,'plugins');
 if(fs.existsSync(pluginDir)&&fs.readdirSync(pluginDir).some(f=>/\.(js|ts|mjs)$/.test(f)))throw Error('Existing auto-loaded plugins found. Use a clean approved project profile before init.');
 fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(path.join(runtime,'backups'),{recursive:true});
 fs.mkdirSync(path.join(op,'plugins'),{recursive:true});
 const backup=path.join(runtime,'backups',path.basename(target)+'.before-init');fs.writeFileSync(backup,raw,{mode:0o600});
 let out=raw;
 for(const [key,value] of Object.entries({default_agent:'jarvis',model:config.models.free.id,small_model:config.models.free.id,autoupdate:false,share:'disabled'}))out=applyEdits(out,modify(out,[key],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));
 // Standard Node Playwright MCP; preserve an existing company definition.
 for(const id of new Set(config.checks.filter(c=>c.type==='mcp').map(c=>c.mcpId)))if(id==='playwright'&&!parsed.mcp?.[id]) {
  out=applyEdits(out,modify(out,['mcp',id],{type:'local',command:playwrightCommand({origins:config.browserOrigins,outputDir:path.join(root,'artifacts','playwright')}),enabled:true},{formattingOptions:{insertSpaces:true,tabSize:2}}));
 }
 // Provider credentials and existing MCP definitions are preserved, never copied to the harness state.
 fs.writeFileSync(target,out,{mode:0o600});
 fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
 const agents={orchestrator:{model:config.models.free.id,mcps:[],skills:[]}};
 for(const name of ['oracle','explorer','librarian','designer','fixer'])agents[name]={model:config.models.free.id,mcps:[],skills:[]};
 const slim={agents,disabled_agents:['oracle','explorer','librarian','designer','fixer'],disabled_mcps:['context7','gh_grep'],disabled_tools:['acp_run','smart_fetch','apply_patch','marketplace'],disabled_hooks:['phase-reminder','foreground-fallback','deepwork-guard'],disabled_commands:['deepwork','interview','loop','reflect'],auto_update:false,fallback:{enabled:false},companion:{enabled:false},multiplexer:{type:'none'}};
 fs.writeFileSync(path.join(op,'oh-my-opencode-slim.json'),JSON.stringify(slim,null,2)+'\n');
 // A workspace unpacked from the delivery can be moved together with its source.
 const source=packageRoot===root?'../../src/plugin.mjs':pathToFileURL(path.join(packageRoot,'src','plugin.mjs')).href;
 const shim=`export { default } from ${JSON.stringify(source)};\n`;
 fs.writeFileSync(path.join(op,'plugins','team-harness.js'),shim);
 fs.writeFileSync(path.join(runtime,'installation.json'),JSON.stringify({workspace:root,configFile:target,backup,packageRoot,opencode:'1.18.34',slim:'3.0.2',created:new Date().toISOString()},null,2));
 return {workspace:root,configFile:target,harness:path.join(runtime,'config.json'),backup};
}
