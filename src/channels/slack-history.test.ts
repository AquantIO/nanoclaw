import { describe, expect, it } from 'vitest';
import { flattenSlackMessageText } from './slack.js';

describe('flattenSlackMessageText', () => {
  it('returns plain text unchanged', () => {
    expect(flattenSlackMessageText({ text: 'hello' })).toBe('hello');
  });
  it('flattens AlertManager-style attachments with fields', () => {
    const m = {
      text: '',
      attachments: [
        {
          pretext: 'FIRING',
          title: 'KubePodCrashLooping',
          text: 'pod web-1 crashlooping',
          fields: [{ title: 'namespace', value: 'scop' }],
          fallback: 'fb',
        },
      ],
    };
    expect(flattenSlackMessageText(m)).toBe('FIRING\nKubePodCrashLooping\npod web-1 crashlooping\nnamespace: scop\nfb');
  });
  it('joins message text with attachment text', () => {
    expect(flattenSlackMessageText({ text: 'top', attachments: [{ title: 'att' }] })).toBe('top\natt');
  });
});
