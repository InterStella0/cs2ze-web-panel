# CS2 ZE Web Control Panel

## Implementation checkpoint — 2026-09-15

Completed locally:

- Step 0 configuration: RCON host publishing is loopback-only; `.env.example` no longer ships a default
  password; the local `.env` has a generated 256-bit RCON password. No game-server restart was performed.
- Step 1 foundation: npm workspaces, multi-stage panel image, Compose service/data preparation, shared schemas,
  SQLite users/audit/login throttling, scrypt password hashing, hashed cookie sessions, CSRF checks, bootstrap
  owner, forced first-login password change, `/api/health`, preflight diagnostics, responsive login/dashboard
  shell, and dark/light `#ffcccb` theme tokens.
- Step 2 Docker control: authenticated container status, SQLite-persisted lifecycle jobs, restart recovery,
  process-wide serialization, capped output capture, job history/detail/SSE routes, audit entries, and dashboard
  controls for start, stop, restart, apply/recreate, and pull with disruption confirmations.
- Step 3 RCON and logs: Source packet framing with an 8 MiB cap, single-packet authentication, sentinel-based
  response completion, a serialized reconnecting client, multiline-safe sanitizers, status/player/plugin/cvar
  parsers, cached dashboard status, Docker and rotating game-log SSE streams, `/logs`, and owner-only `/console`.
- Step 4 settings: all 116 typed `.env` fields, shared client/server validation, compatibility and port-collision
  checks, comment-preserving atomic writes with backups, secret redaction/reveal auditing, live RCON cvar apply,
  stateless environment/config drift, a global pending-restart review banner, and the owner-only `/settings` UI.
- Earlier backend groundwork retained and compiling: project discovery, safe file writes/backups, dotenv editor,
  and the Docker CLI/Compose safety wrapper.

Verification completed:

- `npm run typecheck`, `npm run build`, `docker compose config --quiet`, and `docker compose build cs2-panel`.
- Registry audit reports zero vulnerabilities.
- HTTP auth smoke test: login/session 200, missing CSRF 403, password rotation 200 and clears the forced-change flag.
- Isolated fake-Docker integration: authenticated status 200, pull job 202 → success/exit 0, output persisted, and
  the terminal job delivered over SSE. Dashboard and restart confirmation inspected in the collaborative browser.
- Container health reports `setupError: null` and the discovered project path; only `cs2-panel` and
  `prepare-data` were started, not `cs2-server`.
- Login and forced-password screens inspected in the collaborative browser in dark and light themes with no
  browser console errors; the light primary button border remains visible.
- `npm test` builds all three workspaces and passes 17 tests covering environment validation, atomic settings
  writes/backups, secret handling, drift, the pre-apply compatibility gate, protocol fragmentation/coalescing and a
  700 KiB response, RCON authentication/serialization, sanitizers, all status parsers, bounded log buffering,
  game-log reads/tailing/rotation, route auth/role/CSRF rules, SSE limits, and secret-safe RCON auditing.
- The final panel image builds with zero npm audit vulnerabilities, the recreated `cs2-panel` is healthy, and
  unauthenticated RCON/log endpoints return 401. The real game server was not changed.

Next work: Step 5 — Maps, Admins, and Players. Maps and Players still show `Soon`; Settings, Overview (including
server controls), Logs, and owner-only Console are functional. The redundant
`Server` placeholder was removed from navigation. The real
`cs2-server` lifecycle gate remains intentionally unrun; do not stop, start, restart, or recreate it without
explicit approval.

## Context

`cs2ze-docker` reduces a Zombie Escape server to one command (`docker compose up -d`), but every operation
after that is a shell task: edit `.env`, edit `config/**`, `docker compose up -d --force-recreate`,
`docker logs`, `docker attach`. The goal is to keep that one-command bootstrap and put a real control surface
on top of it — a React panel in its own container that drives the existing stack instead of replacing it.

The server's config model does not change. The panel is a *typed editor plus an apply engine* for the three
config authority layers `scripts/install-mods.sh` already defines, plus an RCON/Docker client for runtime
control.

### Decisions taken from you

- **Auth**: local users in SQLite, bootstrap admin from `.env`.
- **Exposure**: plain `8090:8090` port mapping, as requested.
- **Workshop**: resolve map titles from Steam when reachable, manual entry as fallback.
- **Testing**: deploy and verify on the live server, without restarting `cs2-server` unless you approve it.

---

## ⚠ Step 0 — pre-existing security issue, fix before anything else

Found while probing the live server; **not** caused by this work, but the panel should not be built on top of it:

1. **RCON is exposed to the internet.** `compose.yaml` publishes `27050/tcp` on all interfaces. I confirmed
   `94.130.242.62:27050` accepts connections from outside your network.
