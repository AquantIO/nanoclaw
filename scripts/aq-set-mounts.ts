/**
 * Aquant test helper: set a group's container_config additional_mounts (+optional mcp_servers).
 * Usage: tsx scripts/aq-set-mounts.ts <folder>
 * Mounts the shared knowledge wiki read-only at /workspace/extra/wiki.
 */
import path from 'path';
import { DATA_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { ensureContainerConfig, updateContainerConfigJson } from '../src/db/container-configs.js';

const folder = process.argv[2];
if (!folder) {
  console.error('usage: tsx scripts/aq-set-mounts.ts <folder>');
  process.exit(2);
}
const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);
const ag = getAgentGroupByFolder(folder);
if (!ag) {
  console.error(`no agent group with folder ${folder}`);
  process.exit(1);
}
ensureContainerConfig(ag.id);
updateContainerConfigJson(ag.id, 'additional_mounts', [
  { hostPath: '/opt/dev-automation/wiki', containerPath: 'wiki', readonly: true },
]);
console.log(`wiki mount set for agent group ${ag.id} (${folder}) -> /workspace/extra/wiki (ro)`);
