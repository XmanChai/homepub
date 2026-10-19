# Contributing

## Dev setup

```bash
git clone <repo> && cd homepub
node --version   # >= 22
npm test         # zero dependencies, no npm install needed
```

## Rules

- No runtime dependencies. Node built-ins only.
- Generated output must stay deterministic (tests compare byte-for-byte).
- Every new behavior needs a test that would fail without it.
- Never add a path that mutates live production config automatically.
- Shell snippets must pass `bash -n`.

## Adding a service option

1. `src/config.js` — validate + default
2. `src/render.js` — render it
3. `test/` — assertions for the rendered output
4. `README.md` + `docs/config.schema.json` — document it

## Commit style

`type: short summary` (feat / fix / docs / test / chore), one topic per PR.
