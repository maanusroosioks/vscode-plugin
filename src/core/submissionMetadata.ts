import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../util/shell';
import { MoodleSubmitError } from './errors';

export interface SubmissionMetadata {
  assignmentKey: string;
  projectName?: string;
  commitHash?: string;
}

export class MissingAssignmentKeyError extends MoodleSubmitError {
  constructor() {
    super(
      'No assignmentKey configured. Add one via the "Moodle Submit: Configure Assignment" command, ' +
        'a .moodle-submit.json file in the workspace, or the moodleSubmit.assignmentKey setting.',
    );
  }
}

export class InvalidWorkspaceConfigError extends MoodleSubmitError {
  constructor(reason: string) {
    super(`${WORKSPACE_CONFIG_FILE_NAME} could not be read: ${reason}.`);
  }
}

export interface WorkspaceConfigFile {
  assignmentKey?: string;
  projectName?: string;
  commitHash?: string;
}

export interface MetadataSources {
  workspaceFile?: WorkspaceConfigFile;
  assignmentKeySetting?: string;
  defaultProjectName?: string;
  gitCommitHash?: string;
}

export function resolveSubmissionMetadata(sources: MetadataSources): SubmissionMetadata {
  const assignmentKey = sources.workspaceFile?.assignmentKey ?? sources.assignmentKeySetting;
  if (!assignmentKey) {
    throw new MissingAssignmentKeyError();
  }

  return {
    assignmentKey,
    projectName: sources.workspaceFile?.projectName ?? sources.defaultProjectName,
    commitHash: sources.workspaceFile?.commitHash ?? sources.gitCommitHash,
  };
}

const WORKSPACE_CONFIG_FILE_NAME = '.moodle-submit.json';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function readWorkspaceConfigFile(folderPath: string): Promise<WorkspaceConfigFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(folderPath, WORKSPACE_CONFIG_FILE_NAME), 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidWorkspaceConfigError('it is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidWorkspaceConfigError('the top level must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  return {
    assignmentKey: optionalString(record.assignmentKey),
    projectName: optionalString(record.projectName),
    commitHash: optionalString(record.commitHash),
  };
}

export async function readGitCommitHash(folderPath: string): Promise<string | undefined> {
  const { exitCode, stdout } = await runCommand('git rev-parse HEAD', { cwd: folderPath });
  if (exitCode !== 0) {
    return undefined;
  }
  const commitHash = stdout.trim();
  return commitHash.length > 0 ? commitHash : undefined;
}
