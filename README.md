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
Metamod entry in `gameinfo.gi`, writes the environment-managed plugin settings,
and starts CS2. Existing plugin configuration files and Stripper map files are
preserved across mod updates.

## Start

Requirements: Docker Engine with Compose v2, 2 CPU cores, at least 2 GiB RAM,
and at least 60 GB free disk space (more for workshop content).

1. Edit `.env`.
2. Set `SRCDS_TOKEN` for an Internet server and replace `CS2_RCONPW`.
3. Optionally set a workshop start map/collection and MultiAddonManager IDs.
4. Start the server:

   ```sh
   docker compose up -d
   ```

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

All container, port, CS2, version, ZombieReborn, and MultiAddonManager settings
are in `.env`. `.env.example` is the version-controlled template.

If a CS2 value contains `/`, escape it as `\/` as required by the base image's
configuration replacement logic.

Useful entries:

- `CS2_HOST_WORKSHOP_MAP`: workshop ID to start directly.
- `CS2_HOST_WORKSHOP_COLLECTION`: collection to download.
- `MAM_EXTRA_ADDONS`: comma-separated server/client workshop addon IDs.
- `MAM_CLIENT_EXTRA_ADDONS`: comma-separated client-only addon IDs.
- `CS2FIXES_EXTRA_CFG`: semicolon-separated extra CS2Fixes/ZR cvar lines.
- `MODS_FORCE_REINSTALL=1`: download all enabled mod archives again on the next
  start. Put it back to `0` afterward.

Advanced config files remain directly editable in the persistent data directory:

- `cs2-data/game/csgo/cfg/cs2fixes/cs2fixes.cfg`
- `cs2-data/game/csgo/addons/cs2fixes/configs/zr/`
- `cs2-data/game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`
- `cs2-data/game/csgo/addons/StripperCS2/maps/`

The installer only replaces its block between `BEGIN CS2ZE MANAGED` and
`END CS2ZE MANAGED`; it preserves other edits.

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
# Stop (keeps ./cs2-data)
docker compose down

# Restart after changing .env
docker compose up -d --force-recreate

# Pull a newer base image
docker compose pull cs2-server
docker compose up -d
```

Do not delete `./cs2-data` unless you intend to remove the server installation,
downloaded workshop content, logs, and plugin configuration.
