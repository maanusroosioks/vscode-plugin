import { describe, expect, it } from 'vitest';
import { MissingAssignmentKeyError, resolveSubmissionMetadata } from '../../../src/core/submissionMetadata';

describe('resolveSubmissionMetadata', () => {
  it('prefers the workspace file over the settings fallback', () => {
    const metadata = resolveSubmissionMetadata({
      workspaceFile: { assignmentKey: 'from-file', projectName: 'file-project' },
      assignmentKeySetting: 'from-settings',
      defaultProjectName: 'default-project',
    });

    expect(metadata).toEqual({
      assignmentKey: 'from-file',
      projectName: 'file-project',
      commitHash: undefined,
    });
  });

  it('falls back to the settings value and derived defaults when no workspace file is present', () => {
    const metadata = resolveSubmissionMetadata({
      assignmentKeySetting: 'from-settings',
      defaultProjectName: 'default-project',
      gitCommitHash: 'abc123',
    });

    expect(metadata).toEqual({
      assignmentKey: 'from-settings',
      projectName: 'default-project',
      commitHash: 'abc123',
    });
  });

  it('throws MissingAssignmentKeyError when no assignmentKey is available anywhere', () => {
    expect(() => resolveSubmissionMetadata({})).toThrow(MissingAssignmentKeyError);
  });
});
