/** Aquant test: create a delegation TARGET group + bind the CLI chat to it. */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, GROUPS_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { createAgentGroup, getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { ensureContainerConfig, updateContainerConfigScalars, updateContainerConfigJson } from '../src/db/container-configs.js';
import { getAllMessagingGroups } from '../src/db/messaging-groups.js';
import { initGroupFilesystem } from '../src/group-init.js';
import { setDelegation } from '../src/modules/delegation/db/session-delegations.js';

initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(initDb(path.join(DATA_DIR, 'v2.db')) as any);

const folder = 'apps-test';
let ag = getAgentGroupByFolder(folder);
if (!ag) {
  const id = `ag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createAgentGroup({ id, name: 'AppsTest', folder, agent_provider: null, created_at: new Date().toISOString() });
  ag = getAgentGroupByFolder(folder)!;
}
initGroupFilesystem(ag, { provider: 'claude' });
const gd = path.resolve(GROUPS_DIR, folder);
fs.mkdirSync(gd, { recursive: true });
fs.writeFileSync(path.join(gd, 'CLAUDE.local.md'), '# AppsTest\nYou are the delegated Apps agent (test). Answer concisely and mention you are AppsTest.\n');
ensureContainerConfig(ag.id);
updateContainerConfigScalars(ag.id, { image_tag: 'nanoclaw-agent:2.1.17', provider: 'claude' });
updateContainerConfigJson(ag.id, 'additional_mounts', [{ hostPath: '/opt/dev-automation/wiki', containerPath: 'wiki', readonly: true }]);

const cliMg = getAllMessagingGroups().find((m) => m.channel_type === 'cli');
if (!cliMg) { console.error('no cli messaging group — run init-cli-agent first'); process.exit(1); }
const chatKey = `${cliMg.channel_type}:${cliMg.instance ?? cliMg.channel_type}:${cliMg.platform_id}`;
setDelegation({ chatKey, targetAgentGroupId: ag.id, originAgentGroupId: 'test-router', messagingGroupId: cliMg.id, delegatedBy: 'test' });
console.log(`target=${folder} (${ag.id})  chatKey=${chatKey}  mg=${cliMg.id}  DELEGATION SET`);
