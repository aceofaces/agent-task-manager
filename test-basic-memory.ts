/**
 * Simple test script to verify basic-memory integration works
 *
 * Run with: npx tsx test-basic-memory.ts
 */

import { BasicMemoryService } from './src/integrations/basic-memory/service.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function main() {
  // Create temp directory for testing
  const tempDir = path.join(os.tmpdir(), 'agent-task-manager-test-' + Date.now());
  const projectPath = path.join(tempDir, 'test-project');

  console.log(`\n📁 Test directory: ${tempDir}\n`);

  // Initialize service
  const service = new BasicMemoryService({
    rootPath: tempDir,
    globalPath: path.join(tempDir, 'global'),
    projects: {
      'test-project': {
        path: projectPath,
        lessonsFolder: 'lessons',
        decisionsFolder: 'decisions',
      },
    },
  });

  console.log('✅ BasicMemoryService initialized\n');

  // Test 1: Create a lesson
  console.log('📝 Test 1: Creating a lesson...');
  const lessonPath = await service.createLesson(
    'LINEAR-123',
    'Implement authentication system',
    {
      content: 'JWT with refresh token rotation provides good security/UX balance',
      category: 'pattern',
      tags: ['security', 'auth', 'jwt'],
    },
    'test-project',
    'project',
    ['Authentication Patterns', 'Security Best Practices'],
    {
      effort: 5,
      effortReason: 'Security review and testing required',
      complexityBias: 'high',
    }
  );

  console.log(`✅ Lesson created: ${lessonPath}`);
  const lessonContent = await fs.readFile(lessonPath, 'utf-8');
  console.log('\n📄 Lesson content:\n');
  console.log(lessonContent.split('\n').slice(0, 25).join('\n'));
  console.log('...\n');

  // Test 2: Create a decision
  console.log('📝 Test 2: Creating a decision...');
  const decisionPath = await service.createDecision(
    'LINEAR-123',
    'Implement authentication system',
    {
      title: 'PKCE vs implicit flow for OAuth?',
      description: 'Need to decide on OAuth flow for the SPA',
      resolution: 'Use PKCE for better security against authorization code interception',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'Team',
    },
    'test-project',
    'project',
    ['oauth', 'security']
  );

  console.log(`✅ Decision created: ${decisionPath}`);
  const decisionContent = await fs.readFile(decisionPath, 'utf-8');
  console.log('\n📄 Decision content:\n');
  console.log(decisionContent.split('\n').slice(0, 25).join('\n'));
  console.log('...\n');

  // Test 3: Search lessons
  console.log('📝 Test 3: Searching for lessons...');
  const results = await service.searchLessons('JWT', 'test-project');

  console.log(`✅ Found ${results.length} result(s)`);
  for (const result of results) {
    console.log(`  - ${result.title}`);
    console.log(`    Path: ${result.path}`);
    console.log(`    Tags: ${result.metadata.tags?.join(', ') || 'none'}`);
  }

  // Test 4: Create global lesson
  console.log('\n📝 Test 4: Creating a global lesson...');
  const globalLessonPath = await service.createLesson(
    'LINEAR-456',
    'Database performance optimization',
    {
      content: 'Index columns used in WHERE clauses for better query performance',
      category: 'performance',
      tags: ['database', 'optimization'],
    },
    undefined,
    'global',
    ['Database Design', 'Performance Tuning']
  );

  console.log(`✅ Global lesson created: ${globalLessonPath}\n`);

  // Show directory structure
  console.log('📂 Generated directory structure:\n');
  await showDirTree(tempDir, '', 0);

  console.log(`\n✅ All tests passed!`);
  console.log(`\n💡 You can inspect the generated markdown files at: ${tempDir}`);
  console.log(`   These files follow basic-memory conventions and can be synced with basic-memory MCP.\n`);
}

async function showDirTree(dir: string, prefix: string = '', depth: number = 0): Promise<void> {
  if (depth > 3) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';

      console.log(prefix + connector + entry.name);

      if (entry.isDirectory()) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        await showDirTree(path.join(dir, entry.name), newPrefix, depth + 1);
      }
    }
  } catch (err) {
    // Ignore errors
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
