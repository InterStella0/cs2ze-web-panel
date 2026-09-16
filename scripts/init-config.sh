#!/bin/sh

# Populate a persistent runtime config tree from version-controlled defaults.
# Existing runtime files are never replaced, so panel/operator settings survive
# code pulls and default-template updates.
set -eu

defaults_dir="${1:-/defaults}"
runtime_dir="${2:-/server-config}"

[ -d "$defaults_dir" ] || {
  printf '[cs2ze] default config directory is missing: %s\n' "$defaults_dir" >&2
  exit 1
}

mkdir -p "$runtime_dir"

find "$defaults_dir" -type d -print | while IFS= read -r source; do
  relative="${source#"$defaults_dir"}"
  mkdir -p "$runtime_dir$relative"
done

find "$defaults_dir" -type f -print | while IFS= read -r source; do
  relative="${source#"$defaults_dir"}"
  target="$runtime_dir$relative"
  if [ ! -e "$target" ]; then
    cp -p "$source" "$target"
    printf '[cs2ze] initialized runtime config %s\n' "${relative#/}"
  fi
done