2. **`CS2_RCONPW` is still the shipped default `change-me-now`.** I verified this without printing it.

Together that is unauthenticated remote control of the live server by anyone who port-scans it.

Fix, in this order:
- Change `CS2_RCONPW` in `.env` to a strong random value, then `docker compose up -d --force-recreate cs2-server`.
- Change the RCON port mapping to loopback-only:
  `"127.0.0.1:${CS2_RCON_PUBLISHED_PORT:-27050}:${CS2_RCON_PORT:-27050}/tcp"`.
  The panel does **not** need the host publish — it reaches RCON over the project network (verified: the
  `cs2ze_default` bridge gives `cs2-server` and `cs2ze-server` as DNS aliases).
- Update `.env.example` so a fresh clone doesn't ship an internet-reachable default-password RCON.

---

## Verified facts this design rests on

All checked live via `ssh stella@stella-server -p 6543`:

- Stack running at `/home/stella/cs2ze-docker`, same two commits as local; `cs2-data` is 67 GB; server public on
  `94.130.242.62:27015`. Ubuntu 26.04, Docker 29.8.0, Compose v5.5.1. `/var/run/docker.sock` gid **983**.
  Ports 8090/8091/8092/8095/9000 free.
- `meta list` → CS2Fixes v1.20.1, StripperCS2 1.1.3, MultiAddonManager v1.5.4, all loaded.
- **RCON works** on standard Source protocol. CS2 sends **one** packet in reply to AUTH (not the Source 1 dummy
  + response pair) — a client waiting for two packets hangs forever.
- **`cvarlist` returned a single 694,421-byte packet.** Responses are *not* split at 4096 bytes. The client must
  frame purely off the 4-byte length prefix and cap the buffer or it's a trivial OOM.
- **`c_reload_map_list` help text: "Reload map list, also reloads current map on completion."** It is **not** a
  free hot-reload — it disrupts players. Must be confirm-gated. `c_reload_admins`,
  `c_reload_discord_bots`, `c_reload_infractions` are the only other reload commands, and those *are* free.
- `c_maplist` returns only `"The list of all maps will be shown in console"` — the payload goes to stdout, not
  the RCON reply. The maps UI must read `config/cs2fixes/maplist.jsonc` as truth, never RCON.
- RCON replies contain CS2 chat color bytes (`\x01`, `\x07`, …); container logs carry ANSI and bare `\r`.
  Both need sanitizing.
- **`Tty=true`** on `cs2-server`, so its log stream is raw, not 8-byte-header multiplexed.
- **Compose labels on the running container give the host project dir for free**:
  `com.docker.compose.project.working_dir=/home/stella/cs2ze-docker`,
  `project.config_files=/home/stella/cs2ze-docker/compose.yaml`, `project=cs2ze`. This solves the bind-mount
  path problem with zero user configuration.
- Game logs are written to `cs2-data/game/csgo/logs/*.log`; `json-file` driver with **no rotation limits**, so
  always stream with `--tail`.
- Steam's `GetPublishedFileDetails` needs **no API key** and returns `title: "ze_winter_warehouse_p"` plus a
  preview image — paste-an-ID-and-done works.

---

## Architecture

```
cs2ze-docker/
├── compose.yaml            # + cs2-panel service; prepare-data also chowns panel-data
├── .env / .env.example     # + PANEL_* keys
├── .gitignore              # + panel-data/, node_modules, panel/web/dist
├── panel-data/             # gitignored BIND mount: panel.db, backups/
└── panel/
    ├── Dockerfile          # web build → server build → node:22-alpine + docker CLI/compose plugin
    ├── package.json        # npm workspaces: shared, server, web
    ├── shared/src/         # zod schemas imported by BOTH server and web
    │   ├── env-schema.ts   # every .env key: type, range, group, secret?, cvar?, restartRequired?
    │   ├── validators.ts   # steamid64, adminFlags, mapName, workshopId, envValueCharset
    │   ├── compat.ts       # 1:1 port of check_known_compatibility()
    │   └── maplist.ts admins.ts zr.ts api.ts
    ├── server/src/         # Fastify 5
    │   ├── project.ts      # ⭐ compose-label self-discovery + boot preflight
    │   ├── db.ts auth/     # node:sqlite, scrypt, sessions, rate limit, CSRF
    │   ├── docker/         # cli.ts (execFile argv only), compose.ts (verb allowlist), jobs.ts
    │   ├── rcon/           # protocol.ts client.ts sanitize.ts parse.ts
    │   ├── files/          # safe-write.ts dotenv-edit.ts jsonc-edit.ts kv-edit.ts backups.ts
    │   ├── logs/           # docker-stream.ts game-files.ts
    │   ├── steam/workshop.ts  drift.ts  audit.ts
    │   └── routes/
    └── web/src/            # Vite + React 19 + TanStack Router/Query + shadcn/ui
```

