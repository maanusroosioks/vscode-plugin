import { readFile } from 'node:fs/promises';
import { MoodleSubmitError } from '../../core/errors';

/** A report that could not be used — distinct from a run that had no tests. */
export class ReportUnavailableError extends MoodleSubmitError {}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function parseReportFile<T>(
  path: string,
  parse: (content: string) => T[],
): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    throw new ReportUnavailableError(`no report was written to ${path} (${reason(error)})`);
  }

  try {
    return parse(content);
  } catch (error) {
    throw new ReportUnavailableError(`the report at ${path} could not be parsed (${reason(error)})`);
  }
}
