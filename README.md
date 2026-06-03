# Markdown Editor

Persistent Markdown editor for Dokploy.

Features:
- Pretty markdown editor by default.
- Raw markdown editor toggle.
- Always-visible bottom prompt box that can ask an AI model to edit the current document.
- SQLite persistence under `/data` for Dokploy named volume mounting.

Environment:
- `PORT=3000`
- `DATA_DIR=/data`
- `SQLITE_PATH=/data/markdown-editor.sqlite`
- `OPENAI_API_KEY` or `CODEX_API_KEY` enables prompt editing.
- `AI_MODEL` sets the prompt-editing model; `OPENAI_MODEL` and `CODEX_MODEL` are supported as fallbacks.
- `OPENAI_BASE_URL` optional for compatible gateways.

Run locally:

```bash
npm install
DATA_DIR=./data SQLITE_PATH=./data/markdown-editor.sqlite npm start
```
