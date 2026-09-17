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
- **The source of each test is submitted with its result**, so your instructor sees the
  code behind every pass and fail.
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

## What gets submitted

Each run posts the results **and the source of the tests that produced them**. Per test:

- `testSuite`, `testName`, `status`, `durationMs`, and the failure `message`
- `source` — the code of that individual test (`kind: "TEST"`), with its file path
  relative to the workspace folder and its line range. When a test can't be matched to a
  declaration its file stands in for it (`kind: "FILE"`); when the file can't be found at
  all, `kind: "NONE"` and only the framework's own report is sent. `kind` describes what
  was found, not what was sent — with capture off, or once the size budget is spent, the
  code is omitted but the path, line range and hash still stand
- `source.normalizedCodeHash` — SHA-256 of the test with comments dropped and formatting
  normalized, so reformatting or reindenting your code doesn't look like a change. It
  ignores only what carries no meaning: spacing *inside* a string literal counts, and in
  Python so does relative indentation, since moving a line out of an `if` block changes
  what runs.

Alongside the results, `testFiles` carries **each test file once** — its workspace-relative
path, a SHA-256 of its contents, and the contents themselves. That's what covers imports,
fixtures and setup methods, none of which appear in any single test's snippet. A result
whose test couldn't be isolated (`kind: "FILE"`) carries no code of its own and is read
from here via its `filePath`, so a framework the extension can't parse costs one copy of
the file rather than one copy per test.

Deliberately **not** submitted: raw stack traces (only a hash), absolute file paths (a
path outside the workspace folder is reduced to its filename), and anything about your
machine or account beyond the identity in your sign-in token.

Two flags are sent alongside the results, and only when they apply:

- `captureDisabled` — you switched source capture off. Without it, a submission with no
  code would be indistinguishable from one where the extension couldn't find your sources.
- `warningAcknowledged` — you were shown the pre-submit warning below and submitted anyway.

### The pre-submit check is local

The extension checks your tests for empty bodies, missing assertions and skip markers such
as `@Disabled` or `@pytest.mark.skip`, and warns you before submitting if a run looks
degraded. The findings themselves stay on your machine — **no counts and no per-test flags
are submitted**, only the single `warningAcknowledged` flag recording that the warning was
shown. It's there to catch a test you accidentally emptied or left disabled.

It never blocks a submission, and it can be switched off with
`moodleSubmit.warnOnSuspiciousTests` — which silences the dialog but does not change what
is sent.

What your instructor reads is the test code itself, which is the thing worth reading.

### For the gateway and Moodle plugin

`source.code` and `testFiles[].content` carry code verbatim, including `<` and `>`
(`List<String>`, `Assert.Throws<T>`). They **must** be declared `PARAM_RAW` on the Moodle
side — running them through `PARAM_TEXT` would strip those via `strip_tags`. The extension does sanitize
`testSuite`, `testName` and `message` for `PARAM_TEXT`, since those are display fields.
If `PARAM_RAW` turns out not to be available, a base64 `codeBase64` field is a purely
additive follow-up.

`normalizedCodeHash` is always taken over the *untruncated* snippet, so when `truncated`
is true it deliberately does not correspond to `code`. Never hash `code` itself.

**No per-test integrity signals are sent** — no assertion counts, no empty-body or skip
flags, no run-level summary. Everything a receiver might want from those is derivable from
`code`, and a client-computed summary is both weaker than reading the code and the
convenient thing to trust instead of it. The only two client-side facts submitted are
top-level `captureDisabled` and `warningAcknowledged`, both present only when true, and
neither derivable from anything else in the body. Judgement stays on your side.

The hashes are for comparing a student's run against **their own previous run** — there is
no reference set. `normalizedCodeHash` answers "changed, or only reformatted?" without
needing language-aware normalization on your side. `testFiles[].sha256` answers the one
question the snippets can't: a test the student added shows up as a new result, so an
unchanged set of test bodies plus a changed file hash means the edit was in imports,
setup, fixtures or helpers — and `content` lets you see which.

Join a result to its file with `source.filePath` == `testFiles[].path`. Budget order is
snippets first, then file contents, so a pathological project degrades to a working
per-result view rather than losing it; a file whose content didn't fit still carries its
`sha256`.

All of these fields are optional additions; a gateway that doesn't know about them
ignores them and the submission still succeeds.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `moodleSubmit.serviceUrl` | `""` | Base URL of the submission service. |
| `moodleSubmit.requestTimeoutMs` | `15000` | Timeout for requests to the service. |
| `moodleSubmit.assignmentKey` | `""` | Fallback key when no `.moodle-submit.json` is present. |
| `moodleSubmit.authScopes` | Entra ID scopes for the standard service | OAuth scopes requested from the Microsoft provider. Change only for a different deployment. |
| `moodleSubmit.testCommandOverrides` | `{}` | Per-adapter command overrides, e.g. `{ "maven-junit": "mvn -Pci test" }`. |
| `moodleSubmit.preferredAdapter` | – | Force `maven-junit`, `gradle-junit`, `pytest`, or `dotnet-test` instead of auto-detecting. |
| `moodleSubmit.submitTestSource` | `true` | Submit the source of each test. Turning this off still submits checksums and assertion counts. |
| `moodleSubmit.maxTestSourceChars` | `8000` | Cap on the source captured for one test (hard ceiling 20 000). |
| `moodleSubmit.maxTotalSourceChars` | `200000` | Cap on the source captured per submission (hard ceiling 500 000). |
| `moodleSubmit.warnOnSuspiciousTests` | `true` | Warn before submitting when tests look emptied or disabled. Never blocks. |

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
