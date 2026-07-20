/** Aquant: fix Slack group-channel engage modes — bot @mention (mention-sticky), not literal text. */
import path from 'path';
import { DATA_DIR } from '../src/config.js';
import { initDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

// SRE agent group channels: user @mentions the bot ("@AppsBot please investigate").
// Switch from literal-text pattern to native platform mention (sticky keeps the
// agent engaged in the alert thread without re-mentioning).
const upd = getDb().prepare(`
  UPDATE messaging_group_agents
     SET engage_mode = 'mention-sticky', engage_pattern = NULL
   WHERE agent_group_id IN (SELECT id FROM agent_groups WHERE folder = 'sre-agent')
     AND messaging_group_id IN (SELECT id FROM messaging_groups WHERE channel_type = 'slack' AND is_group = 1)
`).run();
console.log(`sre-agent slack channels set to mention-sticky: ${upd.changes} wiring(s)`);

// Report the resulting Slack wirings for review.
const rows = getDb().prepare(`
  SELECT ag.folder, mg.name, mg.platform_id, mga.engage_mode, mga.engage_pattern
    FROM messaging_group_agents mga
    JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
    JOIN agent_groups ag ON ag.id = mga.agent_group_id
   WHERE mg.channel_type = 'slack'
   ORDER BY ag.folder
`).all() as Array<{ folder: string; name: string; platform_id: string; engage_mode: string; engage_pattern: string | null }>;
console.log('--- slack wirings now ---');
for (const r of rows) console.log(`  ${r.folder} <- ${r.platform_id} (${r.name}) [${r.engage_mode}${r.engage_pattern ? ' /' + r.engage_pattern + '/' : ''}]`);
db.close();
