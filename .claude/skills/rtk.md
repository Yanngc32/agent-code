# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy that reduces output to LLM by 60-90%

RTK automatically wraps common commands to filter and compress their output before sending to Claude. This is activated globally via hook, but you can also use RTK commands directly for explicit control.

**Setup**: See `rtk/README.md` and `rtk/setup-rtk.ps1` for installation instructions.

## Auto-Wrapped Commands (via hook)

These commands are automatically optimized when you run them in Bash:
- `git status` → `rtk git status` (compact format)
- `git diff` → `rtk git diff` (condensed diffs)
- `git log` → `rtk git log` (summary only)
- `cargo test` → `rtk cargo test` (failures only)
- `ls` / `dir` → `rtk ls` (optimized listing)

**Example**: Just run `git status` normally, RTK hook intercepts and optimizes it automatically.

## Direct RTK Commands (explicit use)

Use these when you want manual control:

```bash
# Analytics
rtk gain                # Show total token savings
rtk gain --history      # Detailed command history with savings per command
rtk discover            # Find missed optimization opportunities in history

# File Operations
rtk read file.ts        # Smart file reading (context-aware)
rtk ls .                # Optimized directory listing
rtk grep "pattern" .    # Grouped search results

# Git
rtk git status          # Compact status
rtk git diff            # Condensed diffs
rtk git push            # Shows only "ok branch"

# Testing
rtk cargo test          # Rust tests (90% reduction)
rtk pytest              # Python tests
rtk jest                # Jest results (failures only)

# Other
rtk docker ps           # Compact container list
rtk proxy <cmd>         # Bypass RTK filtering (debug)
```

## Configuration

- **Global filters**: `~/.rtk/filters.toml` (template available)
- **Hook status**: `rtk hook claude` (shows if hook is active)
- **Full reference**: See RTK.md in your user's .claude folder

## Installation Verification

```bash
rtk --version           # Should show version number
rtk gain                # Should display savings stats
```

⚠️ **Note**: If `rtk gain` shows "command not found", you may have a different `rtk` package installed (e.g., Rust Type Kit). The hook will still work correctly.
