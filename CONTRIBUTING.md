# Contributing to HookLens

Thanks for helping improve HookLens. Small, focused changes with tests and clear reasoning are easiest to review.

## Before opening a pull request

1. Search existing issues and pull requests to avoid duplicate work.
2. Open an issue before a large feature or architecture change.
3. Create a branch from `main` using a descriptive name such as `fix/signature-header`.
4. Keep claims in documentation limited to behavior the repository actually implements.

## Development setup

HookLens requires Node.js 24 and Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The React application runs at `http://localhost:5173`; its development proxy sends API and capture requests to the Express service at `http://localhost:8787`.

## Required verification

Run the complete static, API, and production-build checks:

```sh
pnpm check
```

For interface or end-to-end behavior changes, also run:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Add or update tests when behavior changes. Pull requests must pass both GitHub Actions jobs before merge.

## Pull-request expectations

- Explain the user-visible or engineering problem being solved.
- Keep unrelated formatting or refactors out of the change.
- Include screenshots for meaningful interface changes.
- Describe security implications for capture, persistence, signature verification, or replay changes.
- Never commit captured payloads, signing secrets, environment files, access tokens, or private service URLs.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting as described in [SECURITY.md](SECURITY.md).
