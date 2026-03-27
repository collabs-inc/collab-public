# Windows Support Summary

## Overview

This document summarizes the Windows-specific functionality implemented in the Collaborator application. The application provides cross-platform terminal support using a platform-agnostic abstraction layer that delegates to tmux-based backends on macOS/Linux and direct node-pty on Windows.

**Document Version:** 1.0
**Date:** 2026-03-22
**Platform Support:** Windows 10/11 (x64 and ARM64)

---

## Architecture

### Terminal Backend Abstraction

The application uses a `TerminalBackend` interface with platform-specific implementations:

| Platform | Implementation | Shell |
|----------|---------------|-------|
| Windows | `WindowsTerminalBackend` | PowerShell (preferred), cmd.exe (fallback) |
| macOS | `TmuxTerminalBackend` | User's default shell via tmux |
| Linux | `TmuxTerminalBackend` | User's default shell via tmux |

### Key Files

| File | Purpose |
|------|---------|
| `src/main/terminal-backend.ts` | Abstract interface and factory |
| `src/main/terminal-backend.windows.ts` | Windows implementation |
| `src/main/terminal-backend.tmux.ts` | macOS/Linux implementation |
| `src/main/paths.ts` | Platform-specific path resolution |
| `src/main/pty.ts` | PTY session management API |

---

## Windows-Specific Implementations

### 1. PTY Session Management

The Windows implementation (`WindowsTerminalBackend`) provides:

- **Direct node-pty integration** without tmux wrapper
- **PowerShell-first shell selection** with cmd.exe fallback
- **Session metadata persistence** for potential reconnection
- **Full lifecycle management** (create, write, resize, kill)

```typescript
// Shell detection on Windows
function getDefaultShell(): string {
  // Try PowerShell first
  const powerShellPaths = [
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];
  // Fallback to cmd.exe
  return "C:\\Windows\\System32\\cmd.exe";
}
```

### 2. Path Resolution

Windows uses standard Windows environment variables:

| Purpose | Windows Path | Fallback |
|---------|-------------|----------|
| Application Data | `%APPDATA%\Collaborator` | `%USERPROFILE%\.collaborator` |
| CLI Installation | `%LOCALAPPDATA%\Programs\Collaborator\bin` | `%USERPROFILE%\.local\bin` |
| CLI Executable | `collab.bat` | `collab.bat` |

### 3. Environment Setup

The Windows terminal backend configures the following environment variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `LANG` | `en_US.UTF-8` | UTF-8 output support |
| `COLORTERM` | `truecolor` | True color support |
| `TERM` | `xterm-256color` | Terminal type compatibility |

### 4. Build Configuration

Windows builds are configured in `package.json`:

```json
"win": {
  "target": [
    { "target": "nsis", "arch": ["x64", "arm64"] }
  ],
  "artifactName": "${productName}-${version}-win-${arch}.${ext}",
  "requestedExecutionLevel": "asInvoker"
}
```

---

## Testing

### Test Files Created

| File | Coverage |
|------|----------|
| `src/main/terminal-backend.test.ts` | Terminal backend functionality |
| `src/main/paths.test.ts` | Path resolution logic |

### Test Coverage

The test suite covers:

**Terminal Backend Tests:**
- Session creation with default and custom options
- Session lifecycle (create, write, resize, kill)
- Session metadata persistence
- Multi-session management
- Edge cases (rapid creation, operations after killAll)

**Path Resolution Tests:**
- Platform-specific base directory resolution
- CLI installation path resolution
- Executable naming conventions
- Environment variable handling

### Running Tests

```bash
# Run all tests
bun test

# Run terminal backend tests only
bun test src/main/terminal-backend.test.ts

# Run path resolution tests only
bun test src/main/paths.test.ts
```

---

## Known Limitations

### 1. Session Persistence

| Limitation | Description | Workaround |
|------------|-------------|------------|
| No persistent sessions | Windows does not support reconnection after app restart | Sessions are in-memory only; reconnection will fail with appropriate error message |
| Metadata cleanup | Orphaned metadata files may remain after unexpected shutdown | Automatic cleanup on `discoverSessions()` call |

### 2. Shell Features

| Limitation | Description |
|------------|-------------|
| PowerShell profiles | Custom profiles load by default (can be disabled with `-NoProfile`) |
| ANSI escape sequences | Some escape sequences may not render correctly in PowerShell |
| Unicode rendering | Complex Unicode characters may have display issues |

### 3. Build Process

| Limitation | Description |
|------------|-------------|
| Code signing | Windows code signing requires EV certificate for SmartScreen bypass |
| Architecture | Separate builds required for x64 and ARM64 |

### 4. Platform Detection

