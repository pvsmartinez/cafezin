import { describe, it, expect } from 'vitest';
import { restoreProseTaskMarkers } from '../utils/proseMarkdown';

describe('restoreProseTaskMarkers', () => {
  it('unescapes checked and unchecked task markers', () => {
    const md = '- \\[x\\] Done\n- \\[ \\] Todo\n  * \\[X\\] Nested\n1. \\[ \\] Numbered';
    expect(restoreProseTaskMarkers(md)).toBe('- [x] Done\n- [ ] Todo\n  * [X] Nested\n1. [ ] Numbered');
  });

  it('keeps escaped brackets outside list markers', () => {
    const md = 'Text \\[x\\] here\n- item \\[x\\]';
    expect(restoreProseTaskMarkers(md)).toBe(md);
  });
});
