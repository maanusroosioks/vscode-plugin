import * as vscode from 'vscode';
import { AdapterRegistry } from './adapters/registry';
import { mavenJunitAdapter } from './adapters/maven-junit';
import { gradleJunitAdapter } from './adapters/gradle-junit';
import { pytestAdapter } from './adapters/pytest';
import { dotnetTestAdapter } from './adapters/dotnet-test';
import { AuthService } from './auth/authService';
import { MoodleApiClient } from './services/moodleApiClient';
import { getAuthScopes, getRequestTimeoutMs, getServiceUrl } from './config/settings';
import { registerRunAndSubmitCommand } from './commands/runAndSubmit';
import { registerRunTestsOnlyCommand } from './commands/runTestsOnly';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerConfigureAssignmentCommand } from './commands/configureAssignment';
import { registerShowOutputCommand } from './commands/showOutput';
import { createOutputChannelLogger, getOutputChannel } from './ui/outputChannel';
import { createStatusReporter } from './ui/statusBar';
import { maybePromptOnboarding, refreshConfiguredContext } from './onboarding';

export function activate(context: vscode.ExtensionContext): void {
  const registry = new AdapterRegistry();
  registry.register(mavenJunitAdapter);
  registry.register(gradleJunitAdapter);
  registry.register(pytestAdapter);
  registry.register(dotnetTestAdapter);

  const authService = new AuthService(getAuthScopes);
  const apiClient = new MoodleApiClient({
    getBaseUrl: getServiceUrl,
    getTimeoutMs: getRequestTimeoutMs,
    getAccessToken: (opts) => authService.getAccessToken(opts),
  });

  const logger = createOutputChannelLogger();
  const status = createStatusReporter();
  context.subscriptions.push(getOutputChannel(), status);

  registerRunAndSubmitCommand(context, registry, authService, apiClient, logger, status);
  registerRunTestsOnlyCommand(context, registry, logger, status);
  registerLoginCommand(context, authService);
  registerLogoutCommand(context, authService);
  registerConfigureAssignmentCommand(context, authService);
  registerShowOutputCommand(context);

  refreshConfiguredContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('moodleSubmit.serviceUrl')) {
        refreshConfiguredContext();
      }
    }),
  );
  void maybePromptOnboarding(context);
}

export function deactivate(): void {}
