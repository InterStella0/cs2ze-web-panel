#!/usr/bin/env bash

# This file is sourced by joedwards32/cs2 after SteamCMD updates the server.
# Run the installer in a subshell so strict shell options do not leak into the
# image's entrypoint.
(
  set -euo pipefail

  csgo_dir="${STEAMAPPDIR:?STEAMAPPDIR is required}/game/csgo"
  state_dir="${STEAMAPPDIR}/.cs2ze-mods"
  config_source="${CS2ZE_CONFIG_DIR:-/opt/cs2ze-config}"
  force_reinstall="${MODS_FORCE_REINSTALL:-0}"

  mkdir -p "$csgo_dir" "$state_dir"

  log() {
    printf '[cs2ze] %s\n' "$*"
  }

  enabled() {
    [ "${1:-0}" = "1" ]
  }

  # Copy updated binaries/assets while keeping existing operator-edited config
  # files. New config files introduced by a release are still copied in.
  preserve_existing_files() {
    local stage="$1"
    shift
    local relative_root source relative

    for relative_root in "$@"; do
      [ -d "$stage/$relative_root" ] || continue
      while IFS= read -r -d '' source; do
        relative="${source#"$stage/"}"
        if [ -e "$csgo_dir/$relative" ]; then
          rm -f -- "$source"
        fi
      done < <(find "$stage/$relative_root" -type f -print0)
    done
  }

  install_archive() {
    local name="$1"
    local url="$2"
    local format="$3"
    shift 3

    local marker="$state_dir/${name}.url"
    local temporary archive stage

    if [ "$force_reinstall" != "1" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$url" ]; then
      log "$name is already installed"
      return
    fi

    temporary="$(mktemp -d)"
    archive="$temporary/archive"
    stage="$temporary/stage"
    mkdir -p "$stage"

    log "downloading $name"
    wget --quiet --show-progress --progress=dot:giga -O "$archive" "$url"

    case "$format" in
      tar.gz)
        tar -xzf "$archive" -C "$stage"
        ;;
      zip)
        unzip -q "$archive" -d "$stage"
        ;;
      *)
        log "unsupported archive format for $name: $format"
        return 1
        ;;
    esac

    preserve_existing_files "$stage" "$@"
    cp -a "$stage/." "$csgo_dir/"
    printf '%s' "$url" > "$marker"
    rm -rf -- "$temporary"
    log "installed $name"
  }

  set_plugin_state() {
    local vdf="$1"
    local wanted="$2"

    if enabled "$wanted"; then
      if [ ! -e "$vdf" ] && [ -e "$vdf.disabled" ]; then
        mv "$vdf.disabled" "$vdf"
      fi
    elif [ -e "$vdf" ]; then
      mv "$vdf" "$vdf.disabled"
    fi
  }

  patch_gameinfo() {
    local gameinfo="$csgo_dir/gameinfo.gi"
    local patched

    [ -f "$gameinfo" ] || {
      log "cannot find $gameinfo"
      return 1
    }

    patched="$(mktemp "${gameinfo}.XXXXXX")"
    awk '
      $0 !~ /[[:space:]]Game[[:space:]]+csgo\/addons\/metamod([[:space:]]|$)/ {
        if (!inserted && waiting && $0 ~ /^[[:space:]]*\{[[:space:]]*$/) {
          print
          print "\t\t\tGame\tcsgo/addons/metamod"
          inserted = 1
          waiting = 0
          next
        }
        if (!inserted && $0 ~ /^[[:space:]]*SearchPaths[[:space:]]*$/) {
          waiting = 1
        }
        print
      }
      END {
        if (!inserted) exit 42
      }
    ' "$gameinfo" > "$patched" || {
      rm -f -- "$patched"
      log "could not locate SearchPaths in gameinfo.gi"
      return 1
    }
    chmod --reference="$gameinfo" "$patched"
    mv "$patched" "$gameinfo"
    log "ensured Metamod is first in gameinfo.gi SearchPaths"
  }

  unpatch_gameinfo() {
    local gameinfo="$csgo_dir/gameinfo.gi"

    [ -f "$gameinfo" ] || return
    sed -i '\|[[:space:]]Game[[:space:]]\+csgo/addons/metamod\([[:space:]]\|$\)|d' "$gameinfo"
    log "disabled Metamod in gameinfo.gi"
  }

  check_known_compatibility() {
    local build="${metamod_version##*git}"

    case "$build" in
      *[!0-9]*|'')
        log "warning: cannot validate custom Metamod version '$metamod_version'"
        return
        ;;
    esac

    if enabled "${INSTALL_CS2FIXES:-1}" && [ "$cs2fixes_version" = "v1.20.1" ] && [ "$build" -gt 1411 ]; then
      log "CS2Fixes v1.20.1 requires Metamod build 1411 or earlier"
      return 1
    fi
    if enabled "${INSTALL_MULTIADDONMANAGER:-1}" && [ "$mam_version" = "v1.6" ] && [ "$build" -le 1459 ]; then
      log "MultiAddonManager v1.6 requires Metamod newer than build 1459"
      return 1
    fi
    if enabled "${INSTALL_STRIPPERCS2:-1}" && [ "$stripper_version" = "v2.0" ] && [ "$build" -lt 1461 ]; then
      log "StripperCS2 v2.0 requires Metamod build 1461 or later"
      return 1
    fi
  }

  remove_managed_block() {
    local file="$1"
    sed -i '/^\/\/ BEGIN CS2ZE MANAGED$/,/^\/\/ END CS2ZE MANAGED$/d' "$file"
  }

  copy_managed_config() {
    local source="$1"
    local target="$2"

    [ -f "$source" ] || return
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
  }

  sync_managed_configs() {
    [ -d "$config_source" ] || {
      log "managed config directory not mounted: $config_source"
      return
    }

    copy_managed_config "$config_source/cs2fixes/maplist.jsonc" \
      "$csgo_dir/addons/cs2fixes/configs/maplist.jsonc"
    copy_managed_config "$config_source/cs2fixes/cvar_whitelist.jsonc" \
      "$csgo_dir/addons/cs2fixes/configs/cvar_whitelist.jsonc"
    copy_managed_config "$config_source/cs2fixes/admins.jsonc" \
      "$csgo_dir/addons/cs2fixes/configs/admins.jsonc"
    copy_managed_config "$config_source/cs2fixes/discordbots.jsonc" \
      "$csgo_dir/addons/cs2fixes/configs/discordbots.jsonc"
    copy_managed_config "$config_source/cs2fixes/zr/playerclass.jsonc" \
      "$csgo_dir/addons/cs2fixes/configs/zr/playerclass.jsonc"
    copy_managed_config "$config_source/cs2fixes/zr/weapons.cfg" \
      "$csgo_dir/addons/cs2fixes/configs/zr/weapons.cfg"
    copy_managed_config "$config_source/cs2fixes/zr/hitgroups.cfg" \
      "$csgo_dir/addons/cs2fixes/configs/zr/hitgroups.cfg"

    if [ -d "$config_source/cs2fixes/maps" ]; then
      mkdir -p "$csgo_dir/cfg/cs2fixes/maps"
      cp -a "$config_source/cs2fixes/maps/." "$csgo_dir/cfg/cs2fixes/maps/"
    fi
    if [ -d "$config_source/stripper" ]; then
      mkdir -p "$csgo_dir/addons/StripperCS2/maps"
      cp -a "$config_source/stripper/." "$csgo_dir/addons/StripperCS2/maps/"
    fi
    log "synchronized repository-managed configuration"
  }

  configure_cs2fixes_server() {
    local server_config="$csgo_dir/cfg/cs2fixes/server.cfg"
    local money="${ZE_ROUND_MONEY:-16000}"

    mkdir -p "$(dirname "$server_config")"
    {
      printf '// Generated by cs2ze-docker from .env on every container start.\n'
      printf 'mp_timelimit %s\n' "${ZE_MAP_TIME_LIMIT:-40}"
      printf 'mp_roundtime %s\n' "${ZE_ROUND_TIME:-60}"
      printf 'mp_roundtime_defuse 0\n'
      printf 'mp_roundtime_hostage 0\n'
      printf 'mp_freezetime %s\n' "${ZE_FREEZE_TIME:-5}"
      printf 'mp_buytime %s\n' "${ZE_BUY_TIME:-60}"
      printf 'mp_maxmoney %s\n' "$money"
      printf 'mp_startmoney %s\n' "$money"
      printf 'mp_afterroundmoney %s\n' "$money"
      printf 'mp_warmup_offline_enabled 0\n'
      printf 'mp_warmup_online_enabled 0\n'
      printf 'mp_warmup_end\n'
      printf 'mp_limitteams 0\n'
      printf 'mp_autoteambalance 0\n'
      printf 'mp_friendlyfire 0\n'
      printf 'mp_give_player_c4 0\n'
      printf 'mp_ignore_round_win_conditions 1\n'
      printf 'mp_maxrounds 0\n'
      printf 'mp_winlimit 0\n'
      printf 'mp_match_can_clinch 0\n'
      printf 'mp_halftime 0\n'
      printf 'mp_endmatch_votenextmap 0\n'
      printf 'mp_round_restart_delay 5\n'
      printf 'bot_quota 0\n'
      printf 'bot_quota_mode fill\n'
    } > "$server_config"
  }

  # The gamemode_*.cfg files are executed by the engine on every map load,
  # after cfg/cs2fixes/server.cfg, and they re-assert Valve's warmup and money
  # defaults. Patch them in place, the same way the base image patches
  # bot_quota, so the ZE rules survive a level change.
  ensure_trailing_newline() {
    local file="$1"

    [ -s "$file" ] || return
    if [ -n "$(tail -c 1 "$file")" ]; then
      printf '\n' >> "$file"
    fi
  }

  set_gamemode_cvar() {
    local cvar="$1"
    local value="$2"
    local file

    for file in "$csgo_dir"/cfg/gamemode_*.cfg; do
      [ -e "$file" ] || continue
      if grep -qE "^[[:space:]]*${cvar}([[:space:]]|\$)" "$file"; then
        sed -ri "s|^[[:space:]]*${cvar}([[:space:]].*)?\$|${cvar} ${value}|" "$file"
      else
        ensure_trailing_newline "$file"
        printf '%s %s\n' "$cvar" "$value" >> "$file"
      fi
    done
  }

  remove_gamemode_setting() {
    local setting="$1"
    local file

    for file in "$csgo_dir"/cfg/gamemode_*.cfg; do
      [ -e "$file" ] || continue
      sed -ri \
        -e "/^[[:space:]]*${setting}([[:space:]]|\$)/d" \
        -e "s/${setting}[[:space:]]+[^[:space:]]+[[:space:]]*\$//" \
        "$file"
    done
  }

  append_gamemode_command() {
    local command="$1"
    local file

    for file in "$csgo_dir"/cfg/gamemode_*.cfg; do
      [ -e "$file" ] || continue
      # Put the command after all Valve settings so a later line cannot restart
      # warmup. Removing it first also avoids accumulating copies on each boot.
      sed -ri "/^[[:space:]]*${command}([[:space:]]|\$)/d" "$file"
      ensure_trailing_newline "$file"
      printf '%s\n' "$command" >> "$file"
    done
  }

  configure_gamemode_rules() {
    local money="${ZE_ROUND_MONEY:-16000}"

    # mp_do_warmup_period does not exist in CS2, and mp_warmuptime has a
    # minimum of 5; changing the latter also resets warmup. Remove the legacy
    # lines previously written by this installer instead of trying to set them.
    remove_gamemode_setting mp_do_warmup_period
    remove_gamemode_setting mp_warmuptime
    remove_gamemode_setting mp_warmuptime_all_players_connected
    remove_gamemode_setting mp_warmup_pausetimer
    set_gamemode_cvar mp_warmup_offline_enabled 0
    set_gamemode_cvar mp_warmup_online_enabled 0
    append_gamemode_command mp_warmup_end
    set_gamemode_cvar mp_maxmoney "$money"
    set_gamemode_cvar mp_startmoney "$money"
    set_gamemode_cvar mp_afterroundmoney "$money"
    log "disabled warmup and set round money to $money in the gamemode configs"
  }

  configure_admin() {
    local steamid="${CS2_ADMIN_STEAMID:-}"
    local admin_name="${CS2_ADMIN_NAME:-Server Owner}"
    local admin_flags="${CS2_ADMIN_FLAGS:-z}"
    local admin_config="$csgo_dir/addons/cs2fixes/configs/admins.jsonc"

    [ -n "$steamid" ] || return
    case "$steamid" in
      *[!0-9]*|????????????????|??????????????????*)
        log "CS2_ADMIN_STEAMID must be a 17-digit SteamID64"
        return 1
        ;;
    esac
    case "$admin_flags" in
      *[!a-z]*)
        log "CS2_ADMIN_FLAGS may contain only lowercase letters"
        return 1
        ;;
    esac

    admin_name="${admin_name//\\/\\\\}"
    admin_name="${admin_name//\"/\\\"}"
    mkdir -p "$(dirname "$admin_config")"
    {
      printf '{\n'
      printf '  "Groups": {},\n'
      printf '  "Admins": {\n'
      printf '    "%s": {\n' "$steamid"
      printf '      "name": "%s",\n' "$admin_name"
      printf '      "flags": "%s",\n' "$admin_flags"
      printf '      "immunity": 100\n'
      printf '    }\n'
      printf '  }\n'
      printf '}\n'
    } > "$admin_config"
    log "configured owner admin $steamid"
  }

  configure_cs2fixes() {
    local config="$csgo_dir/cfg/cs2fixes/cs2fixes.cfg"
    local zr_config example target maplist_example maplist

    [ -f "$config" ] || return
    remove_managed_block "$config"
    {
      printf '\n// BEGIN CS2ZE MANAGED\n'
      printf 'zr_enable %s\n' "${ZR_ENABLE:-1}"
      printf 'cs2f_commands_enable %s\n' "${CS2FIXES_COMMANDS_ENABLE:-1}"
      printf 'cs2f_admin_commands_enable %s\n' "${CS2FIXES_ADMIN_COMMANDS_ENABLE:-1}"
      printf 'cs2f_weapons_enable %s\n' "${CS2FIXES_WEAPONS_ENABLE:-1}"
      printf 'cs2f_stopsound_enable %s\n' "${CS2FIXES_STOPSOUND_ENABLE:-1}"
      printf 'cs2f_noblock_enable %s\n' "${CS2FIXES_NOBLOCK_ENABLE:-1}"
      printf 'cs2f_noblock_grenades %s\n' "${CS2FIXES_NOBLOCK_GRENADES:-1}"
      printf 'cs2f_block_team_messages %s\n' "${CS2FIXES_BLOCK_TEAM_MESSAGES:-1}"
      printf 'cs2f_movement_unlocker_enable %s\n' "${CS2FIXES_MOVEMENT_UNLOCKER_ENABLE:-1}"
      printf 'cs2f_use_old_push %s\n' "${CS2FIXES_USE_OLD_PUSH:-1}"
      printf 'cs2f_hide_enable %s\n' "${CS2FIXES_HIDE_ENABLE:-1}"
      printf 'cs2f_trigger_timer_enable %s\n' "${CS2FIXES_TRIGGER_TIMER_ENABLE:-1}"
      printf 'cs2f_cvarwhitelist_enable %s\n' "${CS2FIXES_CVARWHITELIST_ENABLE:-1}"
      printf 'cs2f_votemanager_enable %s\n' "${CS2FIXES_VOTEMANAGER_ENABLE:-1}"
      printf 'cs2f_block_nav_lookup %s\n' "${CS2FIXES_BLOCK_NAV_LOOKUP:-1}"
      printf 'cs2f_flashlight_enable %s\n' "${CS2FIXES_FLASHLIGHT_ENABLE:-1}"
      printf 'cs2f_flashlight_shadows %s\n' "${CS2FIXES_FLASHLIGHT_SHADOWS:-0}"
      printf 'cs2f_flashlight_transmit_others %s\n' "${CS2FIXES_FLASHLIGHT_TRANSMIT_OTHERS:-1}"
      printf 'cs2f_infinite_reserve_ammo %s\n' "${CS2FIXES_INFINITE_RESERVE_AMMO:-1}"
      printf 'cs2f_full_alltalk %s\n' "${CS2FIXES_FULL_ALLTALK:-1}"
      printf 'cs2f_prevent_using_players %s\n' "${CS2FIXES_PREVENT_USING_PLAYERS:-1}"
      printf 'cs2f_fix_game_bans %s\n' "${CS2FIXES_FIX_GAME_BANS:-1}"
      printf 'cs2f_free_armor %s\n' "${CS2FIXES_FREE_ARMOR:-2}"
      printf 'cs2f_noshake_enable %s\n' "${CS2FIXES_NOSHAKE_ENABLE:-1}"
      printf 'cs2f_block_molotov_self_dmg %s\n' "${CS2FIXES_BLOCK_MOLOTOV_SELF_DMG:-1}"
      printf 'cs2f_fix_block_dmg %s\n' "${CS2FIXES_FIX_BLOCK_DMG:-1}"
      printf 'cs2f_topdefender_enable %s\n' "${CS2FIXES_TOPDEFENDER_ENABLE:-1}"
      printf 'zr_knockback_scale %s\n' "${ZR_KNOCKBACK_SCALE:-5.0}"
      printf 'zr_infect_min_count_req %s\n' "${ZR_INFECT_MIN_COUNT_REQ:-1}"
      printf 'zr_respawn_delay %s\n' "${ZR_RESPAWN_DELAY:-5.0}"
      printf 'cs2f_rtv_vote_delay %s\n' "${CS2FIXES_RTV_VOTE_DELAY:-60}"
      printf 'cs2f_rtv_success_ratio %s\n' "${CS2FIXES_RTV_SUCCESS_RATIO:-0.60}"
      printf 'cs2f_extends %s\n' "${CS2FIXES_EXTENDS:-1}"
      printf 'cs2f_extend_time %s\n' "${CS2FIXES_EXTEND_TIME:-20}"
      if [ -n "${CS2FIXES_EXTRA_CFG:-}" ]; then
        printf '%s\n' "$CS2FIXES_EXTRA_CFG" | tr ';' '\n'
      fi
      printf '// END CS2ZE MANAGED\n'
    } >> "$config"

    zr_config="$csgo_dir/addons/cs2fixes/configs/zr"
    if [ -d "$zr_config" ]; then
      while IFS= read -r -d '' example; do
        target="${example%.example}"
        [ -e "$target" ] || cp -a "$example" "$target"
      done < <(find "$zr_config" -maxdepth 1 -type f -name '*.example' -print0)
    fi

    sync_managed_configs
    configure_cs2fixes_server
    configure_admin

    maplist_example="$csgo_dir/addons/cs2fixes/configs/maplist.jsonc.example"
    maplist="$csgo_dir/addons/cs2fixes/configs/maplist.jsonc"
    if [ -f "$maplist_example" ] && [ ! -e "$maplist" ]; then
      cp -a "$maplist_example" "$maplist"
      log "created maplist.jsonc from the upstream example"
    fi
    log "configured CS2Fixes and ZombieReborn"
  }

  configure_multiaddonmanager() {
    local config="$csgo_dir/cfg/multiaddonmanager/multiaddonmanager.cfg"

    [ -f "$config" ] || return
    remove_managed_block "$config"
    {
      printf '\n// BEGIN CS2ZE MANAGED\n'
      printf 'mm_extra_addons "%s"\n' "${MAM_EXTRA_ADDONS:-}"
      printf 'mm_client_extra_addons "%s"\n' "${MAM_CLIENT_EXTRA_ADDONS:-}"
      printf 'mm_extra_addons_timeout %s\n' "${MAM_EXTRA_ADDONS_TIMEOUT:-10}"
      printf 'mm_addon_connection_timeout %s\n' "${MAM_ADDON_CONNECTION_TIMEOUT:-30}"
      printf 'mm_addon_mount_download %s\n' "${MAM_ADDON_MOUNT_DOWNLOAD:-0}"
      printf 'mm_cache_clients_with_addons %s\n' "${MAM_CACHE_CLIENTS_WITH_ADDONS:-0}"
      printf 'mm_cache_clients_duration %s\n' "${MAM_CACHE_CLIENTS_DURATION:-0}"
      printf 'mm_block_disconnect_messages %s\n' "${MAM_BLOCK_DISCONNECT_MESSAGES:-0}"
      printf 'mm_addon_debug %s\n' "${MAM_ADDON_DEBUG:-0}"
      printf '// END CS2ZE MANAGED\n'
    } >> "$config"
    log "configured MultiAddonManager"
  }

  metamod_version="${METAMOD_VERSION:-2.0.0-git1411}"
  metamod_url="${METAMOD_URL:-https://mms.alliedmods.net/mmsdrop/2.0/mmsource-${metamod_version}-linux.tar.gz}"
  cs2fixes_version="${CS2FIXES_VERSION:-v1.20.1}"
  cs2fixes_runtime="${CS2FIXES_RUNTIME:-steamrt3}"
  cs2fixes_url="${CS2FIXES_URL:-https://github.com/Source2ZE/CS2Fixes/releases/download/${cs2fixes_version}/CS2Fixes-${cs2fixes_version}-${cs2fixes_runtime}.tar.gz}"
  mam_version="${MULTIADDONMANAGER_VERSION:-v1.5.4}"
  mam_runtime="${MULTIADDONMANAGER_RUNTIME:-steamrt3}"
  mam_url="${MULTIADDONMANAGER_URL:-https://github.com/Source2ZE/MultiAddonManager/releases/download/${mam_version}/MultiAddonManager-${mam_version}-${mam_runtime}.tar.gz}"
  stripper_version="${STRIPPERCS2_VERSION:-v1.1.3}"
  stripper_asset_version="${stripper_version#v}"
  stripper_url="${STRIPPERCS2_URL:-https://github.com/Source2ZE/StripperCS2/releases/download/${stripper_version}/StripperCS2-${stripper_asset_version}.zip}"

  if enabled "${INSTALL_METAMOD:-1}"; then
    check_known_compatibility
  elif enabled "${INSTALL_CS2FIXES:-1}" || enabled "${INSTALL_MULTIADDONMANAGER:-1}" || enabled "${INSTALL_STRIPPERCS2:-1}"; then
    log "Metamod cannot be disabled while a Metamod plugin is enabled"
    exit 1
  fi

  if enabled "${INSTALL_METAMOD:-1}"; then
    install_archive metamod "$metamod_url" tar.gz "addons/metamod/metaplugins.ini"
    patch_gameinfo
  else
    unpatch_gameinfo
  fi

  if enabled "${INSTALL_CS2FIXES:-1}"; then
    install_archive cs2fixes "$cs2fixes_url" tar.gz \
      "cfg/cs2fixes" "addons/cs2fixes/configs"
    configure_cs2fixes
  fi
  set_plugin_state "$csgo_dir/addons/metamod/cs2fixes.vdf" "${INSTALL_CS2FIXES:-1}"

  if enabled "${INSTALL_MULTIADDONMANAGER:-1}"; then
    install_archive multiaddonmanager "$mam_url" tar.gz \
      "cfg/multiaddonmanager"
    configure_multiaddonmanager
  fi
  set_plugin_state "$csgo_dir/addons/metamod/multiaddonmanager.vdf" "${INSTALL_MULTIADDONMANAGER:-1}"

  if enabled "${INSTALL_STRIPPERCS2:-1}"; then
    install_archive strippercs2 "$stripper_url" zip \
      "addons/StripperCS2/maps"
  fi
  set_plugin_state "$csgo_dir/addons/metamod/StripperCS2.vdf" "${INSTALL_STRIPPERCS2:-1}"

  configure_gamemode_rules

  log "mod installation complete"
) || {
  status=$?
  printf '[cs2ze] mod installation failed (exit %s); server will not start\n' "$status" >&2
  exit "$status"
}
