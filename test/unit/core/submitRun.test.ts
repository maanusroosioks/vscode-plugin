import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MissingAssignmentKeyError } from '../../../src/core/submissionMetadata';
import { submitRun } from '../../../src/core/submitRun';
import type { NormalizedTestRun } from '../../../src/core/types';
import type { MoodleApiClient } from '../../../src/services/moodleApiClient';
import type { TestRunRequest } from '../../../src/services/httpTypes';

const run: NormalizedTestRun = {
  adapterId: 'pytest',
  language: 'python',
  startedAt: 1000,
  finishedAt: 2000,
  results: [{ testSuite: 'test_calculator', testName: 'test_adds', status: 'PASSED', durationMs: 5 }],
};

function fakeApiClient(): { client: MoodleApiClient; sent: TestRunRequest[] } {
  const sent: TestRunRequest[] = [];
  const client = {
    async submitResults(payload: TestRunRequest) {
      sent.push(payload);
      return { status: 202, body: { ok: true } };
    },
  } as unknown as MoodleApiClient;
  return { client, sent };
}

const logger = { log: (): void => {} };

let folderPath: string;

beforeEach(async () => {
  folderPath = await mkdtemp(join(tmpdir(), 'moodle-submit-test-'));
});

describe('submitRun', () => {
  it('submits a payload built from the setting-provided assignment key', async () => {
    const { client, sent } = fakeApiClient();

    const response = await submitRun(
      run,
      { folderPath, projectName: 'my-project', assignmentKeySetting: 'assignment-101' },
      { apiClient: client, logger },
    );

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      assignmentKey: 'assignment-101',
      ide: 'VSCODE',
      projectName: 'my-project',
      results: [{ testName: 'test_adds', status: 'PASSED' }],
    });
  });

  it('lets the workspace config file win over the setting', async () => {
    await writeFile(
      join(folderPath, '.moodle-submit.json'),
      JSON.stringify({ assignmentKey: 'from-file', projectName: 'from-file-project' }),
      'utf8',
    );
    const { client, sent } = fakeApiClient();

    await submitRun(
      run,
      { folderPath, projectName: 'my-project', assignmentKeySetting: 'assignment-101' },
      { apiClient: client, logger },
    );

    expect(sent[0]).toMatchObject({ assignmentKey: 'from-file', projectName: 'from-file-project' });
  });

  it('refuses to submit with no assignment key configured anywhere', async () => {
    const { client, sent } = fakeApiClient();

    await expect(
      submitRun(run, { folderPath, projectName: 'my-project' }, { apiClient: client, logger }),
    ).rejects.toBeInstanceOf(MissingAssignmentKeyError);
    expect(sent).toHaveLength(0);
  });
});
