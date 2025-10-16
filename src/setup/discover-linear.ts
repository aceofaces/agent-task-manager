#!/usr/bin/env node
/**
 * Discover Linear teams and projects
 * Usage: node scripts/discover-linear.js <LINEAR_API_KEY>
 */

import { LinearClient } from '@linear/sdk';
import type { Team, TeamConnection, ProjectConnection } from '@linear/sdk';
import { LinearTeam, LinearProject } from './shared-types.js';
import { log, validateLinearApiKey, printValidationResults, retry } from './utils.js';

export async function discoverLinear(apiKey: string): Promise<{
  teams: LinearTeam[];
  projects: LinearProject[];
}> {
  // Validate API key format
  const validation = validateLinearApiKey(apiKey);
  if (!printValidationResults(validation, 'Linear API key')) {
    throw new Error('Invalid Linear API key format');
  }

  log.step('Discovering Linear resources...');

  const client = new LinearClient({ apiKey });

  // Fetch teams
  log.info('Fetching teams...');
  const teamsConnection = await retry(async (): Promise<TeamConnection | undefined> => {
    const viewer = await client.viewer;
    const orgs = await viewer.organization;
    return orgs?.teams();
  });

  if (!teamsConnection?.nodes || teamsConnection.nodes.length === 0) {
    throw new Error('No teams found. Check API key permissions.');
  }

  const teams: LinearTeam[] = teamsConnection.nodes.map((team: Team) => ({
    id: team.id,
    name: team.name,
    key: team.key,
  }));

  log.success(`Found ${teams.length} team(s)`);
  teams.forEach((team) => {
    log.info(`  - ${team.name} (${team.key}) - ID: ${team.id}`);
  });

  // Fetch projects across all teams
  log.info('\nFetching projects...');
  const projects: LinearProject[] = [];

  for (const team of teams) {
    log.debug(`Fetching projects for team: ${team.name}`);
    const teamObj = await client.team(team.id);
    if (!teamObj) {
      continue;
    }

    const projectsConnection = await retry(
      async (): Promise<ProjectConnection | undefined> => teamObj.projects()
    );

    if (projectsConnection?.nodes) {
      for (const project of projectsConnection.nodes) {
        const projectKey = project.slugId || `${team.key}-${project.name}`;
        projects.push({
          id: project.id,
          name: project.name,
          key: projectKey,
          teamId: team.id,
        });
      }
    }
  }

  log.success(`Found ${projects.length} project(s)`);

  // Group projects by team for display
  const projectsByTeam = projects.reduce((acc, project) => {
    const team = teams.find((t) => t.id === project.teamId);
    const teamName = team?.name || 'Unknown';
    if (!acc[teamName]) {
      acc[teamName] = [];
    }
    acc[teamName].push(project);
    return acc;
  }, {} as Record<string, LinearProject[]>);

  Object.entries(projectsByTeam).forEach(([teamName, teamProjects]) => {
    log.info(`\n  ${teamName}:`);
    teamProjects.forEach((project) => {
      log.info(`    - ${project.name} (${project.key}) - ID: ${project.id}`);
    });
  });

  return { teams, projects };
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiKey = process.argv[2];

  if (!apiKey) {
    console.error('Usage: node discover-linear.js <LINEAR_API_KEY>');
    console.error('\nExample:');
    console.error('  node discover-linear.js lin_api_xxxxx');
    process.exit(1);
  }

  discoverLinear(apiKey)
    .then(({ teams, projects }) => {
      console.log('\n' + '='.repeat(60));
      log.success('Discovery complete!');
      console.log('\nUse these IDs in your .env file:');
      console.log(`LINEAR_TEAM_ID=${teams[0]?.id || 'YOUR_TEAM_ID'}`);
      console.log('\nProject IDs for PROJECT_MAPPINGS:');
      projects.forEach((p) => {
        console.log(`  "${p.name}": { "linearProjectId": "${p.id}", ... }`);
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Discovery failed: ${message}`);
      process.exit(1);
    });
}
