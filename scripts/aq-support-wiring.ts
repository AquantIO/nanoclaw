/**
 * Aquant: manage support-agent channel wirings.
 *   tsx scripts/aq-support-wiring.ts disable   -> make them never engage
 *   tsx scripts/aq-support-wiring.ts status     -> show current wirings
 * (Re-enable with correct top-level-only semantics is done separately.)
 */
import path from 'path';
import { DATA_DIR } from '../src/config.js';
import { initDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';

const mode = process.argv[2] || 'status';
initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(getDb());

if (mode === 'disable') {
  const r = getDb()
    .prepare(
      `UPDATE messaging_group_agents
         SET engage_mode = 'pattern', engage_pattern = '__AQ_DISABLED_NO_MATCH__'
       WHERE agent_group_id IN (SELECT id FROM agent_groups WHERE folder = 'support-agent')`,
    )
    .run();
  console.log('support-agent wirings disabled:', r.changes);
}

const rows = getDb()
  .prepare(
    `SELECT ag.folder, mg.name, mg.platform_id, mga.engage_mode, mga.engage_pattern
       FROM messaging_group_agents mga
       JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
       JOIN agent_groups ag ON ag.id = mga.agent_group_id
      WHERE ag.folder = 'support-agent'`,
  )
  .all();
console.log(JSON.stringify(rows, null, 1));
