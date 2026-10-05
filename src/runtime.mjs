export const testedOpenCode='2.0.23';
export function normalizeVersion(value){return /(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/.exec(value||'')?.[1]||null}
export function requireV2(value){const version=normalizeVersion(value);if(!version?.startsWith('2.'))throw Error('CCM 0.3 requires OpenCode V2; received '+(value||'unknown'));return version}
