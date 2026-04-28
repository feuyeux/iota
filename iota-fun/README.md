# Iota Fun - Multi-Language Function Examples

> **Version:** 1.0  
> **Last Updated:** 2026-04-28

## Overview

`iota-fun/` contains example functions in multiple programming languages that demonstrate Iota's multi-language execution capabilities. These functions can be executed directly via `IotaFunEngine` or automatically routed through `IotaEngine` using natural language prompts.

## Purpose

- **Demonstrate multi-language support**: Show how Iota can execute code in Python, TypeScript, Go, Rust, Zig, Java, and C++
- **Provide simple examples**: Each function generates a random value (number, color, shape, material, size, animal, action)
- **Enable testing**: Serve as test cases for the fun-call routing system
- **Educational reference**: Help developers understand how to add new language support

## Directory Structure

```
iota-fun/
├── python/
│   └── random_number.py          # Generates random number (1-100)
├── typescript/
│   ├── randomColor.ts            # Generates random color
│   └── runner.js                 # TypeScript runner
├── go/
│   ├── random_shape.go           # Generates random shape
│   └── runner.go                 # Go runner
├── rust/
│   ├── random_material.rs        # Generates random material
│   └── runner.rs                 # Rust runner
├── zig/
│   ├── random_size.zig           # Generates random size
│   └── runner.zig                # Zig runner
├── java/
│   ├── RandomAnimal.java         # Generates random animal
│   └── RandomAnimalRunner.java   # Java runner
├── cpp/
│   ├── random_action.cpp         # Generates random action
│   └── random_action_runner.cpp  # C++ runner
└── README.md                     # This file
```

## Supported Languages and Functions

| Language | Function | Output Example | File |
|----------|----------|----------------|------|
| Python | `random_number()` | `42` | `python/random_number.py` |
| TypeScript | `randomColor()` | `"blue"` | `typescript/randomColor.ts` |
| Go | `RandomShape()` | `"circle"` | `go/random_shape.go` |
| Rust | `random_material()` | `"metal"` | `rust/random_material.rs` |
| Zig | `randomSize()` | `"large"` | `zig/random_size.zig` |
| Java | `RandomAnimal.get()` | `"elephant"` | `java/RandomAnimal.java` |
| C++ | `randomAction()` | `"jump"` | `cpp/random_action.cpp` |

## Usage

### Method 1: Direct Execution via IotaFunEngine

When you know the exact language to execute:

```typescript
import path from "node:path";
import { IotaFunEngine } from "@iota/engine";

const funEngine = new IotaFunEngine(path.resolve("./iota-fun"));

// Execute Python function
const result = await funEngine.execute({
  language: "python",
  timeoutMs: 30_000,
});

console.log(result.value);        // "42"
console.log(result.command);      // "python3"
console.log(result.args);         // ["python/random_number.py"]
console.log(result.exitCode);     // 0
```

### Method 2: Natural Language Routing via IotaEngine

Let Iota automatically detect and route based on natural language prompts:

```typescript
import { IotaEngine } from "@iota/engine";

const engine = new IotaEngine({
  workingDirectory: process.cwd(),
});

await engine.init();

// Natural language prompt - automatically routed to Python
const response = await engine.execute({
  sessionId: "session-1",
  prompt: "请用 python 随机生成 1-100 的数字",
});

console.log(response.output);  // "42"
```

### Supported Prompt Patterns

The following Chinese prompts will automatically route to the corresponding language:

- `请用 python 随机生成 1-100 的数字` → Python
- `请用 typescript 随机生成一种颜色` → TypeScript
- `请用 go 随机生成一种形状` → Go
- `请用 rust 随机生成一种材质` → Rust
- `请用 zig 随机生成一种尺寸` → Zig
- `请用 java 随机生成一种动物` → Java
- `请用 c++ 随机生成一个动作` → C++

## Function Details

### Python: Random Number (1-100)

**File:** `python/random_number.py`

```python
import random

def random_number() -> int:
    return random.randint(1, 100)
```

**Output:** Integer between 1 and 100

---

### TypeScript: Random Color

**File:** `typescript/randomColor.ts`

```typescript
const COLORS = ["red", "blue", "green", "yellow", "black", "white"];

export function randomColor(): string {
  const index = Math.floor(Math.random() * COLORS.length);
  return COLORS[index];
}
```

