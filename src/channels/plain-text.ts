/**
 * Block-aware plain-text flattening for inbound Chat SDK messages.
 *
 * `Message.text` from the SDK is `FormatConverter.extractPlainText`, which is
 * `mdast-util-to-string` over the whole AST. That concatenates every text node
 * with NO separator, so block boundaries disappear:
 *
 *   Slack sends:  "Hi <@U01E3ACA8H0>\n\n*PR opened*\n#1957 …"
 *   SDK text:     "Hi @ValeriiPR opened\n#1957 …"          <-- glued
 *
 * This is not cosmetic. The router matches `engage_pattern` against this text,
 * and `@Valerii\b` stops matching the moment the next block's first word is
 * welded onto the mention — on 2026-08-02 a support request in
 * #aquant-globaldots-devops went unanswered for exactly that reason. It also
 * degrades every prompt the agent reads: paragraphs and list items run
 * together mid-sentence ("state OPEN.there was an issue…").
 *
 * `message.formatted` (the mdast Root) still carries the structure, so we
 * re-flatten from it: top-level blocks joined by a blank line, list items on
 * their own lines with their markers. Anything unexpected returns null and the
 * caller keeps the SDK's text — a worse prompt beats a dropped message.
 */
import { toPlainText } from 'chat';

/**
 * Structural subset of mdast we care about. Deliberately loose: `formatted`
 * arrives as plain JSON off the wire, so it is not guaranteed to satisfy the
 * real mdast types.
 */
interface AstNode {
  type?: unknown;
  children?: unknown;
  ordered?: unknown;
  start?: unknown;
}

function asNode(value: unknown): AstNode | null {
  return value !== null && typeof value === 'object' ? (value as AstNode) : null;
}

function childrenOf(node: AstNode): AstNode[] {
  if (!Array.isArray(node.children)) return [];
  return node.children.map(asNode).filter((n): n is AstNode => n !== null);
}

function isList(node: AstNode): boolean {
  return node.type === 'list';
}

/** Flatten a single block via the SDK's own stringifier, wrapped in a Root. */
function flattenBlock(node: AstNode): string {
  return toPlainText({ type: 'root', children: [node] } as never).trim();
}

/**
 * Lists need per-item handling — flattening the whole list at once is what
 * glues "…(explained in the PR)" onto "also, wasn't sure…".
 */
function renderList(node: AstNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const ordered = node.ordered === true;
  const start = typeof node.start === 'number' ? node.start : 1;

  return childrenOf(node)
    .map((item, index) => {
      const marker = ordered ? `${start + index}.` : '-';
      const body = childrenOf(item)
        .map((child) => (isList(child) ? renderList(child, depth + 1) : flattenBlock(child)))
        .filter((part) => part.length > 0)
        .join('\n');
      return `${indent}${marker} ${body}`;
    })
    .filter((line) => line.trim().length > 1)
    .join('\n');
}

/**
 * Re-derive plain text from an mdast Root with block separators preserved.
 * Returns null when the AST is missing, malformed or empty — callers fall back
 * to whatever text they already had.
 */
export function astToPlainText(formatted: unknown): string | null {
  const rootNode = asNode(formatted);
  if (!rootNode || rootNode.type !== 'root') return null;

  try {
    const blocks = childrenOf(rootNode)
      .map((node) => (isList(node) ? renderList(node, 0) : flattenBlock(node)))
      .filter((block) => block.length > 0);
    if (blocks.length === 0) return null;
    return blocks.join('\n\n');
  } catch {
    return null;
  }
}
