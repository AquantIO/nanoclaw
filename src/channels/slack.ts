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

async function resolveTeamId(botToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = (await res.json()) as { ok?: boolean; team_id?: string };
    return data.ok && data.team_id ? data.team_id : null;
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
        const seeds: Array<{ teamId: string; botToken: string }> = Object.entries(byTeam).map(([teamId, botToken]) => ({
          teamId,
          botToken,
        }));
        if (defaultToken) {
          const teamId = await resolveTeamId(defaultToken);
          if (teamId) seeds.push({ teamId, botToken: defaultToken });
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
              await slackAdapter.setInstallation(s.teamId, { botToken: s.botToken });
              seeded = true;
              log.info('Slack installation seeded', { teamId: s.teamId });
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

    // Cast: @chat-adapter/slack@4.27.0 bundles chat@4.27.0 while core resolves
    // chat@4.26.0 — a transitive minor skew the sanctioned add-slack skill pins
    // away per-release. The adapter surface the bridge uses is unchanged.
    const bridge = createChatSdkBridge({
      adapter: slackAdapter as unknown as Parameters<typeof createChatSdkBridge>[0]['adapter'],
      concurrency: 'concurrent',
      supportsThreads: true,
      botToken: defaultToken ?? Object.values(byTeam)[0],
    });
    return bridge;
  },
});
