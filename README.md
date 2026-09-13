# Moodle Test Submit

A VS Code extension that runs your project's unit tests and submits the results to
Moodle. It detects the test framework, runs the suite, and posts a structured run to
your course's submission service — authenticated with your Microsoft (Entra ID)
account.

## Features

- **Zero-config test detection** for Maven, Gradle, pytest, and .NET.
- **Results in VS Code's Test Explorer**, with per-test pass/fail state, durations,
  failure messages, and gutter markers on the failing line.
- **Run-only mode** to check tests locally without submitting.
- **Microsoft / Entra ID sign-in** via VS Code's built-in authentication — the
  extension stores no passwords or tokens.
- **Per-project or global assignment keys** through `.moodle-submit.json` or settings.
- Guided first-run setup, status-bar progress, and a dedicated output log.

## Setup

1. Install the extension.
2. Run **Moodle Submit: Configure Assignment** and enter the submission service URL
   your course provides (e.g. `https://moodle-bridge.example.edu`).
3. Enter a fallback assignment key, or add a `.moodle-submit.json` to each project
   (the configure command offers to create one).
4. Sign in with Microsoft when prompted.
5. Open a project with tests and run **Run Tests & Submit to Moodle**.

### `.moodle-submit.json`

Placed at the root of a workspace folder. Only `assignmentKey` is required (and it
can instead come from the `moodleSubmit.assignmentKey` setting).

```json
{
  "assignmentKey": "cs101-assignment-3",
  "projectName": "linked-list"
}
```

## Test Explorer

Runs also appear in VS Code's **Testing** view under a **Moodle Tests** controller.
The normal run button runs the suite and submits nothing. To submit, use either:

- the **cloud-upload button** in the Testing view toolbar, or
- **right-click** any folder, suite, or test → *Run Tests & Submit to Moodle*

Both run the project's tests and then submit, exactly like the palette command.
Submitting is deliberately a button rather than a second run profile, so there is no
hidden mode to keep track of and no way to submit by accident. Runs that submitted are
labelled *Run & Submit to Moodle* in the Test Results history.

Test command output streams into the run's terminal, and the tree stays populated
across window reloads.

Current limitations:

- Tests appear only **after the first run** — Maven and Gradle offer no reliable way
  to enumerate tests without executing them, so there's no up-front discovery.
- Running a single test or suite from the gutter still runs the whole project; the
  per-framework test filters aren't wired up yet.
- Failing tests get a file **and** a line; passing tests get only the file, since a
  location is derived from the stack trace.
- If you also have the Java or Python test extensions installed, their controllers
  appear alongside this one. Only **Moodle Tests** submits.

## Commands

| Command | What it does |
| --- | --- |
| Moodle Submit: Run Tests & Submit to Moodle | Detect, run, parse, and submit. |
| Moodle Submit: Run Tests (No Submit) | Detect, run, and parse only. |
| Moodle Submit: Sign In with Microsoft | Start a Microsoft auth session. |
| Moodle Submit: Sign Out | Explains how to remove the account from the Accounts menu. |
| Moodle Submit: Configure Assignment | Set the service URL and fallback assignment key. |
| Moodle Submit: Show Log | Reveal the output channel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `moodleSubmit.serviceUrl` | `""` | Base URL of the submission service. |
| `moodleSubmit.requestTimeoutMs` | `15000` | Timeout for requests to the service. |
| `moodleSubmit.assignmentKey` | `""` | Fallback key when no `.moodle-submit.json` is present. |
| `moodleSubmit.authScopes` | Entra ID scopes for the standard service | OAuth scopes requested from the Microsoft provider. Change only for a different deployment. |
| `moodleSubmit.testCommandOverrides` | `{}` | Per-adapter command overrides, e.g. `{ "maven-junit": "mvn -Pci test" }`. |
| `moodleSubmit.preferredAdapter` | – | Force `maven-junit`, `gradle-junit`, `pytest`, or `dotnet-test` instead of auto-detecting. |

## Supported test frameworks

| Adapter | Detected by | Default command |
| --- | --- | --- |
| Maven (JUnit) | `pom.xml` | `mvn -B test` |
| Gradle (JUnit) | `build.gradle` / `build.gradle.kts` | `gradlew cleanTest test` (or `gradle …`) |
| pytest | `pytest.ini`, `pyproject.toml`, `setup.cfg`, `conftest.py` | `pytest --junit-xml=…` |
| .NET | `*.csproj` / `*.sln` | `dotnet test --logger trx …` |

The test tool (`mvn`, `gradle`, `pytest`, `dotnet`) must be on your `PATH`. A run
that produces zero results is reported as an error, since it almost always means the
command itself failed to start.

## Development

```bash
npm install
npm run watch      # esbuild bundle in watch mode
npm run typecheck  # tsc --noEmit
npm run lint
npm test           # vitest
```

Press <kbd>F5</kbd> to launch the Extension Development Host. `npm run package`
produces the production bundle; `npx vsce package` builds a `.vsix`.
