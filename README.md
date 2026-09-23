# Daybook

A simple homework tracker. Add assignments with a class, due date, and completion status. Edit, search, filter, delete with undo, and check off your work.

## Canvas setup (in progress)

The first stage adds a server-only, read-only Canvas connector and a safe connection check. Canvas import is not enabled in the website yet. Your existing list and manual controls are unchanged.

The Canvas token belongs in the repository's GitHub Actions secret named `CANVAS_TOKEN`. Never put it in this repository, a URL, browser storage, chat, or a command-line argument. To set or rotate it, use `gh secret set CANVAS_TOKEN --repo jphilowk/homework-tracker` and enter it at the hidden prompt. Tokens expire; replace it before its Canvas expiration date.

The **Check Canvas connection** workflow is manually run from GitHub Actions on `main`. It reads active student courses and assignment/submission metadata, then reports only fixed success/failure messages. It does not save student data, upload artifacts, or log API response bodies. Its unit tests use fabricated data and run without credentials.

The planned connected app will use a private server-side secret store, authenticated access, and a private Canvas snapshot that can refresh while the browser is closed. GitHub Pages alone cannot securely hold a token or private school data. See [the implementation and migration plan](docs/canvas-plan.md). Provisioning and live integration remain to be completed.

## Open the app

Published site: https://jphilowk.github.io/homework-tracker/

Visit http://localhost:4173 while the server is running.

To restart it, open Terminal and run:

```sh
cd ~/homework-tracker
npm start
```

No packages need to be installed. Node.js is already installed on this computer. Stop the server with Control-C.

Assignments save in this browser on this computer. They are not synced between browsers or devices. Clearing browser site data removes them. Keep using the same localhost address and port to access your list.

The published site saves its own list. Assignments entered on localhost do not automatically transfer to the published site. Assignment data stays in browser storage and is not committed to GitHub.

## Tests

Run `npm test` for assignment validation, date handling, filtering, and sorting tests.

For the optional browser tests, install Playwright (`npm install --no-save playwright`) and run `node tests/browser.mjs` with Google Chrome installed. Set `APP_URL` to test the published site instead of localhost. Browser tests use an isolated browser session.
