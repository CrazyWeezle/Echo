Contributing to Echo

Thanks for your interest in contributing! This guide covers local setup, coding standards, and how to propose changes.

Getting Started
- Prerequisites: Node 20+, pnpm 10+, Docker (optional for full stack).
- Install deps: `pnpm install` from the repo root.
- API dev: `pnpm --filter ./apps/api dev` (requires a running Postgres and env vars).
- Web dev: `cd apps/web && pnpm dev` then open `http://localhost:5173`.
- Full stack via Docker: see `hosting/docker-compose.yml` and the env examples under `hosting/env`.

Environment & Secrets
- Do not commit real secrets. Only commit `*.env.example` files.
- Set real secrets in your local shell, a `.env` ignored by git, or your secret manager.
- If you add new configuration keys, update the appropriate `*.env.example`.

Coding Standards
- Keep changes focused and minimal; match the existing code style.
- TypeScript/JS: prefer strict types, small modules, and pure functions where possible.
- Linting: run `pnpm --filter ./apps/web lint` for the web app; align API code style similarly.
- Commit messages: use clear, descriptive messages. Conventional Commits are welcome but not required.

Testing & Validation
- Add targeted tests where practical; smoke-test locally before opening a PR.
- For API changes, validate key flows (auth, sockets, file signing) locally.
- For web changes, test both dev server and a `vite build` preview if applicable.

Submitting Changes
- Open a Pull Request with a concise description of the problem and solution.
- Reference related issues and include reproduction steps when relevant.
- Keep PRs small and focused. Large or multi-topic PRs are harder to review.

Security
- If you find a security issue, please report it privately (do not open a public issue). If no contact is listed, open a minimal issue asking for a security contact and avoid sharing sensitive details.

License
- By contributing, you agree that your contributions will be licensed under the terms of the repository’s `LICENSE` (MIT by default). If that’s an issue, please raise it in your PR.

