# Agent Dashboard

- This is a Windows-only TypeScript Obsidian community plugin, not a general web app.
- Plugin ID: `agent-dashboard`; version: `0.3.0`; minimum Obsidian: `1.8.0`.
- Source root: this checkout. Machine paths are deliberately NOT in the repo:
  `work/local-paths.json` (gitignored; copy `work/local-paths.example.json` to create it)
  holds the vault roots.
- Deployment targets (the plugin is installed in **two** vaults, each with its own `data.json`;
  both must be updated or the user's open vault keeps running the old build):
  - `<vault A>\.obsidian\plugins\agent-dashboard`
  - `<vault B>\.obsidian\plugins\agent-dashboard` (the vault the user actually keeps open)
- Deploy with `pwsh -File work/deploy.ps1` (add `-WithAssets` when `assets/tarot` changed) or
  `npm run deploy` (the same steps in Node; `node deploy.mjs --dry-run` only prints targets).
  Both build, back up each target to `.backup-<stamp>`, and copy the three runtime files;
  deploy.ps1 throws unless the two copies end up byte-identical, deploy.mjs prints both
  sha256 for the same check. Do not hand-copy a single vault.
- The user must toggle the plugin (or restart Obsidian) after a deploy; the running instance
  keeps the old `main.js` in memory.
- Use Obsidian public APIs. Do not depend on undocumented internals.
- Keep UI, data acquisition, cache, and Codex process execution in separate modules.
- Network requests, Codex execution, and Vault writes must be explicit in code and covered by failure states.
- Never accept arbitrary shell commands or use approval/sandbox bypass flags.
- Runtime release files are `main.js`, `manifest.json`, and `styles.css`.
- Required verification: `npm test`, `npm run build`, and `npm run lint`.
- Do not create a remote or commit unless the user explicitly authorizes it.
