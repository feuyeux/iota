FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy package files
COPY iota-engine/package.json ./iota-engine/
COPY iota-cli/package.json ./iota-cli/

# Install dependencies
RUN cd iota-engine && bun install && \
    cd ../iota-cli && bun install

# Copy source code
COPY iota-engine/ ./iota-engine/
COPY iota-cli/ ./iota-cli/

# Build packages
RUN cd iota-engine && bun run build && \
    cd ../iota-cli && bun run build

# Production stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Install runtime dependencies and backend CLI prerequisites
RUN apk add --no-cache python3 py3-pip bash curl git

# Copy package files
COPY iota-engine/package.json ./iota-engine/
COPY iota-cli/package.json ./iota-cli/

# Install production deps
RUN cd iota-engine && bun install --production && \
    cd ../iota-cli && bun install --production

# Copy built artifacts
COPY --from=builder /app/iota-engine/dist ./iota-engine/dist
COPY --from=builder /app/iota-cli/dist ./iota-cli/dist

# Install 3 confirmed backend CLIs (bun)
RUN bun add -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

# Hermes ACP
RUN pip install --break-system-packages hermes-agent || \
    pip install --break-system-packages hermes-acp || \
    { echo "ERROR: Hermes ACP package not found." && exit 1; }

# Verify all backend CLIs
RUN claude --version && codex --version && gemini --version
RUN hermes-acp --version 2>/dev/null || hermes --version 2>/dev/null || \
    { echo "ERROR: Hermes ACP CLI not found" && exit 1; }

# Create iota user
RUN addgroup -g 1000 iota && \
    adduser -D -u 1000 -G iota iota && \
    mkdir -p /home/iota/.iota/data /home/iota/.iota/logs /home/iota/.iota/workspaces && \
    chown -R iota:iota /home/iota/.iota

USER iota

# Set environment
ENV BUN_ENV=production
ENV IOTA_HOME=/home/iota/.iota
ENV IOTA_MODE=production

ENTRYPOINT ["bun", "iota-cli/dist/index.js"]
CMD ["--help"]
