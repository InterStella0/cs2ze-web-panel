# CS2 Zombie Escape Docker

One Compose stack for:

```text
joedwards32/cs2
  -> persistent ./cs2-data
  -> Metamod:Source
     -> CS2Fixes (including ZombieReborn)
     -> MultiAddonManager
     -> StripperCS2
```

The server updates through SteamCMD on every container start. After that update,
the mounted `pre.sh` hook installs or updates the pinned mod archives, repairs the
Metamod entry in `gameinfo.gi`, installs the persistent ZE runtime configs,
writes the environment-managed settings, and starts CS2.

## Start

Requirements: Docker Engine with Compose v2, 2 CPU cores, at least 2 GiB RAM,
and at least 60 GB free disk space (more for workshop content).

Start the complete server with:

```sh
docker compose up -d
```

The checked-in defaults start `ze_winter_warehouse_p` (Workshop ID
`3144617784`) with ZombieReborn, weapons, knockback, flashlights, nominations,
RTV/map voting, and one-player infection testing enabled. They also mount GFL
Zombie Escape Content (Workshop ID `3160448201`) through MultiAddonManager.
The nomination catalog includes `ze_random_p` (`3134108142`) as an alternate.
For a public Internet server, edit `.env` first to set `SRCDS_TOKEN` and replace
`CS2_RCONPW`.

The initial Steam download is large and can take a while. Follow it with:

```sh
docker compose logs -f cs2-server
```

Attach to the local server console (detach with `Ctrl-p`, `Ctrl-q`):

```sh
docker attach cs2ze-server
```

At the console, verify the stack:

```text
meta version
meta list
```

## Configuration

All container, port, CS2, version, ZombieReborn, voting, and
MultiAddonManager settings are in `.env`. `.env.example` is the
version-controlled template. Set `CS2_ADMIN_STEAMID` to your 17-digit SteamID64
to generate an owner admin entry automatically.

If a CS2 value contains `/`, escape it as `\/` as required by the base image's
configuration replacement logic.

Useful entries:

- `CS2_HOST_WORKSHOP_MAP`: workshop map ID to start directly. The default is
  `ze_winter_warehouse_p` (`3144617784`).
- `CS2_HOST_WORKSHOP_COLLECTION`: bootstrap collection passed to
  `host_workshop_collection` on startup. CS2Fixes intercepts this command and
  replaces the collection with `maplist.jsonc`; do not leave it blank while map
  voting is enabled. Keep bootstrap collections below 100 maps.
- `MAM_EXTRA_ADDONS`: comma-separated server/client workshop content addon IDs.
  `3160448201` is a content pack, not a playable map ID, so it belongs here.
- `CS2_ADDITIONAL_ARGS`: arguments passed to the CS2 process by the base image.
  Defaults to `-disable_workshop_command_filtering`, which allows CS2Fixes to
  intercept the startup collection command. (`STARTUP_ARGS` is not consumed by
  `joedwards32/cs2`.)
- `MAM_CLIENT_EXTRA_ADDONS`: comma-separated client-only addon IDs.
- `CS2FIXES_EXTRA_CFG`: semicolon-separated extra CS2Fixes/ZR cvar lines.
- `ZE_BUY_TIME` and `ZE_BUY_ANYWHERE`: default to an effectively unlimited
  buy period from anywhere on the map.
- `ZE_WEAPON_BUY_LIMIT`: `-1` allows unlimited purchases of non-grenade
  weapons. `ZE_GRENADE_BUY_LIMIT` remains `2`; CS2Fixes uses it as the
  per-grenade purchase cap, while the same value caps carried grenades.
- `MODS_FORCE_REINSTALL=1`: download all enabled mod archives again on the next
  start. Put it back to `0` afterward.

Structured config defaults are version-controlled under `config/`. On first
start, `prepare-data` copies them into the ignored `server-config/` runtime
directory. The panel edits `server-config/`, and the installer copies that
runtime directory into the game tree on every server start. Existing runtime
files are never replaced by newer Git defaults, so `git pull` cannot overwrite
panel or operator settings.

