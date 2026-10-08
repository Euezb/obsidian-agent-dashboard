# Agent Dashboard

- This is a Windows-only TypeScript Obsidian community plugin, not a general web app.
- Plugin ID: `agent-dashboard`; version: `0.1.0`; minimum Obsidian: `1.8.0`.
- Source root: this checkout (machine paths live in `work/local-paths.json`, gitignored).
- Deployment targets: both vaults come from `work/local-paths.json`;
  the install path is `<vault>\.obsidian\plugins\agent-dashboard`.
- Use Obsidian public APIs. Do not depend on undocumented internals.
- Keep UI, data acquisition, cache, and Codex process execution in separate modules.
- Network requests, Codex execution, and Vault writes must be explicit in code and covered by failure states.
- Never accept arbitrary shell commands or use approval/sandbox bypass flags.
- Runtime release files are `main.js`, `manifest.json`, and `styles.css`.
- Required verification: `npm test`, `npm run build`, and `npm run lint`.
- Do not create a remote or commit unless the user explicitly authorizes it.
