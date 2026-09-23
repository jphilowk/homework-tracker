import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const git = (...args) => execFileSync('git',args,{encoding:'utf8'});
const patterns = [
  /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{30,}/,
  /\b\d+~[A-Za-z0-9_-]{35,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[A-Z0-9]{16}/,
  /(?:token|password|api_key|client_secret)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{24,}["']/i,
];
let findings=0,history=0;
function check(content,label){if(patterns.some(pattern=>pattern.test(content))){console.error('Potential credential pattern in '+label);findings++;}}
const paths=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))];
for(const path of paths){
  if (/(^|\/)(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$))/.test(path)) {console.error('Secret file is not ignored: '+path);findings++;}
  if(existsSync(path))check(readFileSync(path,'utf8'),path);
}
for(const line of git('rev-list','--objects','--all').split('\n').filter(Boolean)) {
  const id=line.split(' ',1)[0];if(git('cat-file','-t',id).trim()!=='blob')continue;
  check(git('cat-file','blob',id),'historical blob '+id);history++;
}
check(git('remote','-v'),'Git remotes');
for(const path of ['backend/generated-assets.mjs','dist/worker.js'])if(existsSync(path))check(readFileSync(path,'utf8'),path);
console.log(`Credential-pattern audit: ${paths.length} working files, ${history} historical blobs, ${findings} findings. This complements manual diff review; it is not a guarantee.`);
process.exitCode=findings?1:0;
