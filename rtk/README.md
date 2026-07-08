# RTK - Rust Token Killer Setup

RTK is a token-optimizing CLI proxy that reduces Bash output by 60-90% before sending to Claude.

## Installation

### Windows (PowerShell)

```powershell
.\rtk\setup-rtk.ps1
```

This downloads and installs RTK v0.43.0 to `rtk/bin/`. You can specify a different version:

```powershell
.\rtk\setup-rtk.ps1 -Version "v0.44.0"
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

This installs RTK to `~/.local/bin`.

## Verification

After installation, verify RTK is working:

```bash
rtk --version       # Should show version number
rtk gain            # Should show token savings (or 0 if no history)
```

## Configuration

After install, Claude Code hook needs to be restarted:
- **Close and reopen Claude Code**
- The hook will automatically intercept Bash commands
- All commands like `git status`, `cargo test`, etc. will be automatically optimized

## How It Works

RTK intercepts CLI commands and filters/compacts their output:

```
git status (verbose output)
    ↓
rtk hook (automatic)
    ↓
Optimized output (90% smaller)
    ↓
Claude receives only essential info
```

**Result**: 60-90% token savings on CLI operations!

## Commands

### Direct Usage (optional)

Most operations are automatic via hook, but you can use RTK explicitly:

```bash
rtk gain              # Show cumulative token savings
rtk gain --history    # Detailed savings per command  
rtk discover          # Find more optimization opportunities
```

### Auto-Wrapped Commands

These are automatically optimized (you just run them normally):
- `git status` → compacted status
- `git diff` → condensed diff
- `cargo test` → failures only
- `npm test` → summary only
- `ls` → optimized listing

## Security

- Binaries are NOT committed to git (installed locally)
- Downloads verified from official RTK releases
- Hook configuration in `.claude/settings.json`

## Troubleshooting

**"rtk: command not found"**
- Run the setup script: `.\rtk\setup-rtk.ps1`
- Or add `rtk/bin` to your PATH

**"rtk gain" shows command not found**
- You may have a different `rtk` package installed (Rust Type Kit)
- The hook still works correctly - just use `rtk gain --history` instead

**Changes not showing savings**
- RTK tracks history from each Claude Code session
- Run a few commands and check `rtk gain` again

## References

- [RTK on GitHub](https://github.com/rtk-ai/rtk)
- [Rust Token Killer documentation](https://github.com/rtk-ai/rtk#readme)
