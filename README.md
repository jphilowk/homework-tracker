# Daybook

A simple homework tracker. Add assignments with a class, due date, and completion status. Edit, search, filter, delete with undo, and check off your work.

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
