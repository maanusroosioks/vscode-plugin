export class MoodleSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  get userMessage(): string {
    return this.message;
  }
}

export class CancelledError extends MoodleSubmitError {
  constructor() {
    super('Run cancelled.');
  }
}