| Limitation | Description |
|------------|-------------|
| Runtime platform check | Platform detection happens at runtime, not compile time |
| Cross-platform testing | Tests run on actual platform; mocking required for cross-platform validation |

---

## Compatibility Matrix

| Feature | Windows 10 x64 | Windows 10 ARM64 | Windows 11 x64 | Windows 11 ARM64 |
|---------|----------------|------------------|----------------|------------------|
| Basic terminal | Supported | Supported | Supported | Supported |
| PowerShell | Supported | Supported | Supported | Supported |
| cmd.exe | Supported | Supported | Supported | Supported |
| ANSI colors | Supported | Supported | Supported | Supported |
| True color | Supported | Supported | Supported | Supported |
| Resizing | Supported | Supported | Supported | Supported |
| Session persistence | Supported* | Supported* | Supported* | Supported* |

*In-memory only; no cross-restart persistence

---

## Windows Installation Requirements

### Minimum Requirements

| Requirement | Value |
|-------------|-------|
| OS Version | Windows 10 version 1903 or later |
| Architecture | x64 or ARM64 |
| Memory | 4 GB RAM minimum (8 GB recommended) |
| Disk Space | 500 MB |

### Dependencies

The following are bundled with the application:

- **node-pty** - Native PTY module (rebuilt for Electron)
- **PowerShell** - Built into Windows 7+ (included by default)

---

## Build Instructions

### Windows Build Prerequisites

1. **Node.js** (LTS version recommended)
2. **Bun** (for package management)
3. **Visual Studio Build Tools** (for node-pty native compilation)
4. **Electron Rebuild** (included in devDependencies)

### Build Commands

```bash
# Install dependencies
bun install

# Rebuild native modules
bun run postinstall

# Build for Windows
bun run package:win

# Build for Windows x64 only
bun run package:win:x64

# Build for Windows ARM64 only
bun run package:win:arm64
```

### Code Signing (Optional)

```bash
bun run sign:win
```

---

## Troubleshooting

### Common Issues

#### 1. node-pty Build Failures

**Symptom:** `error MSB8020: The tools version v143 is not available`

**Solution:** Install Visual Studio Build Tools with C++ workload:
```
vs_buildtools.exe --add Microsoft.VisualStudio.Workload.VCTools
```

#### 2. PowerShell Execution Policy

**Symptom:** Terminal sessions fail to start

**Solution:** Check execution policy:
```powershell
Get-ExecutionPolicy -List
```

#### 3. Path Not Found Errors

**Symptom:** `Cannot find module 'node-pty'`

**Solution:** Rebuild native modules:
```bash
bun install
electron-rebuild -f -w node-pty
```

#### 4. Session Cleanup Issues

**Symptom:** Orphaned terminal processes after app exit

**Solution:** The `killAllAndWait()` method with 2-second timeout handles this. If issues persist, check Windows Task Manager.

---

## Quality Assurance Checklist

### Pre-Release Testing

- [ ] Application starts without errors
- [ ] Terminal sessions can be created
- [ ] PowerShell sessions work correctly
- [ ] cmd.exe fallback works when PowerShell unavailable
- [ ] Terminal input/output works bidirectionally
- [ ] Session resize works correctly
- [ ] Multiple sessions can be created simultaneously
- [ ] Sessions are properly cleaned up on close
- [ ] All sessions are killed on app exit
- [ ] CLI installation path is correct
- [ ] Application data directory is created correctly

### Automated Tests

- [ ] All unit tests pass (`bun test`)
- [ ] Terminal backend tests pass
- [ ] Path resolution tests pass
- [ ] No test warnings or skipped tests

### Platform Verification

- [ ] Tested on Windows 10 x64
- [ ] Tested on Windows 11 x64
- [ ] Tested on Windows 11 ARM64 (if available)
- [ ] Build artifacts are correctly signed (if signing enabled)

---

## Change Log

### Phase 5 Changes (2026-03-22)

| Change | File | Description |
|--------|------|-------------|
| Added | `src/main/terminal-backend.test.ts` | Unit tests for terminal backend |
| Added | `src/main/paths.test.ts` | Unit tests for path resolution |
| Added | `docs/WINDOWS_SUPPORT_SUMMARY.md` | This documentation |

---

## References

- [node-pty Documentation](https://github.com/microsoft/node-pty)
- [Electron Builder Windows Configuration](https://www.electron.build/configuration/win)
- [PowerShell Documentation](https://docs.microsoft.com/en-us/powershell/)
- [Clean Code Principles](https://blog.cleancoder.com/uncle-bob/2008/05/08/SoftwareCraftsmanship.html)

---

## Contact

For questions or issues related to Windows support, please refer to the project's issue tracker or contact the development team.
