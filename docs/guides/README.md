# Iota Documentation Guides

**Version:** 1.0  
**Last Updated:** April 2026

## Overview

This guide series provides comprehensive documentation for the Iota system, serving as both user documentation and manual verification tools. Each guide covers a specific component with detailed architecture, dependencies, communication protocols, and step-by-step verification procedures.

### Purpose

These guides enable you to:

- **Understand** the complete Iota architecture and component interactions
- **Verify** functionality manually through executable commands and workflows
- **Troubleshoot** issues with clear debugging procedures
- **Deploy** components with proper infrastructure setup
- **Maintain** the system with confidence in its behavior

### Target Audience

- Developers working on Iota components
- System administrators deploying Iota
- Contributors verifying functionality
- Users seeking deep understanding of the system

## Quick Start Path

For new users, we recommend following this verification workflow:

### 1. Start with Architecture (5-10 minutes)
Read [00-architecture-overview.md](./00-architecture-overview.md) to understand:
- System-level architecture and component layers
- Engine internal architecture
- Communication protocols between components
- Data flow and storage patterns

### 2. Verify Infrastructure (5 minutes)
Before testing any component, ensure Redis is running:
```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # Should return PONG
```

### 3. Verify CLI (15-20 minutes)
Follow [01-cli-guide.md](./01-cli-guide.md) to verify:
- Command-line interface functionality
- Backend configuration and switching
- Session and execution management
- Distributed log access

### 4. Verify TUI (10-15 minutes)
Follow [02-tui-guide.md](./02-tui-guide.md) to verify:
- Interactive mode functionality
- Real-time streaming output
- Approval workflows
- Session continuity

### 5. Verify Agent Service (20-25 minutes)
Follow [03-agent-guide.md](./03-agent-guide.md) to verify:
- HTTP REST API endpoints
- WebSocket streaming protocol
- Distributed configuration management
- Cross-session data access

### 6. Verify App Interface (15-20 minutes)
Follow [04-app-guide.md](./04-app-guide.md) to verify:
- Web UI components and workflows
- Real-time updates via WebSocket
- Multi-session visualization
- Backend switching in UI

### 7. Deep Dive into Engine (30-40 minutes)
Follow [05-engine-guide.md](./05-engine-guide.md) to verify:
- Backend adapter implementations
- Memory system flow
- Visibility plane data structures
- Redis data organization

**Total Time:** ~2-3 hours for complete verification

## Guide Series

### [00. Architecture Overview](./00-architecture-overview.md)
**Status:** ✅ Complete  
**Purpose:** System-wide architectural reference

**Topics Covered:**
- High-level system architecture diagram
- Component overview (CLI, TUI, Agent, App, Engine)
- Engine internal architecture
- Execution flow sequence
- Communication protocols (HTTP, WebSocket, Redis, stdio)
- Data flow and storage patterns
- Deployment architectures (single-machine, distributed)

**When to Use:**
- Before diving into specific components
- When understanding component interactions
- When troubleshooting cross-component issues
- When planning system modifications

---

### [01. CLI Guide](./01-cli-guide.md)
**Status:** ✅ Complete  
**Purpose:** Command-line interface verification

**Topics Covered:**
- CLI command reference (`run`, `interactive`, `status`, `switch`, `config`, `gc`, `logs`, `visibility`)
- Dependencies (Engine library, Redis, Backend executables)
- Communication protocols (TypeScript imports, Redis TCP, subprocess stdio)
- Manual verification procedures for each command
- Redis side effect inspection
- Troubleshooting common CLI issues

**When to Use:**
- When verifying CLI functionality
- When debugging command execution
- When understanding CLI-Engine interaction
- When testing backend switching

---

### [02. TUI Guide](./02-tui-guide.md)
**Status:** ✅ Complete  
**Purpose:** Interactive mode verification

**Topics Covered:**
- Interactive mode launch and navigation
- Session management in TUI
- Approval workflow demonstration
- Keyboard shortcuts and command history
- Multi-turn conversation verification
- Terminal compatibility requirements

**When to Use:**
- When verifying interactive mode
- When testing approval workflows
- When debugging terminal rendering
- When understanding session continuity

---

### [03. Agent Guide](./03-agent-guide.md)
**Status:** ✅ Complete  
**Purpose:** HTTP/WebSocket API verification with distributed features

**Topics Covered:**
- REST API endpoint reference (sessions, executions, logs, config, visibility)
- WebSocket protocol documentation
- Distributed configuration management
- Cross-session query patterns
- Backend isolation verification
- curl and WebSocket client examples

**When to Use:**
- When verifying Agent APIs
- When testing distributed features
- When debugging WebSocket connections
- When understanding cross-session data access

---

### [04. App Guide](./04-app-guide.md)
**Status:** ✅ Complete  
**Purpose:** Web UI verification with distributed visualization

**Topics Covered:**
- UI component overview (Session Manager, Chat Timeline, Inspector Panel, Workspace Explorer)
- WebSocket integration patterns
- Real-time update verification
- Multi-session visualization
- Backend switching in UI
- Browser DevTools inspection

**When to Use:**
- When verifying App functionality
- When testing UI workflows
- When debugging WebSocket updates
- When understanding multi-session scenarios

---

### [05. Engine Guide](./05-engine-guide.md)
**Status:** ✅ Complete  
**Purpose:** Runtime internals verification with distributed execution

**Topics Covered:**
- Backend adapter implementation details (Claude Code, Codex, Gemini CLI, Hermes Agent)
- Memory system flow (extraction, storage, retrieval, injection)
- Visibility plane data structures (tokens, spans, memory, context)
- Configuration management internals (RedisConfigStore)
- Redis data structure specifications
- Protocol parsing and event mapping

