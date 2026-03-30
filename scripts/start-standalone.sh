#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
STANDALONE_STATIC_DIR="$STANDALONE_NEXT_DIR/static"
SOURCE_STATIC_DIR="$PROJECT_ROOT/.next/static"
SOURCE_PUBLIC_DIR="$PROJECT_ROOT/public"
STANDALONE_PUBLIC_DIR="$STANDALONE_DIR/public"

if [[ ! -f "$STANDALONE_DIR/server.js" ]]; then
  echo "error: standalone server missing at $STANDALONE_DIR/server.js" >&2
  echo "run 'pnpm build' first" >&2
  exit 1
fi

mkdir -p "$STANDALONE_NEXT_DIR"

if [[ -d "$SOURCE_STATIC_DIR" ]]; then
  rm -rf "$STANDALONE_STATIC_DIR"
  cp -R "$SOURCE_STATIC_DIR" "$STANDALONE_STATIC_DIR"
fi

if [[ -d "$SOURCE_PUBLIC_DIR" ]]; then
  rm -rf "$STANDALONE_PUBLIC_DIR"
  cp -R "$SOURCE_PUBLIC_DIR" "$STANDALONE_PUBLIC_DIR"
fi

cd "$STANDALONE_DIR"
# Next.js standalone server reads HOSTNAME to decide bind address.
# Default to 0.0.0.0 so the server is accessible from outside the host.
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

is_unresolved_openclaw_token() {
  local value="${1:-}"
  [[ "$value" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*\}$ || "$value" =~ ^\$[A-Za-z_][A-Za-z0-9_]*$ || "$value" =~ ^%[A-Za-z_][A-Za-z0-9_]*%$ ]]
}

if is_unresolved_openclaw_token "${OPENCLAW_STATE_DIR:-}"; then
  unset OPENCLAW_STATE_DIR
fi
if is_unresolved_openclaw_token "${OPENCLAW_CONFIG_PATH:-}"; then
  unset OPENCLAW_CONFIG_PATH
fi
if is_unresolved_openclaw_token "${OPENCLAW_HOME:-}"; then
  unset OPENCLAW_HOME
fi

# Normalize OpenClaw env wiring so runtime and CLI share the same active profile.
if [[ -z "${OPENCLAW_STATE_DIR:-}" ]]; then
  if [[ -n "${OPENCLAW_CONFIG_PATH:-}" ]]; then
    OPENCLAW_STATE_DIR="$(dirname "$OPENCLAW_CONFIG_PATH")"
  elif [[ -n "${OPENCLAW_HOME:-}" ]]; then
    case "${OPENCLAW_HOME##*/}" in
      .openclaw)
        OPENCLAW_STATE_DIR="$OPENCLAW_HOME"
        OPENCLAW_HOME="$(dirname "$OPENCLAW_HOME")"
        ;;
      *)
        OPENCLAW_STATE_DIR="${OPENCLAW_HOME}/.openclaw"
        ;;
    esac
  else
    OPENCLAW_HOME="${HOME:-$(cd ~ && pwd)}"
    OPENCLAW_STATE_DIR="${OPENCLAW_HOME}/.openclaw"
  fi
fi
export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR}/openclaw.json}"
if [[ -z "${OPENCLAW_HOME:-}" ]]; then
  export OPENCLAW_HOME="$(dirname "$OPENCLAW_STATE_DIR")"
fi

exec node server.js
