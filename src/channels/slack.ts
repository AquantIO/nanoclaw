/**
 * Slack channel adapter (Aquant fork) — Chat SDK bridge, MULTI-WORKSPACE.
 *
 * One Slack app installed in both the Aquant and GlobalDots workspaces, driven
 * over a single Socket Mode connection (SLACK_APP_TOKEN, xapp-…). Per-team bot
 * tokens are seeded into the adapter's installation store so `resolveTokenForTeam`
 * picks the right one for each inbound event's team_id — the v2-native equivalent
 * of v1's Bolt `authorize`. No public HTTPS endpoint (VPN-only VM).
 *
 * Env (from /opt/dev-automation/.env):
 *   SLACK_APP_TOKEN        xapp-…  (Socket Mode, covers all installed workspaces)
 *   SLACK_SIGNING_SECRET   optional in socket mode
 *   SLACK_BOT_TOKEN        xoxb-…  default workspace bot token (Aquant, T3ULRFJTG)
 *   SLACK_BOT_TOKEN_<TEAM> xoxb-…  additional per-workspace bot token
 *                                  (e.g. SLACK_BOT_TOKEN_T03RYFJUX = GlobalDots)
 *
 * Team ids for suffixed vars come from the suffix; the bare SLACK_BOT_TOKEN's
 * team id is resolved once at startup via auth.test.
 */
import fs from 'fs';
import path from 'path';

import { createSlackAdapter } from '@chat-adapter/slack';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';
import type { ThreadHistoryMessage } from './adapter.js';

/** Flatten a raw Slack message (text + attachments pretext/title/text/fields/fallback)
 *  into one text block. Mirrors the thread-root enrichment in
 *  patches/@chat-adapter__slack@4.29.0.patch so AlertManager payloads survive. */
export function flattenSlackMessageText(m: Record<string, unknown>): string {
  const atts = Array.isArray(m.attachments) ? (m.attachments as Array<Record<string, unknown>>) : [];
  const attText = atts
    .map((a) => {
      const fields = Array.isArray(a.fields)
        ? (a.fields as Array<{ title?: string; value?: string }>)
            .map((f) => [f.title, f.value].filter(Boolean).join(': '))
            .join('\n')
        : '';
      return [a.pretext, a.title, a.text, fields, a.fallback].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n');
  return [(m.text as string) || '', attText].filter(Boolean).join('\n').trim();
}

/** Collect every SLACK_BOT_TOKEN[_TEAMID] pair from .env. */
function collectBotTokens(): { defaultToken?: string; byTeam: Record<string, string> } {
  // readEnvFile only returns requested keys, so scan the raw file for the
  // dynamic SLACK_BOT_TOKEN_<TEAM> names first, then read their values.
  const byTeam: Record<string, string> = {};
  let defaultToken: string | undefined;
  let names: string[] = [];
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
    names = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^SLACK_BOT_TOKEN(_[A-Z0-9]+)?=/.test(l))
      .map((l) => l.slice(0, l.indexOf('=')));
  } catch {
    return { byTeam };
  }
  const vals = readEnvFile(names);
  for (const name of names) {
    const v = vals[name];
    if (!v) continue;
    if (name === 'SLACK_BOT_TOKEN') defaultToken = v;
    else byTeam[name.slice('SLACK_BOT_TOKEN_'.length)] = v;
  }
  return { defaultToken, byTeam };
}

async function resolveIdentity(botToken: string): Promise<{ teamId: string; botUserId?: string } | null> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = (await res.json()) as { ok?: boolean; team_id?: string; user_id?: string };
    return data.ok && data.team_id ? { teamId: data.team_id, botUserId: data.user_id } : null;
  } catch {
    return null;
  }
}