**Why a `shared/` workspace:** the fail-closed rules from `install-mods.sh` must be enforced in the browser
*and* on the server. Duplicating them guarantees drift. One zod module imported by both is the only way to keep
them in lockstep.

---

## The panel container

```yaml
  cs2-panel:
    build: { context: ./panel }
    container_name: ${CONTAINER_NAME:-cs2ze-server}-panel
    user: "1000:1000"
    group_add: ["${DOCKER_GID:-983}"]
    depends_on:
      prepare-data: { condition: service_completed_successfully }
    restart: unless-stopped
    environment:
      PANEL_CONTAINER_NAME: ${CONTAINER_NAME:-cs2ze-server}-panel
      CS2_CONTAINER_NAME:   ${CONTAINER_NAME:-cs2ze-server}
      CS2_SERVICE_NAME:     cs2-server
      PANEL_RCON_HOST:      cs2-server          # over cs2ze_default, no host port needed
      PANEL_RCON_PORT:      ${CS2_RCON_PORT:-27050}
      PANEL_DATA_DIR:       /data
      PANEL_CS2_DATA_DIR:   /srv/cs2-data
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - type: bind
        source: ${CS2ZE_PROJECT_DIR:-${PWD}}
        target: ${CS2ZE_PROJECT_DIR:-${PWD}}     # identical path — see below
      - type: bind
        source: ${CS2_DATA_PATH:-./cs2-data}
        target: /srv/cs2-data
        read_only: true
      - type: bind
        source: ${PANEL_DATA_PATH:-./panel-data}
        target: /data
    ports:
      - "${PANEL_PUBLISHED_PORT:-8090}:8090"
    healthcheck:
      test: ["CMD","node","-e","fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      start_period: 15s
```

`prepare-data` gains `./panel-data` as a second mount and chowns it to `1000:1000`, because Compose creates a
missing bind source **root-owned**, which would break the panel on a fresh clone.

### The identical-path mount, and why

Bind-mount sources in `compose.yaml` resolve as **host** paths. For the panel to run
`docker compose up -d --force-recreate cs2-server` against the host daemon, the project directory must sit at
the same path inside the panel; otherwise `./cs2-data` resolves to a directory the daemon can't see and the
server boots without mods.

`project.ts` runs before Fastify listens and **proves** the path rather than trusting config:
1. `docker inspect $CS2_CONTAINER_NAME` → read `com.docker.compose.project`, `.project.working_dir`,
   `.project.config_files` (all three confirmed present on your running container).
2. Assert every `config_files` path is readable **inside the container at that same absolute path** — a
   successful read at the host path *is* proof the identical-path mount is in place.
3. Assert `working_dir` is writable and `${working_dir}/.env` exists.
4. On failure: refuse to serve the API, `/api/health` returns a structured `setupError`, and the SPA renders a
   full-screen diagnostic with expected vs actual paths. No silent corruption.
5. Every compose call is then fully explicit:
   `docker compose --project-name <p> --project-directory <working_dir> -f <config_file> <verb> cs2-server`
   with `cwd: working_dir`.

Compose v5.5.1 was verified to support the nested default `${CS2ZE_PROJECT_DIR:-${PWD}}`, so this needs no
`.env` entry; `CS2ZE_PROJECT_DIR` remains available as an explicit override.

### Docker CLI, not the Engine API

- Compose is a **client-side** concept — the Engine API has no "compose up". Recreating `cs2-server` with new
  `env_file` values via the raw API means reimplementing container-spec diffing, label sets, network attach and
  dependency ordering, and would orphan the compose project's state.
- Host is Docker 29.8.0 / Compose 5.5.1. `dockerode` pins API versions and breaks against very new daemons; the
  CLI negotiates automatically.
- The CLI hides the `Tty=true` raw-vs-multiplexed log stream branch.

So the runtime stage copies `docker` and the `docker-compose` plugin from the official `docker:cli` image, and
every call goes through `execFile('docker', argvArray, {cwd, timeout, maxBuffer})` — never a shell, never string
concatenation.

**Hard rules in `compose.ts`, enforced by assertion, not convention:** every verb must name a service; a bare
`up` is refused; `down` is refused entirely. Both would kill the panel mid-request. The UI exposes three
visibly distinct buttons because the difference is otherwise invisible: **Stop** (`compose stop`), **Restart**
(`compose restart`, does *not* re-read `.env`), **Apply & Restart** (`compose up -d --force-recreate`, does).
A process-wide mutex allows one lifecycle op at a time.