- `server-config/cs2fixes/maplist.jsonc`: nomination and map-vote catalog.
- `server-config/cs2fixes/cvar_whitelist.jsonc`: safe map cvars.
- `server-config/cs2fixes/admins.jsonc`: harmless fallback when no owner ID is set.
- `server-config/cs2fixes/zr/`: human/zombie classes, weapons, and hitgroups.
- `server-config/cs2fixes/maps/`: optional per-map CS2Fixes cfg files.
- `server-config/stripper/`: optional per-map StripperCS2 files.

Edit the runtime files (directly or through the panel), then run
`docker compose up -d --force-recreate`. To adopt a changed repository default,
copy that specific file from `config/` into `server-config/` intentionally.
Generated destinations are:

- `cs2-data/game/csgo/cfg/cs2fixes/cs2fixes.cfg`
- `cs2-data/game/csgo/addons/cs2fixes/configs/maplist.jsonc`
- `cs2-data/game/csgo/addons/cs2fixes/configs/zr/`
- `cs2-data/game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`
- `cs2-data/game/csgo/addons/StripperCS2/maps/`

The installer only replaces its block between `BEGIN CS2ZE MANAGED` and
`END CS2ZE MANAGED` in `cs2fixes.cfg`. It deliberately replaces the structured
files above and `cfg/cs2fixes/server.cfg` from `server-config/`/`.env`, so the
configuration cannot drift between rebuilds.

Player chat commands include `!guns`, `!zclass`, `!flashlight` (or the flashlight
key), `!nominate`, and `!rtv`. `!nom` is not a CS2Fixes command.

The Maps page validates `maplist.jsonc` before writing it. After a manual edit,
watch `docker compose logs cs2-server` for `Failed parsing JSON` and use the
Maps page's reload action (equivalent to the root-admin `!reload_map_list`
command) to force CS2Fixes to parse and download the configured catalog again.

## Version compatibility

As of 2026-09-15, the current upstream releases cannot all use the newest
Metamod build together:

- CS2Fixes v1.20.1 requires Metamod 2.0 build 1411 or earlier.
- MultiAddonManager v1.6 requires a build newer than 1459.
- StripperCS2 v2.0 requires build 1461 or later.

The defaults therefore use the newest mutually compatible release set known at
that date: Metamod build 1411, CS2Fixes v1.20.1, MultiAddonManager v1.5.4, and
StripperCS2 v1.1.3. Versions and full download URL overrides are exposed in
`.env`, but upgrade the set together after checking each release's requirements.

For a newer Linux host/runtime, switch both `CS2FIXES_RUNTIME` and
`MULTIADDONMANAGER_RUNTIME` to `steamrt4` only if the base CS2 image also uses a
compatible Steam Runtime.

## Operations

```sh
# Stop, including with -v (keeps both bind-mounted directories)
docker compose down
docker compose down -v

# Restart after changing .env
docker compose up -d --force-recreate

# Pull a newer base image
docker compose pull cs2-server
docker compose up -d
```

### Deploying code updates to a running server

`server-config/`, `cs2-data/`, `panel-data/`, and `.env` are persistent live
server state. `config/` is source-controlled defaults and should be deployed
with the code. Exclude the live state when syncing a checkout:

```sh
rsync -a --delete \
  --exclude 'cs2-data/' --exclude 'panel-data/' \
  --exclude 'server-config/' --exclude '.env' \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' \
  ./ user@host:/path/to/cs2ze-docker/
```

If `server-config/` and the copy in the game tree ever diverge, the panel's Maps
and Admins pages flag it as out of sync and a save re-copies the runtime source
over it.

This stack declares no Docker named volumes. `./cs2-data`, `./server-config`,
and `./panel-data` are host bind mounts, so `docker compose down -v` cannot
delete them. Do not manually delete `./cs2-data` unless you intend to remove the
server installation, downloaded workshop content, and logs.
