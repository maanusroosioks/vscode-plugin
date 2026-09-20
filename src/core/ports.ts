// The seams between the pure layers and the editor. Declared here so adapters, core and the
// submission pipeline can depend on the shape of a logger or a status bar without importing
// `vscode` to get it; `ui/` supplies the implementations.

export interface Logger {
  log(message: string): void;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface StatusReporter {
  running(): void;
  result(summary: RunSummary): void;
  error(message: string): void;
  idle(): void;
}
