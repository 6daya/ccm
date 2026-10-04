import path from 'node:path';

// Fixed, deliberately small filename policy. This is not a content scanner or OS sandbox.
export const sensitiveNames=['.env','.env.*','.npmrc','.netrc','.pypirc','.git-credentials',
 '.ssh','.aws','.azure','.kube','.gnupg','.docker','auth.json','credentials','credentials.json',
 'secrets.json','token.json','tokens.json','id_rsa','id_rsa.*','id_ed25519','id_ed25519.*',
 'id_ecdsa','id_ecdsa.*','id_dsa','id_dsa.*','*.key','*.pem','*.p12','*.pfx'];
const patterns=sensitiveNames.map(name=>new RegExp('^'+name.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i'));
export const sensitivePath=file=>file.split(path.sep).some(part=>patterns.some(pattern=>pattern.test(part)));
export const sensitiveSearchArgs=()=>sensitiveNames.flatMap(name=>['--iglob','!**/'+name,'--iglob','!**/'+name+'/**']);
