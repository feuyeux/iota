#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

AUTO_INSTALL=1
YES_TO_ALL=0

declare -a TARGETS=()
declare -A COMMANDS=(
  [claude-code]="claude"
  [codex]="codex"
  [gemini]="gemini"
  [hermes]="hermes"
)
declare -A DISPLAY_NAMES=(
  [claude-code]="Claude Code"
  [codex]="Codex"
  [gemini]="Gemini CLI"
  [hermes]="Hermes Agent"
)
declare -A INSTALL_HINTS=(
  [claude-code]="npm install -g @anthropic-ai/claude-code"
  [codex]="npm install -g @openai/codex"
  [gemini]="npm install -g @google/gemini-cli"
  [hermes]="curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash  # Linux/macOS/WSL2 only; native Windows not supported"
)

usage() {
  cat <<'EOF'
Usage:
  bash deployment/scripts/ensure-backends.sh [options] [backend...]

Backends:
  claude-code  codex  gemini  hermes

Options:
  --check-only   Only detect installation state; do not install missing backends
  -y, --yes      Install missing backends without interactive confirmation
  -h, --help     Show this help message

Examples:
  bash deployment/scripts/ensure-backends.sh
  bash deployment/scripts/ensure-backends.sh --check-only
  bash deployment/scripts/ensure-backends.sh codex gemini
EOF
}

log() {
  printf '%s\n' "$*"
}

resolve_cmd() {
  local executable="$1"
  local resolved=""

  if resolved="$(command -v "$executable" 2>/dev/null)" && [[ -n "$resolved" ]]; then
    printf '%s\n' "$resolved"
    return 0
  fi

  if command -v where.exe >/dev/null 2>&1; then
    resolved="$(where.exe "$executable" 2>/dev/null | tr -d '\r' | head -n 1)"
    if [[ -n "$resolved" ]]; then
      printf '%s\n' "$resolved"
      return 0
    fi
  fi

  return 1
}

have_cmd() {
  resolve_cmd "$1" >/dev/null 2>&1
}

confirm_install() {
  local backend="$1"

  if [[ "$YES_TO_ALL" -eq 1 ]]; then
    return 0
  fi

  read -r -p "Install ${DISPLAY_NAMES[$backend]} now? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

install_with_npm() {
  local package_name="$1"
  if ! have_cmd npm; then
    log "  npm not found; cannot install ${package_name}"
    return 1
  fi

  npm install -g "$package_name"
}

install_with_uv() {
  local package_name="$1"
  if ! have_cmd uv; then
    log "  uv not found; cannot install ${package_name}"
    return 1
  fi

  uv tool install "$package_name"
}

# Hermes Agent is published only as a GitHub repo (NousResearch/hermes-agent),
# not on PyPI. The upstream install script uses uv internally and only supports
# Linux/macOS/WSL2.
install_hermes_from_upstream() {
  if ! have_cmd curl; then
    log "  curl not found; cannot install hermes"
    return 1
  fi
  if ! have_cmd bash; then
    log "  bash not found; cannot install hermes"
    return 1
  fi
  case "$(uname -s 2>/dev/null)" in
    Linux*|Darwin*|MINGW*|MSYS*|CYGWIN*) ;;
    *)
      log "  Hermes upstream supports Linux/macOS/WSL2 only; native Windows is not supported."
      log "  See https://github.com/NousResearch/hermes-agent#quick-install"
      return 1
      ;;
  esac
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
}

install_backend() {
  local backend="$1"

  case "$backend" in
    claude-code)
      install_with_npm "@anthropic-ai/claude-code"
      ;;
    codex)
      install_with_npm "@openai/codex"
      ;;
    gemini)
      install_with_npm "@google/gemini-cli"
      ;;
    hermes)
      install_hermes_from_upstream
      ;;
    *)
      log "Unknown backend: $backend"
      return 1
      ;;
  esac
}

validate_backend() {
  local backend="$1"
  [[ -n "${COMMANDS[$backend]:-}" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      AUTO_INSTALL=0
      ;;
    -y|--yes)
      YES_TO_ALL=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    claude-code|codex|gemini|hermes)
      TARGETS+=("$1")
      ;;
    *)
      log "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=(claude-code codex gemini hermes)
fi

log "Checking backend executables in $ROOT_DIR"
log ""

missing_count=0
failed_count=0

for backend in "${TARGETS[@]}"; do
  if ! validate_backend "$backend"; then
    log "[ERROR] Unsupported backend: $backend"
    failed_count=$((failed_count + 1))
    continue
  fi

  executable="${COMMANDS[$backend]}"
  display_name="${DISPLAY_NAMES[$backend]}"

  log "[$backend] $display_name"
  if have_cmd "$executable"; then
    resolved_path="$(resolve_cmd "$executable")"
    log "  installed: yes"
    log "  command:   $executable"
    log "  path:      $resolved_path"
    log ""
    continue
  fi

  log "  installed: no"
  log "  missing command: $executable"
  log "  install hint:    ${INSTALL_HINTS[$backend]}"
  missing_count=$((missing_count + 1))

  if [[ "$AUTO_INSTALL" -eq 0 ]]; then
    log ""
    continue
  fi

  if ! confirm_install "$backend"; then
    log "  skipped"
    log ""
    continue
  fi

  if install_backend "$backend"; then
    if have_cmd "$executable"; then
      resolved_path="$(resolve_cmd "$executable")"
      log "  install result: success"
      log "  path:           $resolved_path"
    else
      log "  install result: command still not found in current shell"
      log "  note: reopen shell or refresh PATH if needed"
      failed_count=$((failed_count + 1))
    fi
  else
    log "  install result: failed"
    failed_count=$((failed_count + 1))
  fi
  log ""
done

log "Summary"
log "  checked: ${#TARGETS[@]}"
log "  missing before install: $missing_count"
log "  failed installs/checks: $failed_count"

if [[ "$failed_count" -gt 0 ]]; then
  exit 1
fi