registerChannelAdapter('slack', {
  factory: () => {
    const env = readEnvFile(['SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']);
    const { defaultToken, byTeam } = collectBotTokens();
    if (!defaultToken && Object.keys(byTeam).length === 0) return null;

    const useSocketMode = Boolean(env.SLACK_APP_TOKEN);
    const teamCount = Object.keys(byTeam).length + (defaultToken ? 1 : 0);
    const multiWorkspace = teamCount > 1;

    const slackAdapter = createSlackAdapter({
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      // Single-workspace: pass the one bot token directly. Multi-workspace:
      // omit botToken and seed the installation store below.
      botToken: multiWorkspace ? undefined : (defaultToken ?? Object.values(byTeam)[0]),
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      mode: useSocketMode ? 'socket' : 'webhook',
    });

    // Seed per-team installations AFTER the adapter's chat.initialize() runs
    // (setInstallation throws "Adapter not initialized" until then). Retry on
    // that specific error; the bridge initializes on setup() shortly after the
    // factory returns, so a short poll wins the race for every workspace.
    if (multiWorkspace) {
      void (async () => {
        // Resolve each token's team_id AND bot user id (auth.test). The bot user
        // id is required so the adapter can recognize a plain message.channels
        // event whose text contains <@botUserId> as a mention (Slack sends both
        // a message + an app_mention event; the message arrives first and would
        // otherwise be dispatched as a non-mention).
        const seeds: Array<{ teamId: string; botToken: string; botUserId?: string }> = [];
        for (const [teamId, botToken] of Object.entries(byTeam)) {
          const id = await resolveIdentity(botToken);
          seeds.push({ teamId, botToken, botUserId: id?.botUserId });
        }
        if (defaultToken) {
          const id = await resolveIdentity(defaultToken);
          if (id) seeds.push({ teamId: id.teamId, botToken: defaultToken, botUserId: id.botUserId });
          else log.error('Could not resolve team_id for default SLACK_BOT_TOKEN — that workspace will not respond');
        }
        // Expose the seeded team ids so the adapter's channel-aware token
        // resolution (patched withToken / parse factory) can pick the workspace
        // token that actually owns a given channel — needed for Slack Connect
        // (externally-shared) channels, whose events arrive tagged with the
        // sender's team, not the channel-owning team.
        (slackAdapter as unknown as { __seededTeams: string[] }).__seededTeams = seeds.map((s) => s.teamId);
        for (const s of seeds) {
          let seeded = false;
          for (let attempt = 0; attempt < 60 && !seeded; attempt++) {
            try {
              await slackAdapter.setInstallation(s.teamId, { botToken: s.botToken, botUserId: s.botUserId });
              seeded = true;
              log.info('Slack installation seeded', { teamId: s.teamId, botUserId: s.botUserId });
            } catch (err) {
              const msg = (err as Error)?.message ?? '';
              if (msg.includes('not initialized')) {
                await new Promise((r) => setTimeout(r, 500));
              } else {
                log.error('Slack installation seed failed', { teamId: s.teamId, err });
                break;
              }
            }
          }
          if (!seeded) log.error('Slack installation seed timed out (adapter never initialized)', { teamId: s.teamId });
        }
      })();
    }

    // Recover the thread context predating a session-creating mid-thread
    // reply. platform ids look like "slack:C123", thread ids like
    // "slack:C123:1712.34" — channel and thread_ts are the last ':'
    // segments. withToken resolves the channel-owning workspace token,
    // which matters for Slack Connect (externally-shared) channels.
    const fetchThreadHistory = async (
      platformId: string,
      threadId: string,
      limit: number,
      excludeMessageId?: string,
    ) => {
      const channel = platformId.split(':').pop();
      const threadTs = threadId.split(':').pop();
      if (!channel || !threadTs) return [];
      const sa = slackAdapter as unknown as {
        client: {
          conversations: {
            replies(args: Record<string, unknown>): Promise<{
              ok?: boolean;
              has_more?: boolean;
              messages?: Array<Record<string, unknown>>;
            }>;
          };
        };
        withToken(o: Record<string, unknown>): Promise<Record<string, unknown>>;
        lookupUser?(id: string): Promise<{ displayName?: string } | null | undefined>;
      };
      const res = await sa.client.conversations.replies(await sa.withToken({ channel, ts: threadTs, limit }));
      if (!res || res.ok === false || !Array.isArray(res.messages)) return [];

      // Filter down to the messages we'll actually emit BEFORE resolving any
      // sender names — avoids wasting a lookup on a message we'll drop anyway.
      const kept = res.messages
        .map((m) => ({ m, ts: m.ts as string | undefined, text: flattenSlackMessageText(m) }))
        .filter(({ ts, text }) => ts && ts !== excludeMessageId && text);

      // Resolve every distinct sender in parallel rather than serially inside
      // the message loop — a thread with N distinct senders would otherwise
      // pay N sequential round-trips, stalling the container wake behind it.
      // Each lookup is individually try/caught so one bad id can't sink the
      // rest; falls back to the raw uid on failure or absence.
      const uids = [...new Set(kept.map(({ m }) => m.user as string | undefined).filter((u): u is string => !!u))];
      const names = new Map<string, string>(
        await Promise.all(
          uids.map(async (uid): Promise<[string, string]> => {
            try {
              return [uid, (await sa.lookupUser?.(uid))?.displayName ?? uid];
            } catch {
              return [uid, uid];
            }
          }),
        ),
      );

      const out: ThreadHistoryMessage[] = kept.map(({ m, ts, text }) => {
        const uid = m.user as string | undefined;
        const sender =
          (m.username as string) ||
          ((m.bot_profile as { name?: string } | undefined)?.name ?? '') ||
          (uid ? (names.get(uid) as string) : '') ||
          'unknown';
        return { sender, text, timestamp: ts };
      });
      if (res.has_more) {
        out.push({
          sender: 'system',
          text: `[thread has more than ${limit} messages — only the first ${limit} are included]`,
        });
      }
      return out;
    };

    const bridge = createChatSdkBridge({
      adapter: slackAdapter,
      concurrency: 'concurrent',
      supportsThreads: true,
      botToken: defaultToken ?? Object.values(byTeam)[0],
      fetchThreadHistory,
    });
    // Names a messaging group the first time an unknown channel registers
    // (channel-approval reads it). Best-effort: in multi-workspace mode the
    // lookup runs outside any request context and may have no token to use.
    bridge.resolveChannelName = async (platformId: string) => {
      try {
        const info = await slackAdapter.fetchThread(platformId);
        return (info as { channelName?: string }).channelName ?? null;
      } catch {
        return null;
      }
    };
    return bridge;
  },
});
