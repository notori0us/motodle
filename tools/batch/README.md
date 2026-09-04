Helper scripts from the 2026-09-03 content batch. Plain Node, no build step, run from the repo
root; `mkreview.js` needs `NODE_PATH=$PWD/node_modules` for `sharp`. The two files under
`workflows/` are Workflow-tool scripts (see docs/CONTENT-RUNBOOK.md for args). None of these are
imported by the app or covered by CI; they are the recorded procedure, not a library.
