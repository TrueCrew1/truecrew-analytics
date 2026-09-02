import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const CONFIG = {
  "repository": "TrueCrew1/truecrew-analytics",
  "product": "True Crew Analytics / Umami reference fork",
  "boundary": "Customer-product application logic, CRM/customer truth, Command Center workflow state, or independent analytics product roadmap divergence from upstream.",
  "productionBranch": "master",
  "canonicalNode": "24.19.0",
  "packageManager": "pnpm"
};
const args = new Set(process.argv.slice(2));
const allowDirty = args.has('--allow-dirty');
const allowProductionBranch = args.has('--allow-production-branch');
function run(command, commandArgs, allowFailure = false) {
  const r = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (r.status !== 0 && !allowFailure) throw new Error(`${command} ${commandArgs.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
}
const git = (a, allow=false) => run('git', a, allow);
const list = (v) => v ? v.split(/\r?\n/).filter(Boolean) : [];
const normalize = (v) => {
  const value = v.trim();
  const scp = value.match(/^(?:[^@\s]+@)?github\.com:([^\s?#]+)$/i);
  if (scp) return scp[1].replace(/\.git$/i, '');
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== 'github.com') return 'unrecognized-remote';
    return parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
  } catch {
    return 'unrecognized-remote';
  }
};
const root = git(['rev-parse','--show-toplevel']); process.chdir(root);
const remoteRepo = normalize(git(['remote','get-url','origin'], true));
const branch = git(['branch','--show-current'], true);
const head = git(['rev-parse','HEAD']);
const upstream = git(['rev-parse','--abbrev-ref','@{u}'], true);
const upstreamHead = upstream ? git(['rev-parse',upstream], true) : '';
const counts = upstream ? git(['rev-list','--left-right','--count',`${upstream}...HEAD`], true).split(/\s+/) : [];
const staged=list(git(['diff','--cached','--name-only'])), unstaged=list(git(['diff','--name-only'])), untracked=list(git(['ls-files','--others','--exclude-standard']));
const dirty=staged.length+unstaged.length+untracked.length>0;
const expectedBranch=process.env.TRUECREW_EXPECTED_BRANCH?.trim()||'', expectedHead=process.env.TRUECREW_EXPECTED_HEAD?.trim()||'', taskPacket=process.env.TRUECREW_TASK_PACKET?.trim()||'';
const blockers=[], warnings=[];
if(remoteRepo!==CONFIG.repository) blockers.push(`origin remote resolves to ${remoteRepo||'unknown'}, expected ${CONFIG.repository}`);
if(!branch) blockers.push('detached HEAD or unresolved branch');
if(branch===CONFIG.productionBranch&&!allowProductionBranch) blockers.push(`current branch is production branch ${CONFIG.productionBranch}; use an isolated branch/worktree for material mutation`);
if(process.versions.node!==CONFIG.canonicalNode) blockers.push(`Node ${process.versions.node} does not match canonical True Crew runtime ${CONFIG.canonicalNode}`);
if(dirty&&!allowDirty) blockers.push(`worktree is dirty (${staged.length} staged, ${unstaged.length} unstaged, ${untracked.length} untracked)`);
if(!taskPacket) blockers.push('TRUECREW_TASK_PACKET is required; material AI mutation must start from a current claimed True Crew HQ Engineering Task Packet');
if(expectedBranch&&branch!==expectedBranch) blockers.push(`branch ${branch||'detached'} does not match TRUECREW_EXPECTED_BRANCH=${expectedBranch}`);
if(expectedHead&&head!==expectedHead) blockers.push(`HEAD ${head} does not match TRUECREW_EXPECTED_HEAD=${expectedHead}`);
if(!upstream) warnings.push('no upstream branch is configured');
let packageState='not applicable';
const pkgPath=path.join(root,'package.json');
if(fs.existsSync(pkgPath)) {
 const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8')); const declared=pkg.packageManager||'not declared';
 if(CONFIG.packageManager){ const r=spawnSync(CONFIG.packageManager,['--version'],{encoding:'utf8'}); const actual=r.status===0?`${CONFIG.packageManager}@${r.stdout.trim()}`:`${CONFIG.packageManager}@unavailable`; packageState=`${actual} / ${declared}`; if(!pkg.packageManager) warnings.push('package.json does not declare packageManager'); else if(actual!==pkg.packageManager) warnings.push(`active package manager ${actual} differs from declared ${pkg.packageManager}`); }
}
const fmt=(xs)=>xs.length?xs.slice(0,30).map(x=>`  - ${x}`).join('\n'):'  - none';
const verdict=blockers.length?'BLOCKED':'PASS';
const content=`# AI Runtime Context\n\n> Generated locally by \`ai:preflight\` at ${new Date().toISOString()}. Do not commit this file. It is evidence, not authority.\n\n## Repository contract\n\n- Repository: \`${CONFIG.repository}\`\n- Product: ${CONFIG.product}\n- Boundary: ${CONFIG.boundary}\n- Production/default branch: \`${CONFIG.productionBranch}\`\n\n## Current Git/runtime state\n\n- Worktree: \`${root}\`\n- Branch: \`${branch||'DETACHED'}\`\n- HEAD: \`${head}\`\n- Upstream: \`${upstream||'none'}\`\n- Upstream HEAD: \`${upstreamHead||'unknown'}\`\n- Ahead / behind: \`${counts[1]||'unknown'} / ${counts[0]||'unknown'}\`\n- Origin: \`${remoteRepo||'unknown'}\`\n- Node actual / canonical: \`${process.versions.node} / ${CONFIG.canonicalNode}\`\n- Package manager actual / declared: \`${packageState}\`\n- Task packet: ${taskPacket||'MISSING'}\n- Expected branch: \`${expectedBranch||'not supplied'}\`\n- Expected HEAD: \`${expectedHead||'not supplied'}\`\n\n## Collision state\n\nStaged:\n${fmt(staged)}\n\nUnstaged:\n${fmt(unstaged)}\n\nUntracked:\n${fmt(untracked)}\n\n## Required AI read order\n\n1. current claimed True Crew HQ Engineering Task Packet (or a current Notion-derived snapshot supplied by a trusted orchestrator)\n2. \`AGENTS.md\`\n3. this generated \`.ai/runtime-context.md\`\n4. \`docs/ai/repo-context.md\`\n5. repository-specific/reference governance\n6. only then inspect or mutate files\n\n## Preflight verdict\n\n**${verdict}**\n\nBlockers:\n${fmt(blockers)}\n\nWarnings:\n${fmt(warnings)}\n\nThis snapshot never authorizes merge, deploy, production mutation, provider writes, billing, credential changes, destructive cleanup, or product reclassification.\n`;
fs.mkdirSync(path.join(root,'.ai'),{recursive:true}); fs.writeFileSync(path.join(root,'.ai','runtime-context.md'),content); console.log(content); if(blockers.length) process.exit(2);
