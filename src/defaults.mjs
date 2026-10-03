import fs from 'node:fs';
export function defaults(root,freeID='company/REPLACE_FREE_MODEL') {
 return {version:1,models:{free:{id:freeID,free:true}},roots:[fs.realpathSync(root)],mcpIds:[],protectedWriteRoots:[],requiredBuilderChecks:[],browserOrigins:[],
  budget:{monthUsd:1000,runUsd:10},
  limits:{maxNodes:20,maxAttempts:2,freeConcurrency:2,paidConcurrency:1,maxPaidNodes:2,runMinutes:120,maxPacketChars:24000,systemReserveTokens:12000,expertOutputTokens:4000,rootSteps:100,workerSteps:24},checks:[]};
}
