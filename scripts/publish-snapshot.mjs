// Publish private main to the public repo as one new commit. The public repo never sees private history: each
// release is a single commit whose tree is private main's tree and whose parent is the last public commit.
// `npm run publish-snapshot` previews it; `npm run publish-snapshot -- --push [--message "…"]` publishes.
// Pushes are plain fast-forwards (never forced), after a secrets scan of exactly what goes public, and only
// outside Mon–Fri 08:00–18:00 local time (the commit is dated when it is made).
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const PUBLIC = 'https://github.com/ns-3e/entitymodeler.git';
const AUTHOR = { name: 'NS', email: '42181642+ns-3e@users.noreply.github.com' };
const SECRETS = 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_|sk-ant-[A-Za-z0-9-]{10,}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY|dapi[0-9a-f]{32}|AIza[0-9A-Za-z_-]{35}';
const RISKY_FILES = /(^|\/)\.env|\.dev\.vars|\.pem$|\.p12$|id_rsa|(^|\/)_archive\//i;

const args = process.argv.slice(2);
const push = args.includes('--push');
const message = args.includes('--message') ? args[args.indexOf('--message') + 1] : undefined;

const git = (a, env) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const die = (msg) => (console.error(`publish-snapshot: ${msg}`), process.exit(1));

// The source must be the private repo: pushing its main anywhere public would leak history.
const origin = git(['remote', 'get-url', 'origin']);
if (origin.replace(/\.git$/, '') === PUBLIC.replace(/\.git$/, '')) die(`origin is the public repo (${origin}); point it at the private one.`);

git(['fetch', '-q', 'origin', 'main']);
const tree = git(['rev-parse', 'origin/main^{tree}']);
const src = git(['rev-parse', '--short', 'origin/main']);
git(['fetch', '-q', PUBLIC, 'main']);
const parent = git(['rev-parse', 'FETCH_HEAD']);
const parentTree = git(['rev-parse', 'FETCH_HEAD^{tree}']);

if (tree === parentTree) {
  console.log(`Public main ${parent.slice(0, 7)} already matches private main ${src}. Nothing to publish.`);
  process.exit(0);
}

let hits = '';
try {
  hits = git(['grep', '-nIE', SECRETS, tree, '--', ':(exclude)scripts/publish-snapshot.mjs']); // its own patterns match
} catch {} // exit 1 = no matches
hits += git(['ls-tree', '-r', '--name-only', tree])
  .split('\n')
  .filter((f) => RISKY_FILES.test(f))
  .map((f) => `\nrisky file: ${f}`)
  .join('');
if (hits.trim()) die(`secrets scan hit, nothing published:\n${hits.trim()}`);

const stat = git(['diff', '--stat=100', parentTree, tree]);
const summary = stat.split('\n').pop().trim();
const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const body = message ?? `EntityModel.com release ${date}`;
console.log(`Private main ${src} → public main (on ${parent.slice(0, 7)})\n\n${stat}\n\nCommit message: ${body}\nSecrets scan clean.`);

if (!push) {
  console.log('\nPreview only. Run with --push to publish.');
  process.exit(0);
}

const now = new Date();
if (now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() >= 8 && now.getHours() < 18) die('publishes only outside Mon–Fri 08:00–18:00 local time; the preview above is what will go.');

const env = { GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email };
const commit = git(['commit-tree', tree, '-p', parent, '-m', body], env);
git(['push', '-q', PUBLIC, `${commit}:refs/heads/main`]);
console.log(`\nPublished ${commit.slice(0, 7)} to ${PUBLIC.replace(/\.git$/, '')} (${summary}).`);