**Output:** One of: `red`, `blue`, `green`, `yellow`, `black`, `white`

---

### Go: Random Shape

**File:** `go/random_shape.go`

```go
package main

import "math/rand"

var shapes = []string{"circle", "square", "triangle", "star", "hexagon"}

func RandomShape() string {
    return shapes[rand.Intn(len(shapes))]
}
```

**Output:** One of: `circle`, `square`, `triangle`, `star`, `hexagon`

---

### Rust: Random Material

**File:** `rust/random_material.rs`

```rust
pub fn random_material() -> &'static str {
    let materials = ["wood", "metal", "glass", "plastic", "stone"];
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos() as usize)
        .unwrap_or(0);
    materials[nanos % materials.len()]
}
```

**Output:** One of: `wood`, `metal`, `glass`, `plastic`, `stone`

---

### Zig: Random Size

**File:** `zig/random_size.zig`

**Output:** One of: `small`, `medium`, `large`, `extra-large`

---

### Java: Random Animal

**File:** `java/RandomAnimal.java`

**Output:** One of: `elephant`, `tiger`, `dolphin`, `eagle`, `panda`

---

### C++: Random Action

**File:** `cpp/random_action.cpp`

**Output:** One of: `run`, `jump`, `swim`, `fly`, `climb`

---

## Prerequisites

To execute these functions, you need the following language runtimes installed:

| Language | Required Runtime | Version Check |
|----------|-----------------|---------------|
| Python | `python3` | `python3 --version` |
| TypeScript | `bun` or `node` + `ts-node` | `bun --version` |
| Go | `go` | `go version` |
| Rust | `rustc` | `rustc --version` |
| Zig | `zig` | `zig version` |
| Java | `java` + `javac` | `java --version` |
| C++ | `g++` or `clang++` | `g++ --version` |

## How It Works

### Execution Flow

1. **Intent Detection**: `IotaEngine` detects fun-call intent from natural language prompt
2. **Language Extraction**: Extracts target language (python, typescript, go, etc.)
3. **Routing**: Routes to `IotaFunEngine` instead of backend adapters
4. **Execution**: `IotaFunEngine` spawns subprocess with appropriate command
5. **Output Capture**: Captures stdout/stderr and exit code
6. **Value Parsing**: Extracts final value from stdout
7. **Result Return**: Returns structured result to caller

### Command Mapping

| Language | Command | Args |
|----------|---------|------|
| Python | `python3` | `["python/random_number.py"]` |
| TypeScript | `bun` | `["typescript/runner.js"]` |
| Go | `go` | `["run", "go/runner.go"]` |
| Rust | `rustc` + binary | `["rust/runner.rs", "-o", "/tmp/runner"]` then `["/tmp/runner"]` |
| Zig | `zig` | `["run", "zig/runner.zig"]` |
| Java | `javac` + `java` | Compile then `["java", "-cp", "java", "RandomAnimalRunner"]` |
| C++ | `g++` + binary | `["cpp/random_action_runner.cpp", "-o", "/tmp/runner"]` then `["/tmp/runner"]` |

## Adding New Languages

To add support for a new language:

1. **Create directory**: `mkdir iota-fun/<language>/`
2. **Add function file**: Implement your random function
3. **Add runner file**: Create entry point that calls the function
4. **Update IotaFunEngine**: Add language mapping in `iota-engine/src/fun-engine.ts`
5. **Update intent detection**: Add prompt patterns in `iota-engine/src/fun-intent.ts`
6. **Add tests**: Create test cases in `iota-engine/src/fun-engine.test.ts`
7. **Update documentation**: Add to this README and `docs/guides/07-fun-call-guide.md`

### Example: Adding Ruby Support

```bash
# 1. Create directory
mkdir iota-fun/ruby

# 2. Create function file
cat > iota-fun/ruby/random_weather.rb << 'EOF'
def random_weather
  weathers = ["sunny", "rainy", "cloudy", "snowy", "windy"]
  weathers.sample
end

puts random_weather
EOF

# 3. Update IotaFunEngine mapping
# Add to iota-engine/src/fun-engine.ts:
# case "ruby":
#   return { command: "ruby", args: ["ruby/random_weather.rb"] };

# 4. Update intent detection
# Add to iota-engine/src/fun-intent.ts:
# if (prompt.includes("ruby") && prompt.includes("天气")) {
#   return { language: "ruby" };
# }

# 5. Test
bun test iota-engine/src/fun-engine.test.ts
```

