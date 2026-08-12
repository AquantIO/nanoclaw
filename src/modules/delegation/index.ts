/**
 * Session-delegation module (Aquant fork).
 *
 * Ports v1's Router→Apps/SRE conversation delegation onto v2 seams:
 *   - A pre-route message interceptor (setMessageInterceptor): when a chat has
 *     an active delegation, the inbound message is written straight into the
 *     TARGET agent group's session and the container is woken — bypassing the
 *     normal fan-out that would otherwise hand it to the Router. Returns true
 *     to consume the event.
 *   - `delegate` delivery action: the Router agent emits it to bind the current
 *     chat to a target agent group (by folder), optionally replaying the user's
 *     request so the target handles it immediately.
 *   - `end_delegation` delivery action: the target agent emits it to release the
 *     chat back to the Router.
 *   - An idle sweep expires delegations idle > 2h.
 *
 * Keyed by chat_key = `${channelType}:${instance}:${platformId}` — instance
 * aware, so Aquant and GlobalDots Slack instances stay independent.
 */
import { registerDeliveryAction } from '../../delivery.js';
import { registerMessageInterceptor } from '../../router.js';
import { unguarded } from '../../guard/index.js';
import { getAgentGroup, getAgentGroupByFolder } from '../../db/agent-groups.js';
import { getMessagingGroup } from '../../db/messaging-groups.js';
import { getSession, getSessionsByAgentGroup } from '../../db/sessions.js';
import { getDb, hasTable } from '../../db/connection.js';
import { resolveSession, writeSessionMessage } from '../../session-manager.js';
import { wakeContainer } from '../../container-runner.js';
import { log } from '../../log.js';
import type { InboundEvent } from '../../channels/adapter.js';
import type { MessagingGroup } from '../../types.js';
import {
  createDestination,
  deleteDestination,
  getDestinationByTarget,
  normalizeName,
} from '../agent-to-agent/db/agent-destinations.js';
import { writeDestinations } from '../agent-to-agent/write-destinations.js';
import {
  deleteDelegation,
  expireStaleDelegations,
  getDelegation,
  setDelegation,
  touchDelegation,
} from './db/session-delegations.js';

const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h, matches v1

function chatKey(channelType: string, instance: string | undefined, platformId: string): string {
  return `${channelType}:${instance ?? channelType}:${platformId}`;
}

function chatKeyForMg(mg: MessagingGroup): string {
  return chatKey(mg.channel_type, mg.instance ?? undefined, mg.platform_id);
}

function newMsgId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delegatedDestName(mg: MessagingGroup): string {
  return `dlg-${normalizeName(`${mg.channel_type}-${mg.platform_id}`)}`;
}

/**
 * Grant the delegated target a channel destination for the chat so its replies
 * route back (projected into the session's inbound.db by writeDestinations on
 * the next wake). Idempotent. No-op without the agent-to-agent module.
 */
function ensureChannelDestination(targetAgentGroupId: string, mg: MessagingGroup): void {
  if (!hasTable(getDb(), 'agent_destinations')) return;
  if (getDestinationByTarget(targetAgentGroupId, 'channel', mg.id)) return;
  createDestination({
    agent_group_id: targetAgentGroupId,
    local_name: delegatedDestName(mg),
    target_type: 'channel',
    target_id: mg.id,
    created_at: new Date().toISOString(),
  });
}

/** Revoke the delegated channel destination and propagate to any live session. */
function removeChannelDestination(targetAgentGroupId: string, mg: MessagingGroup): void {
  if (!hasTable(getDb(), 'agent_destinations')) return;
  const existing = getDestinationByTarget(targetAgentGroupId, 'channel', mg.id);
  if (!existing) return;
  deleteDestination(targetAgentGroupId, existing.local_name);
  // Propagate the revocation to any running container (destination-projection invariant).
  for (const s of getSessionsByAgentGroup(targetAgentGroupId)) writeDestinations(targetAgentGroupId, s.id);
}

/**
 * Write a chat message into a target agent group's session and wake it.
 * Mirrors the core of router.ts::deliverToAgent for the delegated path.
 */
async function deliverToTarget(
  targetAgentGroupId: string,
  messagingGroupId: string,
  threadId: string | null,
  msg: { id: string; kind: string; timestamp: string; channelType: string; platformId: string; content: string },
): Promise<void> {
  const { session } = resolveSession(targetAgentGroupId, messagingGroupId, threadId, 'shared');
  writeSessionMessage(session.agent_group_id, session.id, {
    id: msg.id,
    kind: msg.kind,
    timestamp: msg.timestamp,
    platformId: msg.platformId,
    channelType: msg.channelType,
    threadId,
    content: msg.content,
  });
  const fresh = getSession(session.id);
  if (fresh) await wakeContainer(fresh);
}

