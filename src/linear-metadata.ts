import { LessonCategorySchema, type IssueMetadata, type Uncertainty } from './types.js';

const metadataDefaultEffort = 5;

export const METADATA_SEPARATOR = '---WORKFLOW-METADATA---';
export const METADATA_END = '---END-METADATA---';

export function buildDescriptionWithMetadata(
  plainDescription: string,
  metadata: IssueMetadata
): string {
  const lines: string[] = [
    METADATA_SEPARATOR,
    `**Goal:** ${metadata.goal || 'Not specified'}`,
    `**Effort:** ${metadata.effort}`,
  ];

  if (metadata.effortReason) {
    lines.push(`**Effort Reason:** ${metadata.effortReason}`);
  }

  if (metadata.complexityBias) {
    lines.push(`**Complexity Bias:** ${metadata.complexityBias}`);
  }

  lines.push('');
  lines.push('**Uncertainties:**');

  metadata.uncertainties.forEach((uncertainty) => {
    const resolved = Boolean(uncertainty.resolution);
    lines.push(`- [${resolved ? 'x' : ' '}] ${uncertainty.title}`);

    if (uncertainty.description) {
      lines.push(`  - Description: ${uncertainty.description}`);
    }

    if (uncertainty.resolution) {
      lines.push(`  - Resolution: ${uncertainty.resolution}`);
    }

    if (uncertainty.resolvedBy) {
      lines.push(`  - Resolved By: ${uncertainty.resolvedBy}`);
    }

    if (uncertainty.resolvedAt) {
      lines.push(`  - Resolved At: ${uncertainty.resolvedAt}`);
    }
  });

  lines.push('');
  lines.push('**Lessons Learned:**');

  metadata.lessonsLearned.forEach((lesson) => {
    const category = lesson.category ? `[${lesson.category}]` : '';
    lines.push(`- ${category} ${lesson.content}`);
  });

  lines.push(METADATA_END);

  return `${lines.join('\n')}\n\n${plainDescription}`;
}

export function parseMetadata(description: string): IssueMetadata {
  const metadata: IssueMetadata = {
    effort: metadataDefaultEffort,
    uncertainties: [],
    lessonsLearned: [],
  };

  const metadataMatch = description.match(
    new RegExp(`${METADATA_SEPARATOR}([\\s\\S]*?)${METADATA_END}`)
  );

  if (!metadataMatch) {
    return metadata;
  }

  const metadataText = metadataMatch[1];

  const goalMatch = metadataText.match(/\*\*Goal:\*\*\s*(.+)/);
  if (goalMatch && goalMatch[1] !== 'Not specified') {
    metadata.goal = goalMatch[1].trim();
  }

  const effortMatch = metadataText.match(/\*\*Effort:\*\*\s*(\d+)/);
  if (effortMatch) {
    metadata.effort = parseInt(effortMatch[1], 10);
  }

  const effortReasonMatch = metadataText.match(/\*\*Effort Reason:\*\*\s*(.+)/);
  if (effortReasonMatch) {
    const reason = effortReasonMatch[1].trim();
    if (reason) {
      metadata.effortReason = reason;
    }
  }

  const complexityBiasMatch = metadataText.match(/\*\*Complexity Bias:\*\*\s*(\w+)/);
  if (complexityBiasMatch) {
    metadata.complexityBias = complexityBiasMatch[1] as 'low' | 'medium' | 'high';
  }

  const uncertaintiesSection = metadataText.match(/\*\*Uncertainties:\*\*([\s\S]*?)(?=\*\*|$)/);
  if (uncertaintiesSection) {
    const lines = uncertaintiesSection[1].split('\n');
    let current: Uncertainty | null = null;
    let currentResolved = false;

    const flushCurrent = () => {
      if (current) {
        if (currentResolved && !current.resolution) {
          current.resolution = 'Resolved (no details provided)';
        }
        metadata.uncertainties.push(current);
      }
      current = null;
      currentResolved = false;
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }

      const bulletMatch = trimmed.match(/^- \[([ x])\]\s*(.+)$/);
      if (bulletMatch) {
        flushCurrent();
        current = {
          title: bulletMatch[2].trim(),
        };
        currentResolved = bulletMatch[1] === 'x';
        continue;
      }

      const detailMatch = rawLine.match(/^\s*-\s+(?!\[)(.*)$/);
      if (detailMatch && current) {
        const detail = detailMatch[1].trim();
        if (!detail) {
          continue;
        }

        if (/^Resolution:\s*/i.test(detail)) {
          current.resolution = detail.replace(/^Resolution:\s*/i, '').trim();
        } else if (/^Resolved By:\s*/i.test(detail)) {
          current.resolvedBy = detail.replace(/^Resolved By:\s*/i, '').trim();
        } else if (/^Resolved At:\s*/i.test(detail)) {
          current.resolvedAt = detail.replace(/^Resolved At:\s*/i, '').trim();
        } else if (/^Description:\s*/i.test(detail)) {
          current.description = detail.replace(/^Description:\s*/i, '').trim();
        } else {
          current.description = detail;
        }
      }
    }

    flushCurrent();
  }

  const lessonsSection = metadataText.match(/\*\*Lessons Learned:\*\*([\s\S]*?)(?=\*\*|$)/);
  if (lessonsSection) {
    const lessonLines = lessonsSection[1]
      .split('\n')
      .filter((line) => line.trim().startsWith('- '));

    for (const line of lessonLines) {
      const categoryMatch = line.match(/- \[(\w+)\]\s*(.+)/);
      if (categoryMatch) {
        const categoryValue = categoryMatch[1].trim();
        const contentValue = categoryMatch[2].trim();
        const parsedCategory = LessonCategorySchema.safeParse(categoryValue);

        if (parsedCategory.success) {
          metadata.lessonsLearned.push({
            content: contentValue,
            category: parsedCategory.data,
          });
        } else if (contentValue) {
          metadata.lessonsLearned.push({ content: contentValue });
        }
      } else {
        const content = line.replace(/^- /, '').trim();
        if (content) {
          metadata.lessonsLearned.push({ content });
        }
      }
    }
  }

  return metadata;
}

export function extractPlainDescription(description: string): string {
  return description.replace(new RegExp(`${METADATA_SEPARATOR}[\\s\\S]*?${METADATA_END}\\n\\n`), '').trim();
}