## Testing

### Unit Tests

```bash
cd iota-engine
bun test src/fun-engine.test.ts
```

### Manual Testing

```bash
# Test Python
cd iota-fun
python3 python/random_number.py

# Test TypeScript
bun typescript/runner.js

# Test Go
go run go/runner.go

# Test Rust
rustc rust/runner.rs -o /tmp/rust_runner && /tmp/rust_runner

# Test Zig
zig run zig/runner.zig

# Test Java
cd java && javac RandomAnimal.java RandomAnimalRunner.java && java RandomAnimalRunner

# Test C++
g++ cpp/random_action_runner.cpp -o /tmp/cpp_runner && /tmp/cpp_runner
```

### Integration Testing via CLI

```bash
cd iota-cli
node dist/index.js run --backend claude-code "请用 python 随机生成 1-100 的数字"
node dist/index.js run --backend claude-code "请用 typescript 随机生成一种颜色"
node dist/index.js run --backend claude-code "请用 go 随机生成一种形状"
```

## Troubleshooting

### Common Issues

**Issue: "Command not found"**
- **Cause**: Language runtime not installed
- **Solution**: Install the required runtime (see Prerequisites)

**Issue: "Permission denied"**
- **Cause**: Runner file not executable
- **Solution**: `chmod +x iota-fun/<language>/runner.*`

**Issue: "Compilation failed"**
- **Cause**: Syntax error or missing dependencies
- **Solution**: Test the file directly with the language compiler

**Issue: "Timeout"**
- **Cause**: Function takes too long to execute
- **Solution**: Increase `timeoutMs` parameter

**Issue: "Empty output"**
- **Cause**: Function doesn't print to stdout
- **Solution**: Ensure function prints result to stdout

## Performance Considerations

- **Compilation overhead**: Compiled languages (Rust, C++, Java) have compilation overhead on first run
- **Subprocess spawn**: Each execution spawns a new subprocess (~10-50ms overhead)
- **Timeout**: Default timeout is 30 seconds, adjust based on function complexity
- **Caching**: Consider caching compiled binaries for compiled languages

## Security Considerations

- **Sandboxing**: Functions run in subprocess, not in main process
- **Timeout**: All executions have timeout to prevent hanging
- **Input validation**: Validate language parameter to prevent command injection
- **Working directory**: Functions execute in isolated `iota-fun/` directory
- **No network access**: Example functions don't require network access

## Related Documentation

- [07-fun-call-guide.md](../docs/guides/07-fun-call-guide.md) - Detailed fun-call guide
- [05-engine-guide.md](../docs/guides/05-engine-guide.md) - Engine architecture
- [iota-engine/src/fun-engine.ts](../iota-engine/src/fun-engine.ts) - Implementation
- [iota-engine/src/fun-intent.ts](../iota-engine/src/fun-intent.ts) - Intent detection
- [../iota-skill/pet-generator/SKILL.md](../iota-skill/pet-generator/SKILL.md) - Skill spec for multi-language pet generation

## Contributing

To contribute new language examples:

1. Follow the directory structure convention
2. Keep functions simple and deterministic
3. Add comprehensive tests
4. Update all documentation
5. Ensure cross-platform compatibility

## License

Part of the Iota project. See root LICENSE file.

---

## Quick Reference

### Execute All Languages

```bash
# From iota-fun/ directory
python3 python/random_number.py
bun typescript/runner.js
go run go/runner.go
rustc rust/runner.rs -o /tmp/rust_runner && /tmp/rust_runner
zig run zig/runner.zig
cd java && javac *.java && java RandomAnimalRunner && cd ..
g++ cpp/random_action_runner.cpp -o /tmp/cpp_runner && /tmp/cpp_runner
```

### Expected Outputs

- Python: `42` (or any number 1-100)
- TypeScript: `blue` (or any color)
- Go: `circle` (or any shape)
- Rust: `metal` (or any material)
- Zig: `large` (or any size)
- Java: `elephant` (or any animal)
- C++: `jump` (or any action)
