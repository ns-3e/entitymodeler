#!/usr/bin/env node
// Block an abusive account, or lift the block. Run from cloud/:
//   npm run suspend -- someone@example.com [--lift] [--local]
// Suspending signs them out and stops them signing in again. Their workspaces stay available to other members.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run suspend -- someone@example.com [--lift] [--local]');
  process.exit(1);
}
const quoted = `'${email.replaceAll("'", "''")}'`;
const lift = args.includes('--lift');
const command = lift
  ? `UPDATE users SET suspended_at = NULL WHERE email = ${quoted}`
  : `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${quoted}); UPDATE users SET suspended_at = '${new Date().toISOString()}' WHERE email = ${quoted}`;
const where = args.includes('--local') ? '--local' : '--remote';
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'entitymodel-cloud', where, '--yes', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
if (!sql(`SELECT id FROM users WHERE email = ${quoted}`)[0].results.length) {
  console.error(`No account has the email ${email}.`);
  process.exit(1);
}
sql(command);
console.log(lift ? `Lifted the suspension of ${email}.` : `Suspended ${email} and signed them out. A model they already have open keeps receiving updates until the page closes.`);
