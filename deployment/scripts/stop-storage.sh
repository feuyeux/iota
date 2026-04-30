#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# iota Storage Shutdown
#
# Usage:
#   bash stop-storage.sh          # stop all running services (keep data)
#   bash stop-storage.sh --purge  # stop and remove all data volumes
# ─────────────────────────────────────────────────────────────────────────────

PURGE=false

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
    --help|-h)
      echo "Usage: $0 [--purge]"
      echo ""
      echo "  (no flags)  Stop services, keep data volumes"
      echo "  --purge     Stop services AND remove all data volumes"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

# Check if docker compose (v2) or docker-compose (v1) is available
if docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE="docker-compose"
else
  echo "Error: neither 'docker compose' nor 'docker-compose' is installed"
  exit 1
fi

cd "$(dirname "$0")/../docker"

echo "Stopping iota storage services..."

if [ "$PURGE" = true ]; then
  $COMPOSE --profile full --profile ha down -v
  echo "Services stopped. All data volumes removed."
else
  $COMPOSE --profile full --profile ha down
  echo "Services stopped. Data volumes preserved."
  echo ""
  echo "To also remove data: bash $0 --purge"
fi
