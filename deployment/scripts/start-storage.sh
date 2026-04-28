#!/bin/bash
set -e

echo "Starting Iota production storage services..."

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "Error: docker-compose is not installed"
    exit 1
fi

cd "$(dirname "$0")/../docker"

# Start services
docker-compose up -d

# wait_for <name> <container> <check-command> <timeout-seconds>
wait_for() {
    local name="$1"
    local container="$2"
    local check="$3"
    local timeout="${4:-180}"
    local elapsed=0

    echo -n "Waiting for ${name}..."
    while true; do
        # Bail out early if the container is not running (e.g. CrashLoopBackoff).
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

echo "Waiting for services to be healthy..."

wait_for "Redis"  "iota-redis"        "docker exec iota-redis redis-cli ping"                 60
wait_for "MinIO"  "iota-minio"        "curl -sf http://localhost:9002/minio/health/live"      60

# Create MinIO bucket for Iota
echo "Creating MinIO bucket..."
docker exec iota-minio mc alias set local http://localhost:9000 iota iotasecret
docker exec iota-minio mc mb local/iota-snapshots --ignore-existing

echo ""
echo "All services are ready!"
echo ""
echo "Service endpoints:"
echo "  Redis:          localhost:6379"
echo "  Redis Sentinel: localhost:26379"
echo "  MinIO:          localhost:9002 (console: localhost:9003)"
echo ""
echo "MinIO credentials:"
echo "  User:     iota"
echo "  Password: iotasecret"
