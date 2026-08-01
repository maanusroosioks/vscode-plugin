import { MoodleSubmitError } from '../core/errors';

export class TimeoutError extends MoodleSubmitError {
  constructor(message: string) {
    super(message);
  }
}

export class NetworkError extends MoodleSubmitError {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
  }
}

export class HttpError extends MoodleSubmitError {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Request failed with status ${status}`);
  }

  get userMessage(): string {
    return `Submission service returned ${this.status}: ${this.body}`;
  }
}
