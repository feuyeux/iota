#!/bin/bash
set -e

echo "Stopping Iota production storage services..."

cd "$(dirname "$0")/../docker"

# Stop services
docker-compose down

echo "Services stopped."
echo ""
echo "To remove all data volumes, run:"
echo "  docker-compose down -v"