### Risks to accept, stated plainly

The panel holds the Docker socket (root-equivalent on the host) and the RCON password, and per your choice it's
published on all interfaces over plain HTTP on 8090. Anyone who reaches 8090 and gets past login owns the host.
I'll ship it exactly as you asked, with `PANEL_BIND_ADDR` available in `.env` (default empty = all interfaces)
and a README note about fronting it with TLS or firewalling the port. No other behaviour change.

---

## Apply model: hot-reload vs restart

Every config edit writes **both** the git-tracked `config/` source (survives restarts, since `install-mods.sh`
re-copies it each boot) *and* the live game-tree copy, through one `writeManagedConfig()` helper. Writing only
one is the easiest way to produce confusing drift.

| Change | Written to | Hot-reload | Restart? |
|---|---|---|---|
| Maps: add/remove/enable, cooldown, min/max players, groups | `config/cs2fixes/maplist.jsonc` | `c_reload_map_list` — **⚠ also reloads the current map**; confirm-gated, with "defer to next map change" offered | No |
| Admins: add/remove/toggle, flags, groups, immunity | `config/cs2fixes/admins.jsonc` | `c_reload_admins` | **No** |
| Cvar whitelist | `config/cs2fixes/cvar_whitelist.jsonc` | `c_cvarwhitelist_reload` | No |
| Discord bots | `config/cs2fixes/discordbots.jsonc` | `c_reload_discord_bots` | No |
| Set next map / change map / extend / end round | — | `c_setnextmap`, `c_map`, `c_extend`, `c_endround` | No |
| Moderation, ZE actions (`c_kick`…`c_infect`, `c_mz`, `c_zclass`) | — | `c_*` | No |
| Cvar-backed `.env` keys (`ZE_*`, `ZR_*`, `CS2FIXES_*`, `MAM_*`, `CS2_SERVERNAME`, `CS2_PW`) | `.env` | **push the cvar over RCON immediately** — persists *and* applies now | **No** |
| ZR `playerclass.jsonc` / `weapons.cfg` / `hitgroups.cfg` | `config/cs2fixes/zr/` | no reload command exists | **Yes** |
| Per-map cfg, Stripper cfg | `config/cs2fixes/maps/`, `config/stripper/` | only copied at boot | **Yes**, then on map load |
| `CS2_RCONPW`, `SRCDS_TOKEN`, `CS2_MAXPLAYERS`, ports, image, `INSTALL_*`, `*_VERSION` | `.env` | none | **Yes** (recreate) |

The **apply-live** path is the biggest UX win here: for every `.env` key carrying a `cvar` in `env-schema.ts`,
saving writes `.env` *and* sets the cvar in the same request, showing an "applied live" pill instead of a
pending-restart entry. Verified working over RCON for `mp_timelimit`, `zr_knockback_scale` and `hostname`; the
CS2Fixes cvar whitelist constrains only *map*-initiated changes, not RCON.

### Pending-restart is computed statelessly

No dirty flag to get out of sync. `drift.ts` does two exact comparisons:
- **Env drift**: `docker inspect --format '{{json .Config.Env}}'` gives the env baked in at container-create
  time; diff against the current parse of `.env`. Correct even if you edited `.env` over ssh, and survives a
  panel restart.
- **Config drift**: `mtime` of each `config/**` file vs `.State.StartedAt`, cross-checked by content hash
  against the live copy under `/srv/cs2-data`.

A sticky `PendingRestartBanner` shows the count, a **Review** sheet with each key old→new, and **Apply &
Restart**, which streams the job's output so you watch SteamCMD and the `[cs2ze]` installer lines live.

---

## Backend

Fastify 5 + `fastify-type-provider-zod` (reuses `shared/` schemas as route schemas) + `@fastify/static` serving
`web/dist` with SPA fallback. Single origin, no CORS.

### RCON client

Packet: `int32 size | int32 id | int32 type | body\0 | \0`. Implementation details that came out of live probing:

- **Auth expects exactly one reply packet** (`id === 1` ok, `id === -1` failed). Don't wait for two. On failure
  do not retry immediately — `sv_rcon_maxfailures` will ban the IP.
- **Frame off the length prefix only.** A single frame was 694 KB. Cap total accumulation at 8 MB → destroy the
  socket and error, rather than growing unbounded.
- **Sentinel for end-of-response**: send `EXECCOMMAND(id, cmd)` then `EXECCOMMAND(id+1, "")`; the echo of the
  second id marks the end. Idle-timeout as fallback.
- **Strictly serialized queue**, one in-flight command per connection; RCON has no interleaving guarantees.
- Reconnect with 1s→30s backoff; CS2 drops RCON across map changes, so treat `ECONNRESET` as normal.
- Password re-read from `.env` on every connect, so changing `CS2_RCONPW` via the panel works without
  restarting the panel. It never reaches the browser.
