// Scans for test *declarations* rather than using the line TestLocationResolver reports: that
// line comes from a stack trace, so only failing tests have one.

export type SourceLanguage = 'python' | 'java' | 'kotlin' | 'csharp';

export interface TestDeclaration {
  name: string;
  /** Dotted outermost-first. Absent for a module-level function. */
  container?: string;
  /** 1-based, the first decorator/annotation/attribute line. */
  startLine: number;
  /** 1-based inclusive. */
  endLine: number;
  markers: string[];
  containerMarkers: string[];
  /** Excludes the signature and markers. */
  bodyText: string;
}

const EXTENSION_LANGUAGES: Record<string, SourceLanguage> = {
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
};

const RUN_LANGUAGES: Record<string, SourceLanguage> = {
  java: 'java',
  python: 'python',
  csharp: 'csharp',
};

/** `SOURCE_EXTENSIONS.java` also covers `.kt`, so a Kotlin file can arrive under language `java`. */
export function languageForFile(filePath: string, runLanguage: string): SourceLanguage | undefined {
  const dot = filePath.lastIndexOf('.');
  const extension = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return EXTENSION_LANGUAGES[extension] ?? RUN_LANGUAGES[runLanguage];
}