// --- Pre-route interceptor: hijack delegated chats before fan-out. ---
registerMessageInterceptor(async (event: InboundEvent): Promise<boolean> => {
  if (!hasTable(getDb(), 'session_delegations')) return false;
  const key = chatKey(event.channelType, event.instance, event.platformId);
  const del = getDelegation(key);
  if (!del) return false; // not delegated → normal routing (Router)

  const target = getAgentGroup(del.targetAgentGroupId);
  if (!target) {
    // Target vanished — drop the stale delegation and let the Router handle it.
    deleteDelegation(key);
    return false;
  }
  touchDelegation(key);
  const mg = getMessagingGroup(del.messagingGroupId);
  if (mg) ensureChannelDestination(target.id, mg);
  try {
    await deliverToTarget(target.id, del.messagingGroupId, event.threadId, {
      id: newMsgId('dlg'),
      kind: event.message.kind,
      timestamp: event.message.timestamp,
      channelType: event.channelType,
      platformId: event.platformId,
      content: event.message.content,
    });
    log.info('Delegated inbound routed', { chatKey: key, target: target.folder });
  } catch (err) {
    log.error('Delegated delivery failed — falling back to normal routing', { chatKey: key, err });
    return false;
  }
  return true; // consumed
});

// --- `delegate`: Router binds the current chat to a target agent group. ---
registerDeliveryAction(
  'delegate',
  async (content, session) => {
    const targetFolder = String(content.targetFolder ?? content.target ?? '').trim();
    if (!targetFolder) {
      log.warn('delegate failed: targetFolder missing', { agentGroup: session.agent_group_id });
      return;
    }
    const target = getAgentGroupByFolder(targetFolder);
    if (!target) {
      log.warn('delegate failed: unknown target folder', { targetFolder, agentGroup: session.agent_group_id });
      return;
    }
    if (!session.messaging_group_id) {
      log.warn('delegate failed: emitting session has no messaging group', { agentGroup: session.agent_group_id });
      return;
    }
    const mg = getMessagingGroup(session.messaging_group_id);
    if (!mg) {
      log.warn('delegate failed: messaging group not found', { mgId: session.messaging_group_id });
      return;
    }
    const key = chatKeyForMg(mg);
    setDelegation({
      chatKey: key,
      targetAgentGroupId: target.id,
      originAgentGroupId: session.agent_group_id,
      messagingGroupId: mg.id,
      delegatedBy: session.agent_group_id,
    });
    ensureChannelDestination(target.id, mg);
    log.info('Delegation set', { chatKey: key, target: target.folder, origin: session.agent_group_id });

    // Optional replay: hand the user's request straight to the target so it acts
    // immediately instead of waiting for the next inbound message.
    const replay = typeof content.message === 'string' ? content.message : null;
    if (replay) {
      try {
        await deliverToTarget(target.id, mg.id, null, {
          id: newMsgId('dlg-replay'),
          kind: 'chat',
          timestamp: new Date().toISOString(),
          channelType: mg.channel_type,
          platformId: mg.platform_id,
          content: JSON.stringify({ text: replay }),
        });
        log.info('Delegation replay forwarded', { chatKey: key, target: target.folder });
      } catch (err) {
        log.error('Delegation replay failed', { chatKey: key, err });
      }
    }
  },
  unguarded(
    'internal routing bookkeeping — binds an already-wired chat to a specialist agent group; no external side effect',
  ),
);

// --- `end_delegation`: target releases the chat back to the Router. ---
registerDeliveryAction(
  'end_delegation',
  async (_content, session) => {
    if (!session.messaging_group_id) return;
    const mg = getMessagingGroup(session.messaging_group_id);
    if (!mg) return;
    const key = chatKeyForMg(mg);
    const del = getDelegation(key);
    deleteDelegation(key);
    if (del) removeChannelDestination(del.targetAgentGroupId, mg);
    log.info('Delegation ended', { chatKey: key, by: session.agent_group_id });
  },
  unguarded('internal routing bookkeeping — releases a chat back to the Router; no external side effect'),
);

// --- Idle sweep: expire delegations idle beyond the timeout. ---
setInterval(() => {
  try {
    if (!hasTable(getDb(), 'session_delegations')) return;
    const expired = expireStaleDelegations(IDLE_TIMEOUT_MS);
    for (const del of expired) {
      const mg = getMessagingGroup(del.messagingGroupId);
      if (mg) removeChannelDestination(del.targetAgentGroupId, mg);
      log.info('Delegation expired (idle timeout)', { chatKey: del.chatKey });
    }
  } catch (err) {
    log.warn('Delegation idle sweep failed', { err });
  }
}, 60_000).unref?.();
