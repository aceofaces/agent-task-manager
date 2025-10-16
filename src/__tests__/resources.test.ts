import { describe, expect, it } from 'vitest';

import { listResources, listResourceTemplates, readResource } from '../resources.js';
import type { Config } from '../types.js';

const minimalConfig: Config = {
  linear: { apiKey: 'linear-key', teamId: 'team-1' },
  storageBackend: 'notion',
  notion: { apiKey: 'notion-key' },
  projects: {},
  defaultProject: undefined,
};

describe('example workflow resources', () => {
  it('lists example workflows alongside base resources', () => {
    const { resources } = listResources(minimalConfig);
    const uris = resources.map((resource) => resource.uri);

    expect(uris).toContain('examples://feature-launch-workflow');
    expect(uris).toContain('examples://incident-triage-loop');
  });

  it('exposes example workflows as templates for discovery tooling', () => {
    const { resourceTemplates } = listResourceTemplates();
    const templateUris = resourceTemplates.map((template) => template.uriTemplate);

    expect(templateUris).toContain('examples://feature-launch-workflow');
    expect(templateUris).toContain('examples://incident-triage-loop');
  });

  it('serves the example workflow markdown when read_resource is invoked', () => {
    const result = readResource('examples://feature-launch-workflow', minimalConfig);
    const [contents] = result.contents;

    expect(contents?.mimeType).toBe('text/markdown');
    expect(contents?.text).toContain('Add dark mode toggle');
    expect(contents?.text).toContain('update_task');
  });
});
