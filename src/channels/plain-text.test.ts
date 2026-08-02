import { describe, it, expect } from 'vitest';
import { parseMarkdown } from 'chat';

import { astToPlainText } from './plain-text.js';

describe('astToPlainText', () => {
  it('keeps a blank line between top-level blocks', () => {
    // The 2026-08-02 regression: "Hi @Valerii" + a following block collapsed
    // to "Hi @ValeriiPR opened", which killed the `@Valerii\b` engage pattern.
    const ast = parseMarkdown('Hi @Valerii\n\n**PR opened**\n#1957 — cherry-pick');
    const text = astToPlainText(ast);

    expect(text).toBe('Hi @Valerii\n\nPR opened\n#1957 — cherry-pick');
    expect(/@Valerii\b/.test(text as string)).toBe(true);
  });

  it('puts each list item on its own line with its marker', () => {
    const ast = parseMarkdown('intro\n\n1. first item\n2. second item');

    expect(astToPlainText(ast)).toBe('intro\n\n1. first item\n2. second item');
  });

  it('honours an ordered list that does not start at 1', () => {
    const ast = parseMarkdown('3. third\n4. fourth');

    expect(astToPlainText(ast)).toBe('3. third\n4. fourth');
  });

  it('indents nested lists instead of gluing them to the parent item', () => {
    const ast = parseMarkdown('- outer\n  - inner');

    expect(astToPlainText(ast)).toBe('- outer\n  - inner');
  });

  it('preserves soft line breaks inside a paragraph', () => {
    const ast = parseMarkdown('line one\nline two');

    expect(astToPlainText(ast)).toBe('line one\nline two');
  });

  it('returns null for a missing, malformed or empty AST so the caller keeps the SDK text', () => {
    expect(astToPlainText(undefined)).toBeNull();
    expect(astToPlainText(null)).toBeNull();
    expect(astToPlainText('not an ast')).toBeNull();
    expect(astToPlainText({ type: 'paragraph', children: [] })).toBeNull();
    expect(astToPlainText({ type: 'root', children: [] })).toBeNull();
  });
});