- `sanitize.ts` strips chat-color control bytes while preserving tabs/newlines, strips ANSI, and normalizes
  `\r\n|\r` → `\n`.

### File editors

- **`maplist.jsonc` / `admins.jsonc` / `discordbots.jsonc`** — panel-owned and small; regenerate with
  `JSON.stringify(obj, null, 2)` plus a generated header, validated against the zod schema before and after.
- **`cvar_whitelist.jsonc`** — 563 lines that are mostly hand-written explanatory comments. `JSON.parse`
  round-tripping destroys all of them. Use **`jsonc-parser`** `modify()` + `applyEdits()` for surgical per-key
  edits preserving every comment and the tab indentation. This is the sole reason to pick it over `json5`.
- **`weapons.cfg` / `hitgroups.cfg`** — Valve KeyValues; parse with `@node-steam/vdf` for the structured editor,
  regenerate from a template on write, plus a raw mode with parse validation.
- **`.env`** — hand-written ~120-line editor (`dotenv` discards comments; `envfile` mangles formatting). Index
  lines by regex, splice only the value capture group, so comments/ordering/unknown keys survive by
  construction. Write via tmpfile + `rename` in the same directory (atomic — works because we mount the
  *directory*, not the file; a single-file bind mount would leave the container on a stale inode).

Three `.env` value traps, all enforced in `shared/validators.ts`:
1. This file is both the Compose interpolation source and the `env_file`, so a literal `$` triggers
   interpolation. Reject `$`, backticks and newlines with a clear error rather than guessing an escape.
2. The README's `/` → `\/` rule (the base image's sed-based templating). Auto-escape on write and un-escape on
   read for the base-image `CS2_*` keys, so you type a normal URL.
3. Values with spaces stay unquoted, matching the existing `CS2_SERVERNAME=CS2 Zombie Escape` style.

`safe-write.ts` gates every write: `realpath` must land inside `${projectDir}/config/` or be exactly
`${projectDir}/.env`; backup first; atomic rename; audit entry. `compose.yaml` and `install-mods.sh` are **not**
panel-editable despite the rw mount. `cs2-data` is mounted **read-only** so the panel physically cannot edit the
generated files that boot overwrites — a whole class of "why did my change vanish?" bugs removed at the kernel
level.

Backups land at `panel-data/backups/<encoded-relpath>/<ISO8601>-<sha8>.bak`, newest 50 retained per file;
restore writes back through the same path (so restoring is itself backed up).

### Log streaming — SSE, not WebSocket

Flow is one-directional; the interactive part (`POST /api/rcon/exec`) is a plain request/response. The deciding
factor: `EventSource` can't set headers, but our auth is a **cookie**, which it sends automatically — SSE plus
cookie auth is zero extra work, whereas WebSocket needs a whole second auth path. Set `Cache-Control: no-cache`,
`X-Accel-Buffering: no`, and a 20 s keepalive comment.

Two sources: **`docker`** (default) via `docker logs -f --tail N` — the only place `[cs2ze]` installer output,
SteamCMD progress and Metamod errors appear, which is exactly what you need when a boot fails; always pass
`--tail` since there's no rotation limit configured. And **`game`**, tailing the newest
`/srv/cs2-data/game/csgo/logs/*.log` with `fs.watch` to detect rotation and re-open. Both share the sanitizer,
keep a 2000-line ring buffer for instant backfill, and cap 5 concurrent streams per session with child-process
cleanup on request close.

### Routes

```
GET  /api/health                     (unauth; includes preflight setupError)
POST /api/auth/login|logout|password        GET /api/auth/me
GET  /api/server/status              POST /api/server/{start,stop,restart,apply,pull} → jobId
GET  /api/jobs  /api/jobs/:id  /api/jobs/:id/stream (SSE)
GET  /api/logs/stream?source=docker|game&tail=500 (SSE)   GET /api/logs/files[/:name]
POST /api/rcon/exec                  GET /api/rcon/status
GET/PUT/POST/PATCH/DELETE /api/maps[/:name]   GET/PUT /api/maps/groups
POST /api/maps/reload {confirmMapRestart}   POST /api/maps/current   POST /api/maps/next
GET  /api/workshop/:id   /api/workshop/collection/:id
GET/PUT/POST/PATCH/DELETE /api/admins[/:steamid64]   GET/PUT /api/admins/groups
POST /api/admins/reload              POST /api/admins/migrate-env-steamid   ⭐
GET  /api/env   PATCH /api/env {changes, applyLive}   POST /api/env/validate   GET /api/env/schema
GET  /api/drift                      ⭐ pending-restart
GET  /api/config/{files,file,effective,diff,backups}   PUT /api/config/file   POST /api/config/restore
GET/PUT /api/zr/{classes,weapons,hitgroups}
GET  /api/players   POST /api/players/:id/:action
GET  /api/audit
```