**When to Use:**
- When verifying Engine internals
- When debugging backend adapters
- When understanding memory system
- When inspecting Redis data structures

---

## Guide Structure

Each guide follows a consistent 10-section structure:

1. **Introduction** - Purpose, scope, and audience
2. **Architecture Overview** - Component diagram and dependencies
3. **Prerequisites** - Required software, environment variables, infrastructure
4. **Installation and Setup** - Step-by-step setup with verification
5. **Core Functionality** - Feature-by-feature documentation with examples
6. **Distributed Features** - Backend configuration, cross-session access, distributed storage
7. **Manual Verification Methods** - Checklists, inspection commands, success criteria
8. **Troubleshooting** - Common issues, diagnosis, solutions, prevention
9. **Cleanup** - State reset, data cleanup, environment teardown
10. **References** - Related guides, external documentation, API references

## Verification Workflow

Each guide includes manual verification procedures following this pattern:

### Setup Phase
- Start required infrastructure (Redis, Agent, App)
- Build necessary packages
- Configure environment variables
- Verify prerequisites are met

### Execution Phase
- Run documented commands exactly as shown
- Observe output in real-time
- Check exit codes and output format
- Inspect side effects (Redis keys, files, processes)

### Validation Phase
- Compare actual output with expected output
- Verify data structures in Redis using `redis-cli`
- Check API responses with `curl` or browser DevTools
- Confirm state changes are correct

### Cleanup Phase
- Remove test data from Redis
- Stop background processes
- Reset environment to clean state
- Prepare for next verification

## Common Verification Commands

### Redis Inspection
```bash
# Check if Redis is running
redis-cli ping

# List all Iota keys
redis-cli KEYS "iota:*"

# Inspect session data
redis-cli HGETALL "iota:session:{sessionId}"

# Inspect execution data
redis-cli HGETALL "iota:exec:{executionId}"

# View event stream
redis-cli LRANGE "iota:events:{execId}" 0 -1

# Check memory count
redis-cli ZCARD "iota:memories:{sessionId}"

# View visibility data
redis-cli GET "iota:visibility:tokens:{execId}"
redis-cli LRANGE "iota:visibility:spans:{execId}" 0 -1
```

### Agent API Testing
```bash
# Check Agent health
curl http://localhost:9666/health

# Create session
curl -X POST http://localhost:9666/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workingDirectory":"/tmp"}'

# Get configuration
curl http://localhost:9666/api/v1/config

# Query logs
curl "http://localhost:9666/api/v1/logs?limit=10"

# Get backend isolation report
curl http://localhost:9666/api/v1/backend-isolation
```

### Process and Port Verification
```bash
# Check if Agent is running
lsof -i :9666

# Check if App is running
lsof -i :9888

# Check if Redis is running
lsof -i :6379

# List backend processes
ps aux | grep -E "claude|codex|gemini|hermes"
```

## Troubleshooting Quick Reference

### Redis Connection Issues
**Symptom:** `ECONNREFUSED 127.0.0.1:6379`  
**Solution:**
```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # Verify with PONG
```

### Backend Not Found
**Symptom:** `Backend 'claude-code' not found`  
**Solution:**
```bash
which claude  # Check if in PATH
iota status   # Check backend health
```

### Port Already in Use
**Symptom:** `EADDRINUSE: address already in use :::9666`  
**Solution:**
```bash
lsof -i :9666 -t | xargs kill -9
```

### WebSocket Connection Failed
**Symptom:** WebSocket connection errors in browser  
**Solution:**
```bash
# Verify Agent is running
lsof -i :9666
# Restart Agent if needed
cd iota-agent && bun run dev
```

## Infrastructure Setup

Before using any guide, ensure infrastructure is running:

### Start Redis
```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # Should return PONG
```

### Start Agent (for API/App verification)
```bash
cd iota-agent
bun install
bun run dev  # Listens on port 9666
```

### Start App (for UI verification)
```bash
cd iota-app
bun install
bun run dev  # Listens on port 9888
```

### Build Packages (for CLI/TUI verification)
```bash
# Build Engine
cd iota-engine
bun install
bun run build

# Build CLI
cd ../iota-cli
bun install
bun run build
```

## Contributing to Guides

When updating guides:

1. **Test all commands** - Every command must be tested and work as documented
2. **Document actual behavior** - Guides reflect reality, not aspirations
3. **Include expected outputs** - Show what users should see
4. **Add troubleshooting** - Document issues you encounter
5. **Update cross-references** - Keep links between guides current
6. **Maintain structure** - Follow the 10-section template
7. **Use consistent terminology** - Match terms across all guides

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | April 2026 | Initial guide series structure and index |

## Related Documentation

- [Project README](../../README.md) - Project overview and quick start
- [Engine README](../../iota-engine/README.md) - Engine-specific documentation
- [CLI README](../../iota-cli/README.md) - CLI-specific documentation
- [Agent README](../../iota-agent/README.md) - Agent-specific documentation
- [App README](../../iota-app/README.md) - App-specific documentation
- [Deployment README](../../deployment/README.md) - Infrastructure setup

## Support

For issues or questions:
- Check the Troubleshooting section in relevant guides
- Review the Architecture Overview for system understanding
- Inspect Redis data structures for state verification
- Use `--trace` flag with CLI commands for detailed logging

---

**Note:** This guide series emphasizes manual verification over automated testing. The goal is to provide clear, executable documentation that helps developers understand and verify system behavior through hands-on exploration.
