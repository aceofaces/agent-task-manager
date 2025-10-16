import { describe, expect, it } from 'vitest';
import {
  buildDescriptionWithMetadata,
  parseMetadata,
} from '../linear-metadata.js';
import type { IssueMetadata } from '../types.js';

describe('Linear service metadata serialization', () => {
  it('round-trips uncertainty resolution details', () => {
    const metadata: IssueMetadata = {
      goal: 'Ship feature',
      effort: 5,
      effortReason: 'Team sized after spike',
      complexityBias: 'high',
      uncertainties: [
        {
          title: 'OAuth flow',
          description: 'Need to confirm PKCE',
          resolution: 'Decided on authorization code with PKCE',
          resolvedAt: '2024-01-02T03:04:05.000Z',
          resolvedBy: 'alice',
        },
      ],
      lessonsLearned: [
        {
          content: 'Document the OAuth redirect URI constraints',
          category: 'pattern',
        },
      ],
    };

    const serialized = buildDescriptionWithMetadata('Plain description', metadata);
    const parsed = parseMetadata(serialized);

    expect(parsed.goal).toBe('Ship feature');
    expect(parsed.effort).toBe(5);
    expect(parsed.effortReason).toBe('Team sized after spike');
    expect(parsed.complexityBias).toBe('high');
    expect(parsed.lessonsLearned).toEqual(metadata.lessonsLearned);
    expect(parsed.uncertainties).toHaveLength(1);
    expect(parsed.uncertainties[0]).toMatchObject({
      title: 'OAuth flow',
      description: 'Need to confirm PKCE',
      resolution: 'Decided on authorization code with PKCE',
      resolvedAt: '2024-01-02T03:04:05.000Z',
      resolvedBy: 'alice',
    });
  });

  it('parses legacy uncertainty formatting without losing data', () => {
    const legacy = [
      '---WORKFLOW-METADATA---',
      '**Goal:** Not specified',
      '**Effort:** 8',
      '',
      '**Uncertainties:**',
      '- [x] Legacy risk',
      '  - Resolution: Documented workaround',
      '- [ ] Pending risk',
      '  - Need more info',
      '',
      '**Lessons Learned:**',
      '- [pattern] Legacy lesson',
      '---END-METADATA---',
      '',
      'Plain body text',
    ].join('\n');

    const parsed = parseMetadata(legacy);

    expect(parsed.uncertainties).toHaveLength(2);
    expect(parsed.uncertainties[0]).toMatchObject({
      title: 'Legacy risk',
      resolution: 'Documented workaround',
    });
    expect(parsed.uncertainties[0].resolvedAt).toBeUndefined();
    expect(parsed.uncertainties[1]).toMatchObject({
      title: 'Pending risk',
      description: 'Need more info',
    });
  });
});
