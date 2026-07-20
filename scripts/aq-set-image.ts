import path from 'path';
import { DATA_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { ensureContainerConfig, updateContainerConfigScalars } from '../src/db/container-configs.js';
const [folder, image] = process.argv.slice(2);
const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);
const ag = getAgentGroupByFolder(folder);
if (!ag) { console.error('no group', folder); process.exit(1); }
ensureContainerConfig(ag.id);
updateContainerConfigScalars(ag.id, { image_tag: image, provider: 'claude' });
console.log(`image_tag=${image} provider=claude set for ${folder} (${ag.id})`);
