# Run tests & submit

Open a project that has tests (Maven, Gradle, pytest, or `dotnet test`) and run
**Moodle Submit: Run Tests & Submit to Moodle**.

The extension auto-detects your test framework, runs it, and uploads the
results. Use **Moodle Submit: Run Tests (No Submit)** if you just want a local
run.

Per-project assignment keys live in a `.moodle-submit.json` file at the project
root:

```json
{
  "assignmentKey": "your-assignment-key"
}
```
