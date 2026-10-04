import path from 'node:path';
import {repositoryContext,inspectRepository} from './projects.mjs';
import {sensitiveNames} from './sensitive-paths.mjs';
// Explicit registered projects only. No recursive scan and no inferred scripts run.
export function describeWorkspace(engine) {
 const c=engine.config,projects=engine.projects();
 return {layout:c.layout||'legacy',consoleRoot:engine.directory,businessRoot:c.layout==='ccm-workspace'?path.join(engine.directory,'workspace'):null,
  models:c.models,budget:c.budget,projects:projects.map(p=>({id:p.id,name:p.name||p.id,roots:p.roots,repositories:p.roots.map(root=>({root,...inspectRepository(root)})),requiredBuilderChecks:p.requiredBuilderChecks||[],registeredChecks:p.checkIds||[],coding:'Requires explicit builder file scope and registered checks; environment/check success must be observed, not inferred.'})),
  ...(projects.length===1?{context:repositoryContext(engine,projects[0])}:{}),
  mcpIds:c.mcpIds,protectedWriteRoots:c.protectedWriteRoots||[],checks:c.checks,browserOrigins:c.browserOrigins||[],
  sensitiveNames,archiveRoot:path.join(engine.dir,'archive'),delivery:'Business code/docs stay in their repository; successful runs automatically export a private report.md and manifest.json, no extra model calls.',
  maintenance:'Project registration is a separate approval-gated tool, blocked during active runs. Models, budgets and existing checks cannot be changed by registration.',
  businessAgent:'jarvis',configurationFile:path.join(engine.dir,'config.json'),nativeRepositoryContext:'OpenCode native Git/LSP remains at CCM; harness_repository and check cwd explicitly target the selected business repositories.'};
}
