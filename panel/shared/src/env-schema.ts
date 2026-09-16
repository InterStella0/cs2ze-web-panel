/**
 * Typed description of every key in .env.
 *
 * `cvar` marks a key whose value can also be pushed to the running server over
 * RCON, so saving it applies immediately AND persists for the next boot. Keys
 * with `restartRequired` have no live equivalent and feed the pending-restart
 * banner instead.
 */

export type EnvGroup =
  | "server"
  | "network"
  | "gameplay"
  | "zombiereborn"
  | "voting"
  | "bots"
  | "cstv"
  | "logging"
  | "mods"
  | "addons"
  | "admin"
  | "docker";

export const ENV_GROUP_LABELS: Record<EnvGroup, string> = {
  server: "Server",
  network: "Network & Ports",
  gameplay: "Gameplay",
  zombiereborn: "ZombieReborn",
  voting: "Voting & RTV",
  bots: "Bots",
  cstv: "CSTV",
  logging: "Logging",
  mods: "Mods & Versions",
  addons: "Workshop Addons",
  admin: "Admin",
  docker: "Docker & Paths",
};

export type EnvValueType = "string" | "number" | "float" | "boolean01" | "select" | "password";

export interface EnvKeySpec {
  key: string;
  group: EnvGroup;
  label: string;
  description?: string;
  type: EnvValueType;
  default: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** Cvar to set over RCON so the change applies without a restart. */
  cvar?: string;
  /** Quote the value when setting the cvar (needed for strings with spaces). */
  cvarQuote?: boolean;
  /** Further cvars that take the same value when the key is applied live. */
  extraCvars?: string[];
  /** No live equivalent: changing this needs `up -d --force-recreate`. */
  restartRequired?: boolean;
  /** Never returned in plaintext to the browser. */
  secret?: boolean;
  /** The panel owns this key; render read-only with an explanation. */
  panelManaged?: boolean;
  /** Base image substitutes this with sed, so `/` must be stored as `\/`. */
  slashEscaped?: boolean;
  /** Hidden behind the Advanced page. */
  advanced?: boolean;
  placeholder?: string;
}

const b = (
  key: string,
  group: EnvGroup,
  label: string,
  cvar: string | undefined,
  def: string,
  description?: string,
): EnvKeySpec => ({ key, group, label, type: "boolean01", default: def, cvar, description });

