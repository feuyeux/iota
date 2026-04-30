# iota TUI - Multi-Backend Weather Demo
# Records switching through all 5 backends and asking about weather

Output demo-backends.mp4
Set FontSize 16
Set Width 1400
Set Height 700
Set Theme "Catppuccin Mocha"
Set Shell "pwsh"
Set TypingSpeed 60ms

# Start the TUI
Type "cd D:/coding/creative/iota/iota-cli && node dist/index.js interactive"
Enter
Sleep 3s

# --- Backend 1: Claude Code ---
Type "switch claude-code"
Enter
Sleep 2s
Type "What is the weather like today in Tokyo?"
Enter
Sleep 8s

# --- Backend 2: Codex ---
Type "switch codex"
Enter
Sleep 2s
Type "What is the weather like today in Tokyo?"
Enter
Sleep 8s

# --- Backend 3: Gemini ---
Type "switch gemini"
Enter
Sleep 2s
Type "What is the weather like today in Tokyo?"
Enter
Sleep 8s

# --- Backend 4: Hermes ---
Type "switch hermes"
Enter
Sleep 2s
Type "What is the weather like today in Tokyo?"
Enter
Sleep 8s

# --- Backend 5: OpenCode ---
Type "switch opencode"
Enter
Sleep 2s
Type "What is the weather like today in Tokyo?"
Enter
Sleep 8s

# Exit
Type "exit"
Enter
Sleep 1s
