# Configure the submission service

Moodle Test Submit sends your local test results to your course's submission
service. It needs to know **where** that service lives.

Run **Moodle Submit: Configure Assignment** to set:

- **Service URL** — the base URL your instructor gave you
  (e.g. `https://moodle-bridge.example.edu`).
- **Assignment key** *(optional)* — a fallback used only when the workspace has
  no `.moodle-submit.json` file.

You can change these any time from the same command, or in Settings under
`moodleSubmit`.
