/** Aquant: finish v2 migration — per-group container_config (image, wiki mount, MCP, incidents). */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, GROUPS_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { getAllAgentGroups } from '../src/db/agent-groups.js';
import { ensureContainerConfig, updateContainerConfigScalars, updateContainerConfigJson } from '../src/db/container-configs.js';

const IMAGE = 'nanoclaw-agent:2.1.17';
const WIKI = { hostPath: '/opt/dev-automation/wiki', containerPath: 'wiki', readonly: true };
const INCIDENTS = { hostPath: '/opt/dev-automation/nanoclaw/groups/sre-agent/incidents', containerPath: 'incidents', readonly: false };
const REPOS = { hostPath: '/opt/repos', containerPath: 'repos', readonly: false };
const WIKI_GROUPS = new Set(['apps-agent', 'support-agent', 'sre-agent', 'prevention-agent']);

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

for (const ag of getAllAgentGroups()) {
  ensureContainerConfig(ag.id);
  updateContainerConfigScalars(ag.id, { image_tag: IMAGE, provider: 'claude' });
  const mounts: Array<{ hostPath: string; containerPath: string; readonly: boolean }> = [];
  if (WIKI_GROUPS.has(ag.folder)) mounts.push(WIKI);
  if (ag.folder === 'sre-agent' || ag.folder === 'prevention-agent') { mounts.push(INCIDENTS); mounts.push(REPOS); }
  if (mounts.length) updateContainerConfigJson(ag.id, 'additional_mounts', mounts);
  let mcpNote = 'none';
  const mcpFile = path.join(GROUPS_DIR, ag.folder, '.mcp.json');
  if (fs.existsSync(mcpFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(mcpFile, 'utf-8'));
      if (j.mcpServers && Object.keys(j.mcpServers).length) {
        updateContainerConfigJson(ag.id, 'mcp_servers', j.mcpServers);
        mcpNote = Object.keys(j.mcpServers).join(',');
      }
    } catch (e) {
      mcpNote = 'PARSE_FAIL:' + (e as Error).message;
    }
  }
  console.log(`${ag.folder}: image=${IMAGE} mounts=${mounts.map((m) => m.containerPath).join('+') || '-'} mcp=[${mcpNote}]`);
}
db.close();
