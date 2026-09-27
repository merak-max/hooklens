# A ten-minute external trial

No external-user results are claimed yet. This guide is ready to send to a
developer who agrees to try the project. Use synthetic data; never paste real
customer payloads, API credentials or production signing secrets.

## Browser sandbox

1. Open the sandbox linked in the README and confirm the simulated-data banner.
2. Create an inbox and generate a sample webhook.
3. Generate a second sample, select it, and find the two structural changes.
4. Search for `currency`, then try a query with no matches.
5. Attempt replay; it must explain that the sandbox sends no network requests.
6. Reload: the synthetic inboxes and events must disappear.

## Optional local test

Follow the README from a fresh clone, create an inbox, send a signed event, and
verify its signature in the UI. Restart the API and confirm retained history.
Only test replay against a public HTTPS receiver you own and explicitly allow.

Report: operating system, browser/version, commit, exact steps, expected/actual
behavior, and time to first successful capture. Screenshots must contain only
synthetic data. Report security concerns privately through the security policy.

Success criteria: setup without author assistance, correct drift display,
understandable failure messages, and no misleading demo expectations. A real
trial can uncover usability problems that automated tests cannot.
