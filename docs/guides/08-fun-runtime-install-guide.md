# Fun Runtime 运行时安装指南

本文档记录了执行 `iota-skill/pet-generator/iota-fun/` 下示例 Function 函数所需的本地 Runtime 运行时要求，以及在此 Windows Workspace 工作区上的当前验证状态。

## 当前状态

-  `python`: 已安装，已验证 `Python 3.14.3`
-  `node`: 已安装，已验证 `v24.13.1`
-  `go`: 已安装，已验证 `go1.26.2`
-  `rustc`: 已安装，已验证 `rustc 1.92.0`
-  `javac`: 已安装，已验证 `javac 21.0.3`
-  `zig`: 已安装，已验证 `0.16.0`
-  `g++`: 已安装在 `C:\ProgramData\mingw64\mingw64\bin\g++.exe`；编译还需要将该目录添加到 `PATH` 以便解析 MinGW 辅助二进制文件

## 已验证的执行

-  Python 函数从 `iota-skill/pet-generator/iota-fun/python/random_number.py` 成功执行
-  TypeScript 函数从 `iota-skill/pet-generator/iota-fun/typescript/randomColor.ts` 成功执行
-  Go 函数在对齐 `iota-skill/pet-generator/iota-fun/go/` 中的包名后成功执行
-  Rust 函数在移除外部 `rand` crate 依赖后成功执行
-  Java 源代码可以编译和运行，但由于控制台编码问题，此终端仍显示中文输出乱码
-  Zig 运行时已安装；示例运行器已调整以兼容 Zig 0.16
-  C++ 函数在将 `C:\ProgramData\mingw64\mingw64\bin` 添加到 `PATH` 前面后成功执行

## 已安装的工具链

### Zig

已安装并验证：

```powershell
zig version
```

### C++ g++

通过 MinGW 安装。如果当前 shell 中仍无法识别 `g++`，请运行：

```powershell
refreshenv
```

或重新打开 PowerShell。

直接验证路径：

```powershell
& 'C:\ProgramData\mingw64\mingw64\bin\g++.exe' --version
```

编译时，此目录还需要存在于 `PATH` 中，因为 `g++.exe` 依赖于同级的 MinGW 工具，如 `cc1plus.exe`。

## 安装尝试记录

-  `winget install --id zig.zig` 后来确认已安装；`zig version` 现在返回 `0.16.0`。
-  `choco install mingw -y` 后来成功完成，并将 MinGW 部署到 `C:\ProgramData\mingw64\mingw64\bin`。

## 执行命令

### Python

```powershell
python -c "import importlib.util; spec = importlib.util.spec_from_file_location('random_number', r'D:\coding\creative\iota\iota-fun\python\random_number.py'); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(module.random_number())"
```

### TypeScript

```powershell
node -e "const fs=require('node:fs'); let source=fs.readFileSync('D:/coding/creative/iota/iota-fun/typescript/randomColor.ts','utf8'); source=source.replace('export function randomColor(): string {','function randomColor() {'); eval(source+'\nconsole.log(randomColor());');"
```

### Go

```powershell
cd D:\coding\creative\iota\iota-fun\go
go run random_shape.go runner.go
```

### Rust

```powershell
cd D:\coding\creative\iota\iota-fun\rust
rustc runner.rs -o $env:TEMP\iota-fun-rust.exe
& $env:TEMP\iota-fun-rust.exe
Remove-Item $env:TEMP\iota-fun-rust.exe
```

### Java

```powershell
cd D:\coding\creative\iota\iota-fun\java
javac -encoding UTF-8 RandomAnimal.java RandomAnimalRunner.java
cmd /c "java RandomAnimalRunner"
Remove-Item RandomAnimal.class, RandomAnimalRunner.class
```

### Zig

```powershell
cd D:\coding\creative\iota\iota-fun\zig
zig run runner.zig
```

### C++

```powershell
cd D:\coding\creative\iota\iota-fun\cpp
& 'C:\ProgramData\mingw64\mingw64\bin\g++.exe' random_action_runner.cpp -o random_action_runner.exe
$env:PATH = 'C:\ProgramData\mingw64\mingw64\bin;' + $env:PATH
cmd /c random_action_runner.exe
Remove-Item .\random_action_runner.exe
```
