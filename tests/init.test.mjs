import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {init,defaults} from '../src/init.mjs';import {parse} from 'jsonc-parser';
function workspace(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'th-init-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
test('init preserves JSONC comments, provider credential references and internal MCP config',t=>{const dir=workspace(t);const raw='// existing company config\n{"provider":{"company":{"options":{"apiKey":"{env:COMPANY_KEY}"}}},"mcp":{"knowledge":{"type":"remote","url":"https://internal.invalid/mcp"}}}\n';fs.writeFileSync(path.join(dir,'opencode.jsonc'),raw);const result=init(dir,defaults(dir,'company/free'));const out=fs.readFileSync(result.configFile,'utf8'),config=parse(out);assert.ok(out.includes('// existing'));assert.equal(config.provider.company.options.apiKey,'{env:COMPANY_KEY}');assert.equal(config.mcp.knowledge.url,'https://internal.invalid/mcp');assert.equal(fs.readFileSync(result.backup,'utf8'),raw);assert.ok(fs.existsSync(path.join(dir,'.opencode/plugins/ccm.js')));assert.throws(()=>init(dir,defaults(dir)),/Already/);});
test('init refuses two orchestration profiles and ambiguous configs before changing files',t=>{const dir=workspace(t);fs.writeFileSync(path.join(dir,'opencode.json'),'{"plugin":["oh-my-opencode-slim@3.0.2"]}');assert.throws(()=>init(dir,defaults(dir)),/orchestration plugin/);assert.equal(fs.existsSync(path.join(dir,'.ccm')),false);fs.writeFileSync(path.join(dir,'opencode.jsonc'),'{}');assert.throws(()=>init(dir,defaults(dir)),/Multiple/);});
test('Playwright MCP init generates a direct Node command without Python or cmd wrappers',t=>{const dir=workspace(t),c=defaults(dir,'company/free');c.browserOrigins=['http://localhost:3000'];c.checks=[{id:'browser',type:'mcp',mcpId:'playwright',steps:[{tool:'browser_navigate',args:{url:'http://localhost:3000'},expectedPattern:'Page'}]}];const result=init(dir,c),config=parse(fs.readFileSync(result.configFile,'utf8'));assert.equal(config.mcp.servers.playwright.command[0],process.execPath);assert.ok(config.mcp.servers.playwright.command[1].endsWith(path.join('@playwright','mcp','cli.js')));assert.ok(config.mcp.servers.playwright.command.includes('--headless'));assert.ok(!config.mcp.servers.playwright.command.some(a=>/python|npx\.cmd/.test(a)));});
test('Jarvis startup profile coexists with company config and remains immutable after init',t=>{
 const dir=workspace(t),startup=path.join(dir,'.opencode/opencode.jsonc');fs.mkdirSync(path.dirname(startup),{recursive:true});
 const raw='// CCM startup\n{"default_agent":"jarvis","autoupdate":false,"share":"disabled"}\n';fs.writeFileSync(startup,raw);
 fs.writeFileSync(path.join(dir,'opencode.jsonc'),'{"provider":{"company":{"options":{"apiKey":"{env:COMPANY_KEY}"}}}}');
 const result=init(dir,defaults(dir,'company/free')),config=parse(fs.readFileSync(result.configFile,'utf8'));
 assert.equal(config.default_agent,'jarvis');assert.equal(config.provider.company.options.apiKey,'{env:COMPANY_KEY}');
 assert.equal(fs.readFileSync(startup,'utf8'),raw);
});
test('non-bootstrap project profile is never silently ignored',t=>{
 const dir=workspace(t);fs.mkdirSync(path.join(dir,'.opencode'));fs.writeFileSync(path.join(dir,'.opencode/opencode.jsonc'),'{"default_agent":"jarvis","autoupdate":false,"share":"disabled","model":"company/special"}');
 fs.writeFileSync(path.join(dir,'opencode.jsonc'),'{}');assert.throws(()=>init(dir,defaults(dir,'company/free')),/Multiple/);assert.equal(fs.existsSync(path.join(dir,'.ccm')),false);
});
test('official schema annotation does not turn the Jarvis bootstrap into an ambiguous profile',t=>{
 const dir=workspace(t);fs.mkdirSync(path.join(dir,'.opencode'));fs.writeFileSync(path.join(dir,'.opencode/opencode.jsonc'),'{"$schema":"https://opencode.ai/config.json","default_agent":"jarvis","autoupdate":false,"share":"disabled"}');fs.writeFileSync(path.join(dir,'opencode.jsonc'),'{}');assert.equal(init(dir,defaults(dir,'company/free')).configFile,path.join(dir,'opencode.jsonc'));
});


test('legacy state is preserved and cannot be silently initialized or replayed as V2',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ccm-legacy-'));
 try {fs.mkdirSync(path.join(root,'.team-harness'));fs.writeFileSync(path.join(root,'.team-harness/config.json'),'legacy');assert.throws(()=>init(root,defaults(root,'internal/free')),/Legacy/);assert.equal(fs.readFileSync(path.join(root,'.team-harness/config.json'),'utf8'),'legacy');assert.ok(!fs.existsSync(path.join(root,'.ccm/config.json')))}finally{fs.rmSync(root,{recursive:true,force:true})}
});
