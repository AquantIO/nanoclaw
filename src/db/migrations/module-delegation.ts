import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/**
 * Session delegation (Aquant fork): a temporary sticky binding of a chat to a
 * target agent group. The Router agent classifies intent then delegates the
 * conversation to Apps/SRE; subsequent inbound messages on that chat bypass the
 * normal fan-out (which would hit the Router) and go straight to the target,
 * until the target ends the delegation or it idles out (2h). Keyed by chat_key
 * = `${channel_type}:${instance}:${platform_id}` so it is instance-aware
 * (Aquant vs GlobalDots Slack instances stay independent).
 *
 * router_state is a small per-chat scratch table kept for parity with v1.
 */
export const moduleDelegation: Migration = {
  version: 100,
  name: 'delegation',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_delegations (
        chat_key              TEXT PRIMARY KEY,
        target_agent_group_id TEXT NOT NULL,
        origin_agent_group_id TEXT NOT NULL,
        messaging_group_id    TEXT NOT NULL,
        delegated_at          TEXT NOT NULL,
        delegated_by          TEXT NOT NULL,
        last_activity         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_delegations_activity
        ON session_delegations(last_activity);
      CREATE TABLE IF NOT EXISTS router_state (
        chat_key   TEXT PRIMARY KEY,
        state      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