---

## Auth

- **Store**: `node:sqlite` (built into Node ≥22). Deliberately **not** `better-sqlite3` — a native module needing
  a compiler in the build image and a rebuild on every Node bump.
- **Hashing**: built-in `crypto.scrypt` (N=2^16, r=8, p=1, 32-byte salt), stored as
  `scrypt$N$r$p$salt$hash`, verified with `timingSafeEqual`. OWASP-approved, zero dependencies. Avoids the
  `argon2` node-gyp build.
- **Sessions**: 32 random bytes as cookie `cs2ze_sid`; **SHA-256 stored** so a DB leak yields no live sessions.
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=30d`, `Secure` gated on `PANEL_COOKIE_SECURE` (default off, since
  you're on plain HTTP). Sliding expiry refreshed at most hourly.
- **CSRF**: `SameSite=Strict` plus a per-session token required in `X-CS2ZE-CSRF` on every non-GET, and
  rejection of cross-origin `Sec-Fetch-Site`. Belt and braces — this thing restarts a game server.
- **Rate limiting**: sqlite-persisted (survives panel restart), keyed by IP *and* username: 5 failures → 30 s,
  doubling to a 15 min cap; plus 300 req/min/IP globally. Always run a dummy scrypt on unknown users to prevent
  enumeration by timing.
- **Bootstrap**: if `PANEL_ADMIN_USER`/`PANEL_ADMIN_PASSWORD` are set in `.env`, seed from those and log a
  reminder to clear the password. Otherwise generate a 24-char random password, create `admin`, and print it to
  stdout (`docker compose logs cs2-panel`). Either way `must_change_password` forces a change at first login.
  **No hardcoded default password.**
- **Roles**: `owner` (everything, including raw RCON and revealing secrets) and `operator` (maps, admins,
  players, logs, start/stop; no raw console, no secret reveal). Two roles is the right amount here.
- **Secrets** (`CS2_RCONPW`, `SRCDS_TOKEN`, `CS2_PW`, `TV_PW`, `TV_RELAY_PW`) return `null` + `hasValue: true`;
  an owner-only audited `GET /api/env/reveal/:key` returns plaintext.

---

## Safety and validation

`shared/src/compat.ts` is a literal port of `check_known_compatibility()`, since `install-mods.sh` is fail-closed
and a bad `.env` written from the UI would brick the server on next boot:

```
build = METAMOD_VERSION.split('git').pop()
!/^\d+$/.test(build)                                        → WARNING (matches the script's non-fatal path)
INSTALL_CS2FIXES && CS2FIXES_VERSION==='v1.20.1' && build>1411   → ERROR
INSTALL_MULTIADDONMANAGER && MAM==='v1.6' && build<=1459          → ERROR
INSTALL_STRIPPERCS2 && STRIPPER==='v2.0' && build<1461            → ERROR
!INSTALL_METAMOD && (any plugin enabled)                          → ERROR
CS2_ADMIN_STEAMID  '' or /^\d{17}$/                               → ERROR otherwise
CS2_ADMIN_FLAGS    /^[a-z]*$/                                     → ERROR otherwise
```

Enforced in **three layers**: client (zodResolver, Save disabled), server (`PATCH /api/env` rejects before
anything touches disk), and a **pre-apply gate** — `POST /api/server/apply` re-validates the current on-disk
`.env` and refuses to run compose if it wouldn't boot. That third layer catches a hand edit made over ssh, and
reuses the script's own wording so it's greppable against container logs.

Also validated: map name `/^[A-Za-z0-9_\-]{1,64}$/`, positive-int workshop IDs, `CS2FIXES_EXTRA_CFG` segments,
comma-separated numeric `MAM_*` addon IDs, port ranges with collision checks against the project's other
published ports, and numeric ranges for `ZE_*`/`ZR_*`/`CS2FIXES_RTV_SUCCESS_RATIO`.

### The `CS2_ADMIN_STEAMID` trap

`configure_admin` runs **after** `sync_managed_configs`, so a non-empty `CS2_ADMIN_STEAMID` silently overwrites
`admins.jsonc` with a single-admin file on every boot — quietly deleting everything the panel wrote. It's empty
on your server today, so the happy path is clean, but the panel must not let you walk into it.

- `GET /api/admins` returns `envOverrideActive`. The Admins page then renders a blocking destructive alert and
  disables every mutating control behind it.
- One button, **Migrate to admins.jsonc**, atomically: upserts the owner into `config/cs2fixes/admins.jsonc`
  (flags from `CS2_ADMIN_FLAGS`, immunity 100), drops the shipped `"0": "Unconfigured placeholder"` entry, sets
  `CS2_ADMIN_STEAMID=` in `.env`, audits. Both files are backed up first and step 1 rolls back if step 3 fails.
- `PATCH /api/env` refuses to set `CS2_ADMIN_STEAMID` non-empty once the panel owns `admins.jsonc`.

### One upstream fix the panel needs

`sync_managed_configs` uses `cp -a config/cs2fixes/maps/. → cfg/cs2fixes/maps/` and the Stripper equivalent,
which are **additive — they never delete**. So deleting a per-map cfg in the panel would leave a stale copy
running forever, and the UI would be lying about what's active. Change those two copies to delete-then-copy (or
`rsync -a --delete`) so `config/` is genuinely authoritative. Small, contained, and flagged clearly in the diff
since it changes existing behaviour.

---

## Frontend

Vite + React 19 + TypeScript, TanStack Router (file-based, typed) + TanStack Query (SSE events invalidate
queries), react-hook-form + zodResolver on the `shared/` schemas, shadcn/ui on Tailwind v4, `sonner` toasts,
`lucide-react`, and `@uiw/react-codemirror` for raw editors (CodeMirror 6 over Monaco: a fraction of the bundle,
and JSONC highlighting is all that's needed).

| Route | Purpose | shadcn components |
|---|---|---|
| `/login` | auth | Card, Input, Label, Button, Alert, Form |
| `/` Dashboard | status, uptime, players, current/next map, timeleft, plugin versions, disk usage, quick actions, live tail | Card, Badge, Button, Separator, Skeleton, Progress, AlertDialog, Tooltip, ScrollArea |
| `/maps` | catalog CRUD, enable toggles, groups, change/next map | DataTable (Table + TanStack Table), Switch, Dialog (add by workshop ID), Command, Select, Badge, Slider, AlertDialog (reload warning), DropdownMenu |
| `/admins` | admins + groups + flag grid | Table, Dialog, Checkbox grid for a–n/z with labels, Badge, Alert (env trap), HoverCard (flag meanings) |
| `/players` | live roster + moderation | Table, DropdownMenu, AlertDialog, Input (reason), Avatar |
| `/settings` | grouped `.env` editor | Tabs (Server / Ports / Gameplay / ZombieReborn / Voting / Mods & Versions / CSTV / Logging / Danger), Form, Switch, Slider, Select, Accordion, sticky footer with Save/Discard/diff count |
| `/logs` | dual-source live tail | Tabs (Container / Game), ScrollArea, Input (filter), Toggle (follow), Badge |
| `/console` | raw RCON, owner only | Command (autocomplete from the cached `cvarlist` dump), ScrollArea, Input |
| `/advanced` | file editors, `config/` ⇄ live diff, backups, users, audit | Tabs, Accordion, Sheet (diff), CodeMirror, Table, AlertDialog |

Global chrome: persistent Sidebar plus the `PendingRestartBanner` above every route.

### Theme: `#ffcccb`

`#ffcccb` has relative luminance 0.6875 — **1.42:1 against white** (fails everything) and **14.75:1 against
black** (excellent). So it is a *fill* color that demands dark foreground; it must never be text on a light
surface, and never sit under white text. Any "pink button, white label" mockup has to be rejected.

It sits naturally at the 200 step of an `hsl(1 …)` ramp, so the ramp is built around it:
`50 hsl(1 100% 97%)` · `100 hsl(1 100% 94%)` · **`200 #ffcccb`** · `300 hsl(1 95% 82%)` · `500 hsl(1 75% 60%)` ·
`600 hsl(1 60% 45%)` · `700 hsl(1 55% 36%)` · `950 hsl(1 65% 12%)`.

- **Dark mode (shipped default)** — background `hsl(345 12% 7%)`, `--primary: #ffcccb` with
  `--primary-foreground: hsl(1 65% 12%)` → 13.8:1. This is where the colour genuinely shines: pink primary
  buttons, pink focus rings, pink chart strokes. `--brand-text: #ffcccb` is safe here.
- **Light mode** — `--primary` stays the literal `#ffcccb` with `hsl(1 65% 12%)` foreground (12.9:1 inside the
  button) **plus `--primary-border: hsl(1 55% 58%)`**, which is 3.1:1 against white. That border is the fix for
  the 1.42:1 button-vs-card problem; without it light-mode primary buttons visually dissolve into the card.
  Pink *text* uses `--brand-text: hsl(1 55% 36%)` (~5.5:1), never `--primary`. `--ring: hsl(1 60% 45%)`.
- **`--destructive` is hue-shifted to 352° and darkened** (`hsl(352 78% 38%)`, white text). A pale pink brand
  beside a normal red destructive reads as two shades of the same thing; making destructive dark+saturated
  against brand pale+light keeps them unambiguous. Never a pale-pink Delete button.
- **Charts**: `hsl(1 75% 60%)`, `hsl(28 80% 55%)`, `hsl(200 60% 50%)`, `hsl(152 45% 45%)`, `hsl(280 45% 60%)` —
  brand anchors series 1, the rest are hue-separated so they survive greyscale and deuteranopia.

---

## Build order

1. **Skeleton + auth.** Workspaces, Dockerfile, compose service, `prepare-data` extension, `node:sqlite`,
   scrypt, sessions, rate limit, CSRF, bootstrap password. Vite + shadcn + the `#ffcccb` token block, `/login`,
   dashboard shell. *Gate: log in, change password.*
2. **Docker control.** `project.ts` preflight (highest-risk piece — build it early so failures surface),
   `cli.ts`, `compose.ts` with the no-bare-`up`/no-`down` assertions, jobs + SSE, lifecycle routes and buttons.
   *Gate: stop and start the real server from the browser; panel survives.*
3. **RCON + logs.** Protocol/client (single auth packet, length-prefix framing, 8 MB cap, sentinel), sanitizers,
   `status`/`c_who` parsers, both SSE log sources, `/logs` and `/console`. *Gate: `cvarlist` returns intact;
   live tail shows `[cs2ze]` lines during a restart.*
4. **`.env` settings.** `dotenv-edit`, `env-schema` (~110 keys), `compat`, `drift`, three-layer validation,
   apply-live, `/settings`, `PendingRestartBanner`. *Gate: set `METAMOD_VERSION=2.0.0-git1500` and confirm all
   three layers block it.*
5. **Maps + admins.** Editors, `safe-write` + backups, workshop lookup, confirm-gated `c_reload_map_list`, the
   `CS2_ADMIN_STEAMID` migration, `/players` moderation.
6. **Advanced.** `jsonc-parser` cvar whitelist, ZR editors, per-map/Stripper editors (plus the
   `install-mods.sh` delete fix), `config/` ⇄ live diff, backups/restore, users, audit.
7. **Polish + docs.** Theme toggle, README panel section, `.env.example`, `.gitignore`, empty/error/loading
   states, accessibility pass.

---

## Verification

**Local:** `docker compose build cs2-panel && docker compose up -d cs2-panel`, open `http://localhost:8090`.
Drive the UI with the `preview_*` MCP tools and screenshot every page in both themes to confirm the `#ffcccb`
mapping is legible — specifically that the light-mode primary button has a visible edge.

**On `stella-server`** (deploy and verify; no CS2 restart without your approval):

1. Set `DOCKER_GID` from `getent group docker` (expect 983). `docker compose config --quiet` to prove the new
   compose file parses before anything runs.
2. `docker compose up -d --build cs2-panel`, then confirm `docker inspect -f '{{.State.StartedAt}}' cs2ze-server`
   is **unchanged** — the panel must not disturb the running server.
3. `curl -s localhost:8090/api/health` → `setupError: null`, `workingDir: /home/stella/cs2ze-docker`. Then
   deliberately break the mount target, confirm it fails **loudly** with the diagnostic, and revert.
4. Log in, change the bootstrap password, confirm a wrong password is rate-limited.
5. Dashboard shows *running*, `ze_winter_warehouse_p`, live `timeleft`, three plugin versions — cross-check
   against `c_timeleft` / `meta list` over ssh.
6. Console: `status` returns parsed output with no `\x01` bytes; `cvarlist` returns ~694 KB intact.
7. `/logs`: watch `[cs2ze]` installer lines stream live.
8. Maps: add a map by workshop ID → `git diff config/cs2fixes/maplist.jsonc` shows the panel's write, the live
   copy matches, a backup exists, and the confirm dialog for `c_reload_map_list` correctly warns about the map
   restart.
9. Admins: add a test SteamID64, reload, confirm `docker logs cs2ze-server | grep -i admin` prints it; remove.
10. Settings: change `ZE_ROUND_TIME` with apply-live → cvar changes over RCON, `.env` persisted, **no** banner.
    Then change `CS2_MAXPLAYERS` → banner appears, nothing auto-restarts. The actual recreate waits for your go.
11. Hand-edit `METAMOD_VERSION` to an incompatible build over ssh, click Apply & Restart, confirm the pre-apply
    gate refuses **before** running compose, with the script's own wording.
12. `grep -rn "'down'" panel/server/src/docker/` returns nothing; panel container still running after all of the
    above; `/api/audit` lists every action.
