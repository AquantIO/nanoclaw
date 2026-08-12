/**
 * Session-delegation accessors (Aquant fork). Keyed by chat_key
 * (`${channel_type}:${instance}:${platform_id}`). Mirrors v1 db.ts delegation
 * functions on the v2 modular DB.
 */
import { getDb } from '../../../db/connection.js';

export interface Delegation {
  chatKey: string;
  targetAgentGroupId: string;
  originAgentGroupId: string;
  messagingGroupId: string;
  delegatedAt: string;
  delegatedBy: string;
  lastActivity: string;
}

interface Row {
  chat_key: string;
  target_agent_group_id: string;
  origin_agent_group_id: string;
  messaging_group_id: string;
  delegated_at: string;
  delegated_by: string;
  last_activity: string;
}

function toDelegation(r: Row): Delegation {
  return {
    chatKey: r.chat_key,
    targetAgentGroupId: r.target_agent_group_id,
    originAgentGroupId: r.origin_agent_group_id,
    messagingGroupId: r.messaging_group_id,
    delegatedAt: r.delegated_at,
    delegatedBy: r.delegated_by,
    lastActivity: r.last_activity,
  };
}

export function getDelegation(chatKey: string): Delegation | undefined {
  const row = getDb().prepare('SELECT * FROM session_delegations WHERE chat_key = ?').get(chatKey) as Row | undefined;
  return row ? toDelegation(row) : undefined;
}

export function setDelegation(args: {
  chatKey: string;
  targetAgentGroupId: string;
  originAgentGroupId: string;
  messagingGroupId: string;
  delegatedBy: string;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO session_delegations
         (chat_key, target_agent_group_id, origin_agent_group_id, messaging_group_id, delegated_at, delegated_by, last_activity)
       VALUES (@chat_key, @target_agent_group_id, @origin_agent_group_id, @messaging_group_id, @delegated_at, @delegated_by, @last_activity)`,
    )
    .run({
      chat_key: args.chatKey,
      target_agent_group_id: args.targetAgentGroupId,
      origin_agent_group_id: args.originAgentGroupId,
      messaging_group_id: args.messagingGroupId,
      delegated_at: now,
      delegated_by: args.delegatedBy,
      last_activity: now,
    });
}

/** Keep a delegation alive on each inbound message. */
export function touchDelegation(chatKey: string): void {
  getDb()
    .prepare('UPDATE session_delegations SET last_activity = ? WHERE chat_key = ?')
    .run(new Date().toISOString(), chatKey);
}

export function deleteDelegation(chatKey: string): void {
  getDb().prepare('DELETE FROM session_delegations WHERE chat_key = ?').run(chatKey);
}

/** Remove delegations idle longer than maxIdleMs. Returns the expired rows. */
export function expireStaleDelegations(maxIdleMs: number): Delegation[] {
  const cutoff = new Date(Date.now() - maxIdleMs).toISOString();
  const db = getDb();
  const stale = db.prepare('SELECT * FROM session_delegations WHERE last_activity < ?').all(cutoff) as Row[];
  if (stale.length > 0) {
    db.prepare('DELETE FROM session_delegations WHERE last_activity < ?').run(cutoff);
  }
  return stale.map(toDelegation);
}
