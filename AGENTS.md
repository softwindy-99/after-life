# After Life Server Agent Guide

## Scope and workspace

- Treat the current implementation as the basis for documentation. Preserve unrelated staged and unstaged changes; do not reset or overwrite another task's work.
- Put one-off scripts, logs, screenshots and temporary output in the system temporary directory or `.codex`. Do not create workspace `outs/` or temporary `script/` directories. Maintained tooling belongs in `scripts/`.
- Never expose `.env` values, passwords, bearer tokens, private keys or decrypted configuration. Do not commit secrets, generated builds, dependencies or coverage output.
- Keep root documentation limited to this guide and a concise, Chinese/English paired [README](README.md). Put application-specific development commands, configuration and module guidance in [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md); keep MCP integration in [backend/docs/mcp.md](backend/docs/mcp.md). Avoid duplicate guides and product-history descriptions.

## Commands and verification

Run commands from the repository root with Node.js 22.12+:

| Command             | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `npm run bootstrap` | Install API and frontend dependencies                   |
| `npm run dev`       | Start API, then the Vite console                        |
| `npm run build:api` | Build only the API                                      |
| `npm run build`     | Build API and frontend in pro                           |
| `npm start`         | Serve the built frontend and API from Nest in test      |
| `npm run check`     | Lint, format check, unit tests, HTTP tests, both builds |

Before finishing code changes, run `npm run lint`, `npm run format:check`, `npm test`, `npm run test:e2e` and `npm run build` (or the combined `check`). Report failures and distinguish pre-existing failures. For documentation-only changes, verify documented behavior, relative links and changed-file formatting; report any broader checks actually run.

`npm run format` and `npm run lint -- --fix` modify source. Scope formatting to intended files in a dirty worktree. Add unit tests beside changed services/controllers and HTTP coverage for cross-module or guard behavior. HTTP suites use substitute persistence and do not establish MySQL locking or migration correctness.

## Database and configuration

- Startup has `synchronize: false` and does not run migrations or seed data.
- Before 1.0.0, fold schema changes into the initial baseline unless existing data must be preserved; then use a reviewed incremental migration. Keep applied historical migrations and use the removal increment for the obsolete runtime configuration table. From 1.0.0 onward, every schema change needs a reviewed incremental migration.
- Do not run `db init|migrate|seed|reset`, migration reverts or generated migrations without an explicit user request for the database change. Reset destroys the configured database.
- `npm run db -- check` is read-only for the database and env file. CLI/API use the project root `.env` in every mode. The CLI requires installation fields. `db --help` must not load configuration or access the database.
- On API startup and reload, create or complete `.env` from missing template keys. Preserve existing entries, including empty values. Docker persists the file on the dedicated config volume and supplies missing defaults for its bundled services.
- Application settings come from the file. Store updates with mode `0600`. Compose variables such as `AFTER_LIFE_PORT` control deployment behavior. No database config store, `CONFIG_MASTER_KEY`, or `--config-source` switches remain. Export legacy database settings before applying the table-removal migration.
- Setup is available only for unconfigured startup. Installation endpoints do not require an installation token. Unconfigured status returns allowlisted, masked setup defaults; configured status exposes only lifecycle flags. Keep lifecycle and write-lock checks in services, and never return secret defaults.
- Web setup provisions an administrator and an ordinary user in a single transaction under a connection-scoped MySQL lock shared with CLI seeding.
- Public registration uses the default user role. User administration, role permissions and dashboard statistics require admin permission. Keep personal resources scoped to their owner.

## Backend boundaries

- `backend/src/` uses NestJS business modules. Controllers handle transport and strict runtime schemas; services own business rules and transactions; entities define persistence. Use explicit safe DTOs for responses, never raw entities.
- `backend/src/correspondence/` registers Letter/Contact services, controllers and delivery worker once. Import `CorrespondenceModule`; do not redeclare those providers. Shared transaction primitives belong here; resource-specific relation locks stay in feature services.
- Keep recipient and delivery-state changes in the shared user → sorted contacts → letter lock order across REST and MCP. Ownership and delivery checks must be inside the write transaction.
- `backend/src/resource/` owns private uploads, signed access and cleanup. Sanitize rich HTML on the server and validate resource ownership in the letter transaction. Never serve storage as static files or expose other users' files or letter bodies to administrators; resource administration exposes aggregate bytes only.
- Use single quotes, Prettier formatting, `readonly` constructor dependencies and explicit return types at module boundaries. Avoid `Object`, unbounded `any` and stringified JSON responses.
- Protect routes by default. Use `@Public()` only for intentionally anonymous product behavior. `@Self()` checks a role capability, not ownership; scope resource queries to the authenticated principal.
- User updates must allowlist fields inside services too. Use `backend/src/auth/password.ts` for new passwords; legacy SHA-256 exists only for migration after successful login. Never return stored authentication data or hashes.
- New REST and MCP bearer values are persisted only as one-way hashes plus non-secret markers. Do not introduce plaintext token storage.
- Serialize check-ins, edits and delivery through the user lock; re-read delivery state within the transaction and never save an outer scan snapshot. Keep one scheduler instance until durable delivery claims exist. SMTP has a crash/duplicate window; do not document exactly-once delivery.

## MCP boundaries

- `backend/src/mcp/` provides authenticated, stateless Streamable HTTP, isolated from tool business logic. Bind every request to the JWT principal and revalidate current user and role.
- Only dedicated `aud=mcp` tokens may access `/mcp`; protected REST routes reject them. Legacy write tools require `mcp:write`; managed grants expose only their explicitly granted resource, delivery and delegated check-in scopes, reloaded from storage on every request. Browser Origins must exactly match `MCP_ALLOWED_ORIGINS`.
- Never accept caller-selected user UUIDs or return raw entities, tokens, internal fields or another user's data. Enforce ownership, version, recipient, resource and delivery safety checks inside the same transaction as each write.
- Managed grants may read personal data and create/update contacts, letters and private resources. Editing enabled letters or their delivery addresses requires separate delivery permission. Enabling or changing active detection requires a single-use version-bound preview; overdue previews require human approval through the REST-only AI access page. Delegated check-ins require a separate opt-in scope, fresh actual human interactions and stable deduplicated event IDs; agent background activity must never renew liveness. Do not add immediate sending, deletion, setup, account administration or credential-management MCP tools. Agent authorization management remains human REST only.
- Preserve JSON-RPC/Streamable HTTP responses; do not wrap them in the REST response envelope. See [MCP integration](backend/docs/mcp.md) for token and tool contracts.

## Frontend boundaries

- `frontend/` uses React + Vite. Use double quotes in TS/TSX and the configured Prettier override.
- `App.tsx` coordinates session and personal data; `hooks/` owns setup, notifications, administration and feedback; `components/routing/` assembles routes; `pages/` owns feature screens.
- Reusable chrome belongs in `components/layout`, small primitives in `components/ui`, and transport in `lib/api.ts`. Pages consume typed props rather than calling `fetch` directly.
- Satisfy `react-hooks/exhaustive-deps`; stabilize callbacks or move orchestration into hooks instead of suppressing the rule. Discard stale async responses after session changes or unmounts.
- Use the frontend same-origin `/api` base; Vite strips the prefix in development. Built launches serve frontend/dist from Nest, with controllers under /api. Keep API paths distinct from SPA paths.
- The PWA worker handles notifications, has no fetch/offline cache, and clears old Cache Storage on activation. Do not claim offline application support.

## Completion

Keep changes scoped, verify the result, and report what changed and any remaining limitations. Update affected documentation when commands, configuration, architecture or security behavior changes. Never run a database reset merely to make checks pass.
