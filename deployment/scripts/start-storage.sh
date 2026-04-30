#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# iota Storage Startup — Parameterized Profiles
#
# Usage:
#   bash start-storage.sh              # minimal (Redis only)
#   bash start-storage.sh --full       # Redis + MinIO + Milvus
#   bash start-storage.sh --full --ha  # full + Redis Sentinel
#   bash start-storage.sh --ha         # Redis + Sentinel (no MinIO/Milvus)
# ─────────────────────────────────────────────────────────────────────────────

PROFILES=""
FULL=false
HA=false

for arg in "$@"; do
  case "$arg" in
    --full)  FULL=true ;;
    --ha)    HA=true ;;
    --help|-h)
      echo "Usage: $0 [--full] [--ha]"
      echo ""
      echo "  (no flags)  Start Redis only (minimal, for dev)"
      echo "  --full      Start Redis + MinIO + Milvus (production)"
      echo "  --ha        Add Redis Sentinel for high availability"
      echo ""
      echo "Environment variables:"
      echo "  IOTA_REDIS_PORT          Redis port (default: 6379)"
      echo "  IOTA_SENTINEL_PORT       Sentinel port (default: 26379)"
      echo "  IOTA_MINIO_API_PORT      MinIO API port (default: 9002)"
      echo "  IOTA_MINIO_CONSOLE_PORT  MinIO console port (default: 9003)"
      echo "  IOTA_MILVUS_PORT         Milvus port (default: 19530)"
      echo "  IOTA_MINIO_USER          MinIO root user (default: iota)"
      echo "  IOTA_MINIO_PASSWORD      MinIO root password (default: iotasecret)"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

if [ "$FULL" = true ]; then
  PROFILES="$PROFILES --profile full"
fi
if [ "$HA" = true ]; then
  PROFILES="$PROFILES --profile ha"
fi

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

echo "Starting iota storage services..."
if [ "$FULL" = true ] && [ "$HA" = true ]; then
  echo "  Mode: full + HA (Redis + Sentinel + MinIO + Milvus)"
elif [ "$FULL" = true ]; then
  echo "  Mode: full (Redis + MinIO + Milvus)"
elif [ "$HA" = true ]; then
  echo "  Mode: HA (Redis + Sentinel)"
else
  echo "  Mode: minimal (Redis only)"
fi
echo ""

# Start services
$COMPOSE $PROFILES up -d

# wait_for <name> <container> <check-command> <timeout-seconds>
wait_for() {
    local name="$1"
    local container="$2"
    local check="$3"
    local timeout="${4:-180}"
    local elapsed=0

    echo -n "Waiting for ${name}..."
    while true; do
        local status
        status="$(docker inspect -f '{{.State.Status}}' "${container}" 2>/dev/null || echo missing)"
        if [ "${status}" != "running" ] && [ "${status}" != "created" ]; then
            echo " FAIL (container ${container} status=${status})"
            echo "---- docker logs ${container} (tail 50) ----"
            docker logs --tail 50 "${container}" 2>&1 || true
            echo "--------------------------------------------"
            exit 1
        fi

        if eval "${check}" &> /dev/null; then
            echo " OK"
            return 0
        fi

        if [ "${elapsed}" -ge "${timeout}" ]; then
            echo " TIMEOUT after ${timeout}s"
            echo "---- docker logs ${container} (tail 50) ----"
            docker logs --tail 50 "${container}" 2>&1 || true
            echo "--------------------------------------------"
            exit 1
        fi

        echo -n "."
        sleep 2
        elapsed=$((elapsed + 2))
    done
}

echo ""
echo "Waiting for services to be healthy..."

# Redis is always started
wait_for "Redis" "iota-redis" "docker exec iota-redis redis-cli ping" 60

# Full profile services
if [ "$FULL" = true ]; then
    MINIO_PORT="${IOTA_MINIO_API_PORT:-9002}"
    wait_for "MinIO" "iota-minio" "curl -sf http://localhost:${MINIO_PORT}/minio/health/live" 60

    # Create MinIO bucket
    echo "Creating MinIO bucket..."
    docker exec iota-minio mc alias set local http://localhost:9000 "${IOTA_MINIO_USER:-iota}" "${IOTA_MINIO_PASSWORD:-iotasecret}" 2>/dev/null || true
    docker exec iota-minio mc mb local/iota-snapshots --ignore-existing 2>/dev/null || true

    wait_for "Milvus" "iota-milvus" "curl -sf http://localhost:9091/healthz" 120
fi

# HA profile
if [ "$HA" = true ]; then
    wait_for "Redis Sentinel" "iota-redis-sentinel" "docker exec iota-redis-sentinel redis-cli -p 26379 ping" 30
fi

echo ""
echo "All services are ready!"
echo ""
echo "Service endpoints:"
echo "  Redis:          localhost:${IOTA_REDIS_PORT:-6379}"
if [ "$HA" = true ]; then
    echo "  Redis Sentinel: localhost:${IOTA_SENTINEL_PORT:-26379}"
fi
if [ "$FULL" = true ]; then
    echo "  MinIO API:      localhost:${IOTA_MINIO_API_PORT:-9002}"
    echo "  MinIO Console:  localhost:${IOTA_MINIO_CONSOLE_PORT:-9003}"
    echo "  Milvus:         localhost:${IOTA_MILVUS_PORT:-19530}"
    echo ""
    echo "MinIO credentials:"
    echo "  User:     ${IOTA_MINIO_USER:-iota}"
    echo "  Password: ${IOTA_MINIO_PASSWORD:-iotasecret}"
fi
