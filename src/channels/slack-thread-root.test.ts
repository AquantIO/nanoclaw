import { describe, expect, it } from 'vitest';
import { createSlackAdapter } from '@chat-adapter/slack';

/**
 * The Aquant patch to @chat-adapter/slack prepends the thread-root message
 * into every thread reply's text ("[Alert / thread root message you were
 * asked about] ..."). When the ROOT itself mentions the bot (every
 * support-agent thread starts with "@AppsBot ..."), the un-defanged
 * "<@UBOT>" token used to ride into message.text, where chat-core
 * detectMention() plain-text matching classified EVERY reply in the thread
 * as a bot mention — so conversational wirings answered un-addressed
 * replies (support channel, 2026-08-19).
 *
 * The patch must defang the bot's own mention in the PREPENDED root text
 * (bare display name, no @, no id) while leaving the reply portion intact
 * so genuine in-thread mentions still engage.
 */

const BOT_ID = 'UBOT123';

interface TestAdapter {
  parseSlackMessage(
    event: Record<string, unknown>,
    threadId: string,
    options?: Record<string, unknown>,
  ): Promise<{ text: string }>;
  lookupUser(id: string): Promise<{ displayName?: string; realName?: string } | null>;
  _client: Record<string, unknown>;
}

function makeAdapter(rootText: string): TestAdapter {
  const adapter = createSlackAdapter({
    botToken: 'xoxb-test',
    signingSecret: 'test-secret',
    mode: 'webhook',
    botUserId: BOT_ID,
    userName: 'AppsBot',
  }) as unknown as TestAdapter;

  // Stub the Slack Web API: conversations.history returns the thread root.
  (adapter as unknown as { _client: unknown })._client = {
    conversations: {
      history: async () => ({ ok: true, messages: [{ ts: '100.000', text: rootText }] }),
    },
  };
  // Stub user lookups so no network is attempted.
  adapter.lookupUser = async (id: string) =>
    id === BOT_ID ? { displayName: 'AppsBot', realName: 'AppsBot' } : { displayName: `user-${id}`, realName: `user-${id}` };
  return adapter;
}

function replyEvent(text: string): Record<string, unknown> {
  return {
    type: 'message',
    channel: 'C123',
    ts: '200.000',
    thread_ts: '100.000',
    text,
    user: 'UHUMAN1',
    username: 'hagay',
  };
}

describe('thread-root context enrichment (Aquant patch)', () => {
  it('prepends root context but defangs the bot mention inside it', async () => {
    const adapter = makeAdapter(`<@${BOT_ID}> please check how many instances are running`);
    const msg = await adapter.parseSlackMessage(replyEvent('we will need to increase it'), 'slack:C123:100.000');

    // Root context still present for the agent...
    expect(msg.text).toContain('please check how many instances');
    // ...but no form of the bot's own mention survives in the flattened text.
    // detectMention() matches "@<id>\b", "<@!?<id>>" and "@<userName>\b".
    expect(msg.text).not.toContain(`@${BOT_ID}`);
    expect(msg.text).not.toContain(`<@${BOT_ID}>`);
    expect(msg.text).not.toMatch(/@AppsBot\b/i);
  });

  it('keeps a genuine bot mention in the reply portion intact', async () => {
    const adapter = makeAdapter(`<@${BOT_ID}> please check how many instances are running`);
    const msg = await adapter.parseSlackMessage(
      replyEvent(`<@${BOT_ID}> also check staging please`),
      'slack:C123:100.000',
    );

    // The reply's own bot mention must survive so mention detection still fires.
    expect(msg.text).toMatch(new RegExp(`@${BOT_ID}\\b`));
  });

  it('leaves other users’ mentions in the root alone', async () => {
    const adapter = makeAdapter(`<@UHUMAN2> can you look at this? cc <@${BOT_ID}>`);
    const msg = await adapter.parseSlackMessage(replyEvent('sure'), 'slack:C123:100.000');

    expect(msg.text).toContain('user-UHUMAN2');
    expect(msg.text).not.toContain(`@${BOT_ID}`);
  });
});
