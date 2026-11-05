// Publish the CLI and local MCP server to npm, so `npx entitymodeler mcp` works from any folder.
//   npm run publish-npm                builds and tests the package, and publishes nothing
//   npm run publish-npm -- --publish   the same, then publishes it
// The package is generated rather than this repo's package.json: bin/em.mjs is one bundled file with no dependencies,
// and publishing the root manifest would make every `npx` install React and the rest of the app.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const publish = process.argv.includes('--publish');
const die = (msg) => (console.error(`publish-npm: ${msg}`), process.exit(1));
const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
execFileSync('npm', ['run', '-s', 'build:cli'], { cwd: root, stdio: 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'em-npm-'));
try {
  const pkg = join(work, 'package');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  const bundle = readFileSync(join(root, 'bin/em.mjs'), 'utf8');
  writeFileSync(join(pkg, 'bin/em.mjs'), bundle.startsWith('#!') ? bundle : `#!/usr/bin/env node\n${bundle}`);
  chmodSync(join(pkg, 'bin/em.mjs'), 0o755);
  copyFileSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));
  writeFileSync(
    join(pkg, 'README.md'),
    `# EntityModel.com CLI and MCP server

Design data models with Claude and other agents. Models are plain JSON files in a \`models/\` folder, and an agent's changes are proposals that you review.

\`\`\`bash
npx entitymodeler mcp                      # MCP server over stdio, using ./models
npx entitymodeler mcp --models-dir ~/data  # or another folder
npx entitymodeler --help                   # the CLI: validate, export SQL/DBML/dbt, diff, migrate…
\`\`\`

Add it to Claude Code:

\`\`\`bash
claude mcp add entity-modeler -- npx -y entitymodeler mcp
\`\`\`

Docs: https://entitymodel.com/docs/mcp-server/

For models in shared workspaces, connect your agent to \`https://entitymodel.com/mcp\` instead. No install is needed.
`,
  );
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        description: 'EntityModel.com: data modeling CLI and MCP server for Claude and other agents.',
        license: manifest.license,
        homepage: manifest.homepage,
        repository: manifest.repository,
        keywords: ['data-modeling', 'er-diagram', 'erd', 'mcp', 'model-context-protocol', 'dbt', 'ddl'],
        type: 'module',
        engines: manifest.engines,
        bin: { entitymodeler: 'bin/em.mjs', em: 'bin/em.mjs' },
        files: ['bin/em.mjs'],
      },
      null,
      2,
    ) + '\n',
  );

  // Test what would actually be published: the tarball, installed into an empty folder with no network and no repo around it.
  const tarball = join(work, npm(['pack', '--silent', '--pack-destination', work], pkg).split('\n').pop());
  const listed = JSON.parse(npm(['pack', '--dry-run', '--json'], pkg))[0];
  const paths = listed.files.map((f) => f.path).sort();
  console.log(`${manifest.name}@${manifest.version}: ${(listed.size / 1e6).toFixed(2)} MB, ${paths.join(', ')}`);
  if (paths.join() !== 'LICENSE,README.md,bin/em.mjs,package.json') die(`unexpected files in the package: ${paths.join(', ')}`);

  const trial = join(work, 'trial');
  mkdirSync(trial);
  writeFileSync(join(trial, 'package.json'), '{"private":true}');
  npm(['install', '--silent', '--no-audit', '--no-fund', '--offline', tarball], trial);
  const em = join(trial, 'node_modules/.bin/entitymodeler');
  const send = [
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_model', arguments: { title: 'Smoke Test' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'propose_changes', arguments: { model: 'smoke-test', title: 'Add', ops: [{ op: 'add_entity', entity: { name: 'customer' } }] } } },
  ].map((m) => JSON.stringify(m)).join('\n');
  const run = spawnSync(em, ['mcp'], { cwd: trial, input: `${send}\n`, encoding: 'utf8' });
  const replies = (run.stdout || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (run.status !== 0 || replies.length !== 3) die(`the installed server failed:\n${run.stderr}`);
  if (!replies[0].result?.supportedVersions?.length) die('server/discover gave no versions');
  if (replies[1].result?.isError || replies[2].result?.isError) die(`tool calls failed: ${JSON.stringify(replies.slice(1))}`);
  const ddl = spawnSync(em, ['export', 'smoke-test', '--format', 'sql', '--stdout'], { cwd: trial, encoding: 'utf8' });
  if (ddl.status !== 0) die(`the installed CLI failed:\n${ddl.stderr}`);
  console.log('The installed package works: discover, create_model, propose_changes, export.');

  if (!publish) {
    console.log('Nothing published. Run `npm run publish-npm -- --publish` to publish.');
  } else {
    const who = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
    if (who.status !== 0) die('not logged in to npm. Run `npm login`, then try again.');
    // --auth-type=web: an account with a security key approves in the browser, since it has no one-time code to type.
    const out = spawnSync('npm', ['publish', tarball, '--access', 'public', '--auth-type=web'], { encoding: 'utf8', stdio: 'inherit' });
    if (out.status !== 0) die('npm publish failed.');
    console.log(`Published ${manifest.name}@${manifest.version} as ${who.stdout.trim()}.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
