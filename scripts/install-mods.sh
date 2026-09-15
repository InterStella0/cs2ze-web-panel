#!/usr/bin/env bash

# This file is sourced by joedwards32/cs2 after SteamCMD updates the server.
# Run the installer in a subshell so strict shell options do not leak into the
# image's entrypoint.
(
  set -euo pipefail

  csgo_dir="${STEAMAPPDIR:?STEAMAPPDIR is required}/game/csgo"
  state_dir="${STEAMAPPDIR}/.cs2ze-mods"
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

  configure_cs2fixes() {
    local config="$csgo_dir/cfg/cs2fixes/cs2fixes.cfg"
    local zr_config example target

    [ -f "$config" ] || return
    remove_managed_block "$config"
    {
      printf '\n// BEGIN CS2ZE MANAGED\n'
      printf 'zr_enable %s\n' "${ZR_ENABLE:-1}"
      printf 'cs2f_commands_enable %s\n' "${CS2FIXES_COMMANDS_ENABLE:-1}"
      printf 'cs2f_admin_commands_enable %s\n' "${CS2FIXES_ADMIN_COMMANDS_ENABLE:-1}"
      printf 'cs2f_stopsound_enable %s\n' "${CS2FIXES_STOPSOUND_ENABLE:-1}"
      printf 'cs2f_noblock_enable %s\n' "${CS2FIXES_NOBLOCK_ENABLE:-1}"
      printf 'cs2f_movement_unlocker_enable %s\n' "${CS2FIXES_MOVEMENT_UNLOCKER_ENABLE:-1}"
      printf 'cs2f_use_old_push %s\n' "${CS2FIXES_USE_OLD_PUSH:-1}"
      printf 'cs2f_hide_enable %s\n' "${CS2FIXES_HIDE_ENABLE:-1}"
      printf 'cs2f_trigger_timer_enable %s\n' "${CS2FIXES_TRIGGER_TIMER_ENABLE:-1}"
      printf 'cs2f_cvarwhitelist_enable %s\n' "${CS2FIXES_CVARWHITELIST_ENABLE:-1}"
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

  log "mod installation complete"
) || {
  status=$?
  printf '[cs2ze] mod installation failed (exit %s); server will not start\n' "$status" >&2
  exit "$status"
}
