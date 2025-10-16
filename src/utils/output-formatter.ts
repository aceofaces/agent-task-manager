/**
 * Output formatting utilities for task display
 */

import type { Task } from '../types.js';

export type OutputMode = 'compact' | 'standard' | 'detailed';

/**
 * Format tasks based on output mode
 */
export function formatTaskOutput(tasks: Task[], mode: OutputMode = 'standard'): string {
  if (tasks.length === 0) {
    return 'No tasks found.';
  }

  switch (mode) {
    case 'compact':
      return formatCompact(tasks);
    case 'standard':
      return formatStandard(tasks);
    case 'detailed':
      return formatDetailed(tasks);
    default:
      return formatStandard(tasks);
  }
}

/**
 * Compact format: Just ID and title
 */
function formatCompact(tasks: Task[]): string {
  return tasks
    .map(task => {
      const key = task.linearIssueKey ?? task.taskID;
      return `${key}: ${task.title}`;
    })
    .join('\n');
}

/**
 * Standard format: ID, title, effort, status
 */
function formatStandard(tasks: Task[]): string {
  return tasks
    .map(task => {
      const key = task.linearIssueKey ?? task.taskID;
      const effort = task.effort ? `effort ${task.effort}` : 'no effort';
      const status = getStatusIcon(task.status);
      const uncertainties = task.uncertainties?.filter(u => !u.resolvedAt).length ?? 0;
      const uncertaintyIndicator = uncertainties > 0 ? ` ⚠️${uncertainties}` : '';

      return `${status} ${key}: ${task.title} (${effort})${uncertaintyIndicator}`;
    })
    .join('\n');
}

/**
 * Detailed format: Full metadata
 */
function formatDetailed(tasks: Task[]): string {
  return tasks
    .map(task => {
      const key = task.linearIssueKey ?? task.taskID;
      const lines: string[] = [];

      // Header
      lines.push('='.repeat(80));
      lines.push(`${getStatusIcon(task.status)} ${key}: ${task.title}`);
      lines.push('='.repeat(80));

      // Basic info
      if (task.effort) {
        lines.push(`Effort: ${task.effort}${task.effortReason ? ` (${task.effortReason})` : ''}`);
      }
      if (task.complexityBias) {
        lines.push(`Complexity: ${task.complexityBias}`);
      }
      if (task.goal) {
        lines.push(`Goal: ${task.goal}`);
      }
      if (task.description) {
        lines.push(`\nDescription:\n${task.description}`);
      }

      // Uncertainties
      const unresolvedUncertainties = task.uncertainties?.filter(u => !u.resolvedAt) ?? [];
      const resolvedUncertainties = task.uncertainties?.filter(u => u.resolvedAt) ?? [];

      if (unresolvedUncertainties.length > 0) {
        lines.push(`\n⚠️  Unresolved Uncertainties (${unresolvedUncertainties.length}):`);
        unresolvedUncertainties.forEach((u, idx) => {
          lines.push(`  ${idx + 1}. ${u.title}`);
          if (u.description) {
            lines.push(`     ${u.description}`);
          }
        });
      }

      if (resolvedUncertainties.length > 0) {
        lines.push(`\n✅ Resolved Uncertainties (${resolvedUncertainties.length}):`);
        resolvedUncertainties.forEach((u, idx) => {
          lines.push(`  ${idx + 1}. ${u.title}`);
          if (u.resolution) {
            lines.push(`     Resolution: ${u.resolution}`);
          }
        });
      }

      // Lessons learned
      if (task.lessonsLearned && task.lessonsLearned.length > 0) {
        lines.push(`\n📚 Lessons Learned (${task.lessonsLearned.length}):`);
        task.lessonsLearned.forEach((lesson, idx) => {
          const category = lesson.category ? `[${lesson.category}]` : '';
          lines.push(`  ${idx + 1}. ${category} ${lesson.content}`);
        });
      }

      // Labels
      if (task.labels && task.labels.length > 0) {
        lines.push(`\nLabels: ${task.labels.join(', ')}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Get status icon for visual representation
 */
function getStatusIcon(status: Task['status']): string {
  switch (status) {
    case 'done':
      return '✅';
    case 'in-progress':
      return '🔄';
    case 'in-review':
      return '👀';
    case 'canceled':
      return '❌';
    case 'todo':
      return '📋';
    case 'backlog':
      return '⭕';
    default:
      return '❓';
  }
}

/**
 * Format task tree hierarchy with git-style box drawing
 */
export function formatTaskTree(
  task: Task,
  tree?: Map<string, Task[]>,
  depth = 0,
  isLast = true,
  ancestorPrefix = ''
): string {
  const lines: string[] = [];
  const key = task.linearIssueKey ?? task.taskID;
  const status = getStatusIcon(task.status);
  const uncertainties = task.uncertainties?.filter(u => !u.resolvedAt).length ?? 0;
  const uncertaintyIndicator = uncertainties > 0 ? ` ⚠️${uncertainties}` : '';

  // Build the branch connector
  let connector = '';
  if (depth > 0) {
    connector = isLast ? '└─ ' : '├─ ';
  }

  // Current line with proper prefix
  lines.push(`${ancestorPrefix}${connector}${status} ${key}: ${task.title} (effort ${task.effort ?? '?'})${uncertaintyIndicator}`);

  // Get subtasks from tree if available
  const subtasks = tree?.get(task.taskID) ?? [];

  if (subtasks.length > 0) {
    // Sort subtasks by ID to maintain consistent ordering
    const sortedSubtasks = [...subtasks].sort((a, b) => {
      const aKey = a.linearIssueKey ?? a.taskID;
      const bKey = b.linearIssueKey ?? b.taskID;
      return aKey.localeCompare(bKey);
    });

    // Build prefix for children
    const childPrefix = depth === 0
      ? ''
      : ancestorPrefix + (isLast ? '   ' : '│  ');

    sortedSubtasks.forEach((subtask, index) => {
      const isLastChild = index === sortedSubtasks.length - 1;
      const childLines = formatTaskTree(subtask, tree, depth + 1, isLastChild, childPrefix);
      lines.push(childLines);
    });
  }

  return lines.join('\n');
}