export const ENV_SCHEMA: EnvKeySpec[] = [
  // ---- Docker & paths (all require a recreate) -----------------------------
  { key: "COMPOSE_PROJECT_NAME", group: "docker", label: "Compose project name", type: "string", default: "cs2ze", restartRequired: true, advanced: true },
  { key: "CONTAINER_NAME", group: "docker", label: "Container name", type: "string", default: "cs2ze-server", restartRequired: true, advanced: true },
  { key: "CS2_IMAGE", group: "docker", label: "Base image", type: "string", default: "joedwards32/cs2:latest", restartRequired: true, advanced: true },
  { key: "CS2_DATA_PATH", group: "docker", label: "Data path", type: "string", default: "./cs2-data", restartRequired: true, advanced: true },
  { key: "STOP_GRACE_PERIOD", group: "docker", label: "Stop grace period", type: "string", default: "30s", restartRequired: true, advanced: true },

  // ---- Network -------------------------------------------------------------
  { key: "CS2_PUBLISHED_PORT", group: "network", label: "Published game port", type: "number", default: "27015", min: 1, max: 65535, restartRequired: true },
  { key: "CS2_RCON_PUBLISHED_PORT", group: "network", label: "Published RCON port", type: "number", default: "27050", min: 1, max: 65535, restartRequired: true },
  { key: "TV_PUBLISHED_PORT", group: "network", label: "Published CSTV port", type: "number", default: "27020", min: 1, max: 65535, restartRequired: true },
  { key: "CS2_IP", group: "network", label: "Bind address", type: "string", default: "0.0.0.0", restartRequired: true, advanced: true },
  { key: "CS2_PORT", group: "network", label: "Game port (in container)", type: "number", default: "27015", min: 1, max: 65535, restartRequired: true, advanced: true },
  { key: "CS2_RCON_PORT", group: "network", label: "RCON port (in container)", type: "number", default: "27050", min: 1, max: 65535, restartRequired: true, advanced: true },
  { key: "CS2_LAN", group: "network", label: "LAN mode", type: "boolean01", default: "0", restartRequired: true },
  { key: "SRCDS_TOKEN", group: "network", label: "Game Server Login Token", description: "Required for an Internet server. Create one for app 730 at steamcommunity.com/dev/managegameservers", type: "password", default: "", secret: true, restartRequired: true },

  // ---- Server identity -----------------------------------------------------
  { key: "CS2_SERVERNAME", group: "server", label: "Server name", type: "string", default: "CS2 Zombie Escape", cvar: "hostname", cvarQuote: true },
  { key: "CS2_RCONPW", group: "server", label: "RCON password", type: "password", default: "", secret: true, restartRequired: true, description: "Change this from the shipped default. The panel reads it to talk to the server." },
  { key: "CS2_PW", group: "server", label: "Server password", type: "password", default: "", secret: true, cvar: "sv_password", cvarQuote: true },
  { key: "CS2_MAXPLAYERS", group: "server", label: "Max players", type: "number", default: "32", min: 1, max: 64, restartRequired: true },
  { key: "CS2_CHEATS", group: "server", label: "sv_cheats", type: "boolean01", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_SERVER_HIBERNATE", group: "server", label: "Hibernate when empty", type: "boolean01", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_SERVER_DELTATICKS_ENFORCE", group: "server", label: "Delta ticks enforce", type: "number", default: "2", restartRequired: true, advanced: true },
  { key: "CS2_ADDITIONAL_ARGS", group: "server", label: "Additional srcds args", description: "Extra launch arguments consumed by the joedwards32/cs2 image. Workshop command filtering is disabled by default so CS2Fixes can intercept the startup collection command.", type: "string", default: "-disable_workshop_command_filtering", restartRequired: true, advanced: true },
  { key: "CS2_CFG_URL", group: "server", label: "Remote cfg URL", type: "string", default: "", restartRequired: true, slashEscaped: true, advanced: true },
  { key: "CS2_GAMEALIAS", group: "server", label: "Game alias", type: "string", default: "casual", restartRequired: true, advanced: true },
  { key: "CS2_GAMETYPE", group: "server", label: "Game type", type: "number", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_GAMEMODE", group: "server", label: "Game mode", type: "number", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_MAPGROUP", group: "server", label: "Map group", type: "string", default: "mg_active", restartRequired: true, advanced: true },
  { key: "CS2_STARTMAP", group: "server", label: "Fallback start map", type: "string", default: "de_dust2", restartRequired: true },
  { key: "CS2_HOST_WORKSHOP_MAP", group: "server", label: "Start workshop map", description: "Workshop ID the server boots into.", type: "string", default: "3144617784", restartRequired: true },
  { key: "CS2_HOST_WORKSHOP_COLLECTION", group: "server", label: "Workshop bootstrap collection", description: "Must be non-empty so CS2Fixes can intercept host_workshop_collection and replace it with maplist.jsonc. Use a collection with fewer than 100 maps; this default is the one-map bootstrap collection recommended by the CS2Fixes developer.", type: "string", default: "3222748625", restartRequired: true },
  { key: "DEBUG", group: "server", label: "Debug output", type: "boolean01", default: "0", restartRequired: true, advanced: true },
  { key: "STEAMAPPVALIDATE", group: "server", label: "Validate on update", type: "boolean01", default: "0", restartRequired: true, advanced: true },

  // ---- Bots ----------------------------------------------------------------
  { key: "CS2_BOT_QUOTA", group: "bots", label: "Bot quota", description: "In normal mode this is the bot count. In fill mode it is the target total player count. Server slots still limit how many bots can join.", type: "number", default: "0", min: 0, max: 64, cvar: "bot_quota" },
  { key: "CS2_BOT_QUOTA_MODE", group: "bots", label: "Bot quota mode", description: "normal keeps a fixed bot count; fill adds bots until the quota's total player count is reached; match adds this many bots per human.", type: "select", options: ["normal", "fill", "match"], default: "fill", cvar: "bot_quota_mode" },
  { key: "CS2_BOT_DIFFICULTY", group: "bots", label: "Bot difficulty", description: "0 easy, 1 normal, 2 hard, 3 expert. Leave blank to use the game default.", type: "string", default: "", cvar: "bot_difficulty", advanced: true },

  // ---- Round / map rules (written to cfg/cs2fixes/server.cfg) ---------------
  { key: "ZE_MAP_TIME_LIMIT", group: "gameplay", label: "Map time limit (min)", type: "number", default: "40", min: 0, max: 600, cvar: "mp_timelimit" },
  { key: "ZE_ROUND_TIME", group: "gameplay", label: "Round time (min)", type: "number", default: "60", min: 1, max: 600, cvar: "mp_roundtime" },
  { key: "ZE_FREEZE_TIME", group: "gameplay", label: "Freeze time (s)", type: "number", default: "5", min: 0, max: 120, cvar: "mp_freezetime" },
  { key: "ZE_BUY_TIME", group: "gameplay", label: "Buy time (s)", description: "Defaults to an effectively unlimited buy period for Zombie Escape.", type: "number", default: "9999999", min: 0, max: 2147483647, cvar: "mp_buytime" },
  { key: "ZE_BUY_ANYWHERE", group: "gameplay", label: "Buy anywhere", description: "Allow both teams to buy outside buy zones.", type: "boolean01", default: "1", cvar: "mp_buy_anywhere" },
  { key: "ZE_WEAPON_BUY_LIMIT", group: "gameplay", label: "Weapon purchases per round", description: "Maximum purchases of each non-grenade weapon per round. -1 means unlimited.", type: "number", default: "-1", min: -1, max: 9999, cvar: "mp_weapons_allow_typecount" },
  { key: "ZE_GRENADE_BUY_LIMIT", group: "gameplay", label: "Grenade purchases per round", description: "Maximum purchases of each grenade type per round and maximum grenades carried at once.", type: "number", default: "2", min: 0, max: 99, cvar: "ammo_grenade_limit_default", extraCvars: ["ammo_grenade_limit_total", "ammo_grenade_limit_flashbang"] },
  { key: "ZE_ROUND_MONEY", group: "gameplay", label: "Round start money", description: "Money every player gets at the start of each round. Sets mp_afterroundmoney, mp_maxmoney and mp_startmoney together.", type: "number", default: "16000", min: 0, max: 65535, cvar: "mp_afterroundmoney", extraCvars: ["mp_maxmoney", "mp_startmoney"] },

  // ---- ZombieReborn --------------------------------------------------------
  b("ZR_ENABLE", "zombiereborn", "Enable ZombieReborn", "zr_enable", "1"),
  { key: "ZR_KNOCKBACK_SCALE", group: "zombiereborn", label: "Knockback scale", type: "float", default: "5.0", min: 0, max: 50, step: 0.1, cvar: "zr_knockback_scale" },
  { key: "ZR_INFECT_MIN_COUNT_REQ", group: "zombiereborn", label: "Min players to infect", description: "1 makes first-boot testing work; raise it on a busy public server.", type: "number", default: "1", min: 1, max: 64, cvar: "zr_infect_min_count_req" },
  { key: "ZR_RESPAWN_DELAY", group: "zombiereborn", label: "Respawn delay (s)", type: "float", default: "5.0", min: 0, max: 120, step: 0.5, cvar: "zr_respawn_delay" },

  // ---- CS2Fixes feature toggles -------------------------------------------
  b("CS2FIXES_COMMANDS_ENABLE", "gameplay", "Player commands", "cs2f_commands_enable", "1"),
  b("CS2FIXES_ADMIN_COMMANDS_ENABLE", "gameplay", "Admin commands", "cs2f_admin_commands_enable", "1"),
  b("CS2FIXES_WEAPONS_ENABLE", "gameplay", "Weapon settings", "cs2f_weapons_enable", "1"),
  b("CS2FIXES_STOPSOUND_ENABLE", "gameplay", "Stopsound", "cs2f_stopsound_enable", "1"),
  b("CS2FIXES_NOBLOCK_ENABLE", "gameplay", "Noblock", "cs2f_noblock_enable", "1"),
  b("CS2FIXES_NOBLOCK_GRENADES", "gameplay", "Noblock grenades", "cs2f_noblock_grenades", "1"),
  b("CS2FIXES_BLOCK_TEAM_MESSAGES", "gameplay", "Block team messages", "cs2f_block_team_messages", "1"),
  b("CS2FIXES_MOVEMENT_UNLOCKER_ENABLE", "gameplay", "Movement unlocker", "cs2f_movement_unlocker_enable", "1"),
  b("CS2FIXES_USE_OLD_PUSH", "gameplay", "Old push physics", "cs2f_use_old_push", "1"),
  b("CS2FIXES_HIDE_ENABLE", "gameplay", "Hide players", "cs2f_hide_enable", "1"),
  b("CS2FIXES_TRIGGER_TIMER_ENABLE", "gameplay", "Trigger timers", "cs2f_trigger_timer_enable", "1"),
  b("CS2FIXES_CVARWHITELIST_ENABLE", "gameplay", "Cvar whitelist", "cs2f_cvarwhitelist_enable", "1"),
  b("CS2FIXES_VOTEMANAGER_ENABLE", "voting", "Vote manager", "cs2f_votemanager_enable", "1"),
  b("CS2FIXES_BLOCK_NAV_LOOKUP", "gameplay", "Block nav lookup", "cs2f_block_nav_lookup", "1"),
  b("CS2FIXES_FLASHLIGHT_ENABLE", "gameplay", "Flashlight", "cs2f_flashlight_enable", "1"),
  b("CS2FIXES_FLASHLIGHT_SHADOWS", "gameplay", "Flashlight shadows", "cs2f_flashlight_shadows", "0"),
  b("CS2FIXES_FLASHLIGHT_TRANSMIT_OTHERS", "gameplay", "Flashlight visible to others", "cs2f_flashlight_transmit_others", "1"),
  b("CS2FIXES_INFINITE_RESERVE_AMMO", "gameplay", "Infinite reserve ammo", "cs2f_infinite_reserve_ammo", "1"),
  b("CS2FIXES_FULL_ALLTALK", "gameplay", "Full alltalk", "cs2f_full_alltalk", "1"),
  b("CS2FIXES_PREVENT_USING_PLAYERS", "gameplay", "Prevent +use on players", "cs2f_prevent_using_players", "1"),
  b("CS2FIXES_FIX_GAME_BANS", "gameplay", "Fix game bans", "cs2f_fix_game_bans", "1"),
  { key: "CS2FIXES_FREE_ARMOR", group: "gameplay", label: "Free armor", description: "0 none, 1 kevlar, 2 kevlar + helmet", type: "select", options: ["0", "1", "2"], default: "2", cvar: "cs2f_free_armor" },
  b("CS2FIXES_NOSHAKE_ENABLE", "gameplay", "Noshake", "cs2f_noshake_enable", "1"),
  b("CS2FIXES_BLOCK_MOLOTOV_SELF_DMG", "gameplay", "Block molotov self damage", "cs2f_block_molotov_self_dmg", "1"),
  b("CS2FIXES_FIX_BLOCK_DMG", "gameplay", "Fix block damage", "cs2f_fix_block_dmg", "1"),
  b("CS2FIXES_TOPDEFENDER_ENABLE", "gameplay", "Top defender", "cs2f_topdefender_enable", "1"),

  // ---- Voting --------------------------------------------------------------
  { key: "CS2FIXES_RTV_VOTE_DELAY", group: "voting", label: "RTV delay (s)", type: "number", default: "60", min: 0, max: 3600, cvar: "cs2f_rtv_vote_delay" },
  { key: "CS2FIXES_RTV_SUCCESS_RATIO", group: "voting", label: "RTV success ratio", type: "float", default: "0.60", min: 0, max: 1, step: 0.05, cvar: "cs2f_rtv_success_ratio" },
  { key: "CS2FIXES_EXTENDS", group: "voting", label: "Extends per map", type: "number", default: "1", min: 0, max: 10, cvar: "cs2f_extends" },
  { key: "CS2FIXES_EXTEND_TIME", group: "voting", label: "Extend time (min)", type: "number", default: "20", min: 1, max: 120, cvar: "cs2f_extend_time" },

  // ---- Admin ---------------------------------------------------------------
  {
    key: "CS2_ADMIN_STEAMID",
    group: "admin",
    label: "Owner SteamID64 (legacy)",
    description:
      "When set, install-mods.sh OVERWRITES admins.jsonc with this single entry on every boot, destroying the panel's admin list. Manage admins on the Admins page instead.",
    type: "string",
    default: "",
    panelManaged: true,
    restartRequired: true,
  },
  { key: "CS2_ADMIN_NAME", group: "admin", label: "Owner admin name (legacy)", type: "string", default: "Server Owner", panelManaged: true, restartRequired: true },
  { key: "CS2_ADMIN_FLAGS", group: "admin", label: "Owner admin flags (legacy)", type: "string", default: "z", panelManaged: true, restartRequired: true },
  { key: "CS2FIXES_EXTRA_CFG", group: "gameplay", label: "Extra CS2Fixes cvars", description: "Semicolon-separated extra cvar lines appended to the managed block.", type: "string", default: "", advanced: true, placeholder: "cs2f_flashlight_enable 1;zr_knockback_scale 5.0" },

  // ---- CSTV ----------------------------------------------------------------
  { key: "TV_ENABLE", group: "cstv", label: "Enable CSTV", type: "boolean01", default: "0", restartRequired: true },
  { key: "TV_PORT", group: "cstv", label: "CSTV port", type: "number", default: "27020", min: 1, max: 65535, restartRequired: true },
  { key: "TV_AUTORECORD", group: "cstv", label: "Auto record", type: "boolean01", default: "0", restartRequired: true },
  { key: "TV_PW", group: "cstv", label: "CSTV password", type: "password", default: "", secret: true, restartRequired: true },
  { key: "TV_RELAY_PW", group: "cstv", label: "CSTV relay password", type: "password", default: "", secret: true, restartRequired: true },
  { key: "TV_MAXRATE", group: "cstv", label: "CSTV max rate", type: "number", default: "0", restartRequired: true },
  { key: "TV_DELAY", group: "cstv", label: "CSTV delay (s)", type: "number", default: "0", restartRequired: true },
  { key: "TV_RELAYVOICE", group: "cstv", label: "Relay voice", type: "boolean01", default: "1", restartRequired: true },

  // ---- Logging -------------------------------------------------------------
  { key: "CS2_LOG", group: "logging", label: "Logging", type: "select", options: ["on", "off"], default: "on", restartRequired: true },
  { key: "CS2_LOG_FILE", group: "logging", label: "Log to file", type: "boolean01", default: "1", restartRequired: true },
  { key: "CS2_LOG_ECHO", group: "logging", label: "Echo log to console", description: "Turn on to see game events in the container log stream.", type: "boolean01", default: "0", restartRequired: true },
  { key: "CS2_LOG_MONEY", group: "logging", label: "Log money", type: "boolean01", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_LOG_DETAIL", group: "logging", label: "Log detail", type: "number", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_LOG_ITEMS", group: "logging", label: "Log items", type: "boolean01", default: "0", restartRequired: true, advanced: true },
  { key: "CS2_DISCONNECT_KILLS", group: "logging", label: "Kill on disconnect", type: "boolean01", default: "1", restartRequired: true, advanced: true },
  { key: "CS2_LOG_HTTP_URL", group: "logging", label: "Log HTTP endpoint", type: "string", default: "", restartRequired: true, slashEscaped: true, advanced: true },

  // ---- Mods ----------------------------------------------------------------
  { key: "INSTALL_METAMOD", group: "mods", label: "Install Metamod", type: "boolean01", default: "1", restartRequired: true },
  { key: "METAMOD_VERSION", group: "mods", label: "Metamod version", type: "string", default: "2.0.0-git1411", restartRequired: true },
  { key: "METAMOD_URL", group: "mods", label: "Metamod URL override", type: "string", default: "", restartRequired: true, slashEscaped: false, advanced: true },
  { key: "INSTALL_CS2FIXES", group: "mods", label: "Install CS2Fixes", type: "boolean01", default: "1", restartRequired: true },
  { key: "CS2FIXES_VERSION", group: "mods", label: "CS2Fixes version", type: "string", default: "v1.20.1", restartRequired: true },
  { key: "CS2FIXES_RUNTIME", group: "mods", label: "CS2Fixes runtime", type: "select", options: ["steamrt3", "steamrt4"], default: "steamrt3", restartRequired: true, advanced: true },
  { key: "CS2FIXES_URL", group: "mods", label: "CS2Fixes URL override", type: "string", default: "", restartRequired: true, advanced: true },
  { key: "INSTALL_MULTIADDONMANAGER", group: "mods", label: "Install MultiAddonManager", type: "boolean01", default: "1", restartRequired: true },
  { key: "MULTIADDONMANAGER_VERSION", group: "mods", label: "MultiAddonManager version", type: "string", default: "v1.5.4", restartRequired: true },
  { key: "MULTIADDONMANAGER_RUNTIME", group: "mods", label: "MultiAddonManager runtime", type: "select", options: ["steamrt3", "steamrt4"], default: "steamrt3", restartRequired: true, advanced: true },
  { key: "MULTIADDONMANAGER_URL", group: "mods", label: "MultiAddonManager URL override", type: "string", default: "", restartRequired: true, advanced: true },
  { key: "INSTALL_STRIPPERCS2", group: "mods", label: "Install StripperCS2", type: "boolean01", default: "1", restartRequired: true },
  { key: "STRIPPERCS2_VERSION", group: "mods", label: "StripperCS2 version", type: "string", default: "v1.1.3", restartRequired: true },
  { key: "STRIPPERCS2_URL", group: "mods", label: "StripperCS2 URL override", type: "string", default: "", restartRequired: true, advanced: true },
  { key: "MODS_FORCE_REINSTALL", group: "mods", label: "Force re-download on next start", description: "Set to 1 for one start to download all enabled mod archives again, then set it back to 0.", type: "boolean01", default: "0", restartRequired: true },

  // ---- MultiAddonManager ---------------------------------------------------
  { key: "MAM_EXTRA_ADDONS", group: "addons", label: "Extra addons (server + client)", description: "Comma-separated workshop IDs. Content packs such as GFL Zombie Escape Content (3160448201) belong here, not in the start workshop map.", type: "string", default: "3160448201", cvar: "mm_extra_addons", cvarQuote: true },
  { key: "MAM_CLIENT_EXTRA_ADDONS", group: "addons", label: "Client-only extra addons", type: "string", default: "", cvar: "mm_client_extra_addons", cvarQuote: true },
  { key: "MAM_EXTRA_ADDONS_TIMEOUT", group: "addons", label: "Extra addons timeout (s)", type: "number", default: "10", min: 0, cvar: "mm_extra_addons_timeout" },
  { key: "MAM_ADDON_CONNECTION_TIMEOUT", group: "addons", label: "Addon connection timeout (s)", type: "number", default: "30", min: 0, cvar: "mm_addon_connection_timeout" },
  { key: "MAM_ADDON_MOUNT_DOWNLOAD", group: "addons", label: "Mount download", type: "boolean01", default: "0", cvar: "mm_addon_mount_download" },
  { key: "MAM_CACHE_CLIENTS_WITH_ADDONS", group: "addons", label: "Cache clients with addons", type: "boolean01", default: "0", cvar: "mm_cache_clients_with_addons" },
  { key: "MAM_CACHE_CLIENTS_DURATION", group: "addons", label: "Cache duration (s)", type: "number", default: "0", min: 0, cvar: "mm_cache_clients_duration" },
  { key: "MAM_BLOCK_DISCONNECT_MESSAGES", group: "addons", label: "Block disconnect messages", type: "boolean01", default: "0", cvar: "mm_block_disconnect_messages" },
  { key: "MAM_ADDON_DEBUG", group: "addons", label: "Addon debug", type: "boolean01", default: "0", cvar: "mm_addon_debug", advanced: true },
];

export const ENV_SCHEMA_BY_KEY: Record<string, EnvKeySpec> = Object.fromEntries(
  ENV_SCHEMA.map((s) => [s.key, s]),
);

export const SECRET_KEYS: string[] = ENV_SCHEMA.filter((s) => s.secret).map((s) => s.key);

/** Keys that can be pushed live over RCON. */
export const LIVE_APPLICABLE_KEYS: string[] = ENV_SCHEMA.filter((s) => s.cvar).map((s) => s.key);

export function requiresRestart(key: string): boolean {
  const spec = ENV_SCHEMA_BY_KEY[key];
  if (!spec) return true; // unknown key: assume the worst
  if (spec.cvar) return false;
  // A known key without a live cvar still needs a recreate, even if an older
  // schema entry omitted the explicit restartRequired annotation.
  return spec.restartRequired !== false;
}
