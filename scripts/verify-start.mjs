#!/usr/bin/env node

/**
 * Lightweight integration check that the compiled MCP server boots.
 * Spawns `node dist/index.js`, waits for the ready banner, then exits.
 */

import { spawn } from 'node:child_process';

const READY_SIGNAL = 'Agent Task Manager MCP Server running on stdio';
const TIMEOUT_MS = Number.parseInt(process.env.VERIFY_START_TIMEOUT_MS ?? '15000', 10);

const child = spawn(process.execPath, ['dist/index.js'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let settled = false;

const timeout = setTimeout(() => {
  finish(1, `Timed out waiting for server readiness (${TIMEOUT_MS}ms).`);
}, TIMEOUT_MS).unref();

child.stdout.on('data', onStdout);
child.stderr.on('data', onStderr);
child.on('error', (error) => {
  finish(1, `Failed to launch server: ${error instanceof Error ? error.message : String(error)}`);
});
child.on('exit', (code, signal) => {
  if (settled) {
    return;
  }
  finish(
    code === 0 ? 1 : code ?? 1,
    `Server exited before signaling readiness (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`
  );
});

function onStdout(chunk) {
  process.stdout.write(chunk);
  checkReady(chunk);
}

function onStderr(chunk) {
  process.stderr.write(chunk);
  checkReady(chunk);
}

function checkReady(chunk) {
  if (settled) {
    return;
  }

  const text = chunk.toString();
  if (text.includes(READY_SIGNAL)) {
    finish(0);
  }
}

function finish(exitCode, message) {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);

  if (message) {
    console.error(message);
  }

  child.stdout.off('data', onStdout);
  child.stderr.off('data', onStderr);

  if (child.exitCode !== null || child.signalCode !== null) {
    process.exit(exitCode);
    return;
  }

  child.once('close', () => {
    process.exit(exitCode);
  });

  child.kill('SIGTERM');

  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 1000).unref();
}
