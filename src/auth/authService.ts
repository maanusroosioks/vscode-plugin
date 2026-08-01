import * as vscode from 'vscode';

const PROVIDER_ID = 'microsoft';

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
}

export class AuthService {
  constructor(private readonly getScopes: () => string[]) {}

  async login(): Promise<vscode.AuthenticationSession> {
    return vscode.authentication.getSession(PROVIDER_ID, this.getScopes(), { createIfNone: true });
  }

  async logout(): Promise<void> {
    await vscode.window.showInformationMessage(
      'To sign out, open the Accounts menu (bottom-left of VS Code) and remove the Microsoft account used for Moodle Submit.',
    );
  }

  async isSignedIn(): Promise<boolean> {
    const session = await vscode.authentication.getSession(PROVIDER_ID, this.getScopes(), { silent: true });
    return session !== undefined;
  }

  async getAccessToken({ forceRefresh = false }: GetAccessTokenOptions = {}): Promise<string> {
    const session = forceRefresh
      ? await vscode.authentication.getSession(PROVIDER_ID, this.getScopes(), { forceNewSession: true })
      : await vscode.authentication.getSession(PROVIDER_ID, this.getScopes(), { createIfNone: true });
    return session.accessToken;
  }
}
