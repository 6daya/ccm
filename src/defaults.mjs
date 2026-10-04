import fs from 'node:fs';
import path from 'node:path';
import {discoverRepositories} from './projects.mjs';
export function defaults(root,freeID='company/REPLACE_FREE_MODEL') {
 const directory=fs.realpathSync(root);let ccm=false;try{ccm=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name==='ccm'}catch{}
 const projects=ccm?discoverRepositories(directory).repositories.filter(repo=>repo.ready).map(repo=>({id:repo.id,name:repo.id,roots:[repo.root],checkIds:[],requiredBuilderChecks:[]})):null;
 return {version:1,...ccm?{layout:'ccm-workspace',projects}:{},models:{free:{id:freeID,free:true}},roots:ccm?[]:[directory],mcpIds:[],protectedWriteRoots:[],requiredBuilderChecks:[],browserOrigins:[],
  budget:{monthUsd:1000,runUsd:10},
  limits:{maxNodes:20,maxAttempts:2,freeConcurrency:2,paidConcurrency:1,maxPaidNodes:2,runMinutes:120,maxPacketChars:24000,systemReserveTokens:12000,expertOutputTokens:4000,rootSteps:100,workerSteps:24},checks:[]};
}
