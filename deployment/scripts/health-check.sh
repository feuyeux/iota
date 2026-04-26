#!/bin/bash
set -e

echo "Checking Iota storage services health..."

cd "$(dirname "$0")/../docker"

# Check if services are running
if ! docker-compose ps | grep -q "Up"; then
    echo "Error: Services are not running. Start them with ./start-storage.sh"
    exit 1
fi

echo ""
echo "=== Service Status ==="
docker-compose ps

echo ""
echo "=== Redis Health ==="
if docker exec iota-redis redis-cli ping &> /dev/null; then
    echo "✓ Redis is healthy"
    docker exec iota-redis redis-cli INFO stats | grep total_connections_received
    docker exec iota-redis redis-cli INFO memory | grep used_memory_human
else
    echo "✗ Redis is unhealthy"
fi

echo ""
echo "=== Milvus Health ==="
if curl -sf http://localhost:9091/healthz &> /dev/null; then
    echo "✓ Milvus is healthy"
    curl -s http://localhost:9091/healthz
else
    echo "✗ Milvus is unhealthy"
fi

echo ""
echo "=== MinIO Health ==="
if curl -sf http://localhost:9002/minio/health/live &> /dev/null; then
    echo "✓ MinIO is healthy"
    docker exec iota-minio mc admin info local 2>/dev/null | grep -E "Uptime|Total"
else
    echo "✗ MinIO is unhealthy"
fi

echo ""
echo "=== Docker Resource Usage ==="
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
    iota-redis iota-milvus iota-minio 2>/dev/null || echo "Unable to get stats"
