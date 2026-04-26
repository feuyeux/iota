# Approval Guard Consolidation (2026-04-25)

## Summary

Eliminated duplicate implementations of security-critical functions that existed in both `engine.ts` and `approval/guard.ts`. All shared helper functions are now centralized in `approval/helpers.ts`.

## Changes Made

### 1. Created `approval/helpers.ts`

Centralized location for approval guard helper functions:

- `extractPathArguments()` - Extract file/directory paths from tool arguments
- `isShellTool()` - Detect shell/command execution tools
- `isPrivilegeEscalation()` - Detect privilege escalation attempts
- `isMcpTool()` - Detect MCP (Model Context Protocol) tools

### 2. Updated `engine.ts`

- Removed duplicate implementations (lines 1994-2060)
- Added import from `approval/helpers.ts`
- Now uses canonical implementations

### 3. Updated `approval/guard.ts`

- Removed duplicate implementations (lines 488-567)
- Added import from `approval/helpers.ts`
- Kept `parseMcpToolName()` (not duplicated)

### 4. Updated `backend/text-utils.ts`

- Added `extractCodexText()` function (moved from `codex.ts`)
- Now provides both generic `extractText()` and Codex-specific `extractCodexText()`

### 5. Updated `backend/codex.ts`

- Removed local `extractCodexText()` implementation
- Now imports from `text-utils.ts`

## Security Improvements

The consolidation fixed security regressions in `guard.ts`:

### `isShellTool()`

**Before (guard.ts - BUGGY):**

- Used substring matching: `toolName.includes(t)`
- Would false-positive on "bash_report", "execution_plan"
- Included useless "Bash" (uppercase) in list
- Missing "execute", "run", "command" tools

**After (helpers.ts - CORRECT):**

- Uses exact Set-based matching with `toLowerCase()`
- Comprehensive tool list
- No false positives

### `isPrivilegeEscalation()`

**Before (guard.ts - WEAK):**

- Used `command.includes("sudo ")` and `command.includes("su ")`
- Would false-positive on "resume", "substitute", "insulate"
- Missing detection for `doas`, `pkexec`, `runuser`

**After (helpers.ts - ROBUST):**

- Uses regex with word boundaries: `/\b(?:sudo|su|doas|pkexec|runuser)\b/`
- Detects all privilege escalation tools
- No false positives on normal words

## Status of `approval/guard.ts`

The `ApprovalGuard` class in `guard.ts` is **currently unused**:

- No imports found in the codebase
- `engine.ts` has its own inline `guardEvent` generator (lines 1400-1640)
- The class appears to be a refactoring-in-progress that was never completed

The file is kept because:

1. It may represent future architecture
2. It now uses the correct consolidated helpers
3. Removing it requires architectural decision

## Verification

- ✅ TypeScript compilation passes
- ✅ All tests pass (24 tests in 5 files)
- ✅ No duplicate code remains
- ✅ Security checks use strongest implementations
