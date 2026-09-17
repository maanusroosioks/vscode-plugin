import type { MoodleApiClient, SubmitResult } from '../services/moodleApiClient';
import type { Logger } from '../ui/outputChannel';
import { buildTestRunRequest } from './payload';
import { readGitCommitHash, readWorkspaceConfigFile, resolveSubmissionMetadata } from './submissionMetadata';
import type { TestEvidencePayload } from './testEvidence';
import type { NormalizedTestRun } from './types';

export interface SubmitRunContext {
  folderPath: string;
  projectName: string;
  assignmentKeySetting?: string;
  /** Absent when source capture was skipped or failed — submission goes ahead either way. */
  evidence?: TestEvidencePayload;
}

export interface SubmitRunDeps {
  apiClient: MoodleApiClient;
  logger: Logger;
}

export async function submitRun(
  run: NormalizedTestRun,
  { folderPath, projectName, assignmentKeySetting, evidence }: SubmitRunContext,
  { apiClient, logger }: SubmitRunDeps,
): Promise<SubmitResult> {
  const workspaceFile = await readWorkspaceConfigFile(folderPath);
  const metadata = resolveSubmissionMetadata({
    workspaceFile,
    assignmentKeySetting,
    defaultProjectName: projectName,
    gitCommitHash: await readGitCommitHash(folderPath),
  });

  const payload = buildTestRunRequest(run, metadata, evidence);
  const response = await apiClient.submitResults(payload);
  logger.log(`Submission service responded ${response.status}: ${JSON.stringify(response.body)}`);
  return response;
}
