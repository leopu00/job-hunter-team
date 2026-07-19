# Job Hunter Team — The Office

Godot 4.7 desktop application for Windows, macOS and Linux. The three native
presets are versioned in `export_presets.cfg`; CI imports, tests, exports and
smoke-runs the application on a native runner for every operating system.

The first-run experience is documented in [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md):
three token-free scripted conversations become hybrid free-text chats after a
provider and the real agents are connected.

## Development

- macOS/Linux: `tools/run.sh test` and `tools/run.sh play`
- Windows PowerShell: `tools/run.ps1 test` and `tools/run.ps1 play`
- Override the Windows Godot executable with `JHT_GODOT_BIN` when it is not in
  `PATH`.

The live VPS integration requires an OpenSSH client in `PATH`. The UI checks
both OpenSSH and the selected private key before connecting. Windows users can
enable the built-in **OpenSSH Client** optional feature; macOS and normal Linux
desktop installations already provide it.

## Native exports

Install the Godot 4.7 export templates, then run from `game/`:

```text
godot --headless --export-release "Windows Desktop" builds/windows/job-hunter-team.exe
godot --headless --export-release "macOS" builds/macos/job-hunter-team.zip
godot --headless --export-release "Linux" builds/linux/job-hunter-team.x86_64
```

The macOS preset deliberately keeps App Sandbox disabled: the live backend
starts the system OpenSSH client, which sandboxed applications cannot execute.
Tag releases require Apple Developer credentials, then CI signs, notarizes,
staples and verifies the app before publishing it. CI refuses to publish an
unsigned macOS game. Linux releases are wrapped in a `tar.gz` after `chmod +x`,
so extracting the archive preserves the executable bit.
