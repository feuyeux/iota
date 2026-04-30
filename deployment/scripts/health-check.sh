#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Iota Storage Health Check — checks whichever services are running
# ─────────────────────────────────────────────────────────────────────────────

echo "Checking Iota storage services health..."
echo ""

HEALTHY=0
UNHEALTHY=0

check_service() {
  local name="$1"
  local container="$2"
  local check="$3"

  if docker inspect -f '{{.State.Status}}' "$container" &>/dev/null; then
    if eval "$check" &>/dev/null; then
      echo "  ✓ $name — healthy"
      HEALTHY=$((HEALTHY + 1))
    else
      echo "  ✗ $name — unhealthy (container running but check failed)"
      UNHEALTHY=$((UNHEALTHY + 1))
    fi
  fi
}

echo "=== Service Health ==="
check_service "Redis"          "iota-redis"          "docker exec iota-redis redis-cli ping"
check_service "Redis Sentinel" "iota-redis-sentinel" "docker exec iota-redis-sentinel redis-cli -p 26379 ping"
check_service "MinIO"          "iota-minio"          "curl -sf http://localhost:${IOTA_MINIO_API_PORT:-9002}/minio/health/live"
check_service "Milvus"         "iota-milvus"         "curl -sf http://localhost:9091/healthz"

echo ""
echo "=== Summary: ${HEALTHY} healthy, ${UNHEALTHY} unhealthy ==="

if docker inspect -f '{{.State.Status}}' "iota-redis" &>/dev/null; then
  echo ""
  echo "=== Redis Info ==="
  docker exec iota-redis redis-cli INFO memory 2>/dev/null | grep used_memory_human || true
  docker exec iota-redis redis-cli INFO stats 2>/dev/null | grep total_connections_received || true
  KEYS=$(docker exec iota-redis redis-cli --scan --pattern "iota:*" 2>/dev/null | wc -l)
  echo "  iota:* keys: $KEYS"
fi

echo ""
echo "=== Docker Resource Usage ==="
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
    $(docker ps --filter "name=iota-" --format "{{.Names}}") 2>/dev/null || echo "  (no iota containers running)"

if [ "$UNHEALTHY" -gt 0 ]; then
  exit 1
fi
