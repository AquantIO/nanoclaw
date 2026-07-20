/**
 * Delegation MCP tools (Aquant fork): delegate / end_delegation.
 *
 * The Router agent calls `delegate` to hand the current chat to a specialist
 * agent group (e.g. sre-agent, apps-agent). Subsequent messages on that chat
 * bypass the Router and go straight to the target until it calls
 * `end_delegation` (or a 2h idle timeout). Host-side logic lives in
 * src/modules/delegation/. Fire-and-forget — writes a system-action row.
 */
import { writeMessageOut } from '../db/messages-out.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

export const delegate: McpToolDefinition = {
  tool: {
    name: 'delegate',
    description:
      'Hand this conversation to a specialist agent group by its folder name (e.g. "sre-agent" for incidents/alerts/errors, "apps-agent" for app scaffolding/promotion). The target handles this and all following messages on this chat and replies to the user directly, until it ends the delegation. Pass the user\'s request in `message` so the target acts immediately. Fire-and-forget.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        targetFolder: {
          type: 'string',
          description: 'Target agent group folder, e.g. "sre-agent" or "apps-agent".',
        },
        message: {
          type: 'string',
          description: "The user's request to hand to the target agent so it can act immediately.",
        },
      },
      required: ['targetFolder'],
    },
  },
  async handler(args) {
    const targetFolder = args.targetFolder as string;
    if (!targetFolder) return err('targetFolder is required');
    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'delegate',
        targetFolder,
        message: (args.message as string) || null,
      }),
    });
    log(`delegate: ${requestId} → "${targetFolder}"`);
    return ok(`Delegated this conversation to "${targetFolder}". It will take over and reply to the user.`);
  },
};

export const endDelegation: McpToolDefinition = {
  tool: {
    name: 'end_delegation',
    description:
      'End the current delegation and hand control of this chat back to the Router. Call this when the task is complete or the user switches to an unrelated topic. Fire-and-forget.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  async handler() {
    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({ action: 'end_delegation' }),
    });
    log(`end_delegation: ${requestId}`);
    return ok('Delegation ended — control returns to the Router.');
  },
};

registerTools([delegate, endDelegation]);
