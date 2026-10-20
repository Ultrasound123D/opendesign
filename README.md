<p align="center">
  <img src="img/icon.png" width="160" alt="opendesign icon" />
</p>

<h1 align="center">opendesign</h1>

<p align="center"><em>An AI design agent you chat with — it designs for real.</em></p>

opendesign is a Codex/opencode-style chat application wired to a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) design server. You describe a UI, the agent plans, calls MCP tools and builds the actual design inside [OpenFigma](https://github.com/Ultrasound123D/openfigma) — while you watch **what it is thinking, when it is planning, and which tools it is using**, live.

```
┌────────────┐   SSE    ┌───────────────────────────────────────────┐
│  Browser   │ ◀──────▶ │  opendesign (Next.js)                     │
│  chat UI   │  fetch   │  ├─ /api/chat ── agent engine (tool loop) │
└────────────┘          │  ├─ provider registry (models.dev + custom)│
                        │  ├─ MCP client manager                    │
                        │  └─ sessions + memory (file storage)       │
                        └──────────────┬───────────────┬────────────┘
                                       │               │
                        any LLM provider │               │ MCP (stdio / HTTP)
                        (OpenAI, Anthropic,             ▼
                         Google, OpenRouter,      OpenFigma MCP server
                         Groq, DeepSeek, xAI,     (52 design tools)
                         Z.ai, custom, …)               │
                                                        ▼
                                                 OpenFigma editor
                                              (live canvas updates)
```

## Features

### Providers — exactly the opencode way
- **Full catalog** from [models.dev](https://models.dev) (the same source opencode uses — 200+ providers: OpenAI, Anthropic, Google, OpenRouter, Groq, DeepSeek, Mistral, xAI, Z.ai, …), cached on disk with a 24h TTL and an offline fallback.
- **API token + endpoint per provider** (Settings → Providers): paste a key, optionally override the base URL. Keys are stored locally in `~/.opendesign/settings.json` and never sent anywhere except the provider you configured.
- **Environment fallback** exactly like opencode: each provider declares its env names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) plus the generic `OPENDESIGN_<PROVIDER>_API_KEY`.
- **Custom providers** (opencode-style): any OpenAI-compatible endpoint with `{env:NAME}` substitution in the base URL:

```jsonc
// ~/.opendesign/settings.json
{
  "customProviders": {
    "acme": {
      "name": "Acme",
      "baseURL": "https://llm.acme.example/v1",   // supports {env:ACME_URL}
      "apiKey": "…",                               // or env: ["ACME_API_KEY"]
      "models": { "qwen3-coder": { "name": "Qwen 3 Coder" } }
    }
  }
}
```

### Full streaming transparency
Every assistant turn streams as structured events (the same event model opencode uses):
- 💭 **Thinking** — collapsible reasoning blocks for reasoning models, live while streaming
- 📝 **Plan mode** — a Build/Plan toggle like opencode's agent switch. Plan mode is read-only (mutating tools are filtered out) and the agent must call `write_plan`; the plan is stored on the session and re-injected when you switch to Build
- 🔧 **MCP tool cards** — each tool call shows its name, arguments (streamed live while the model writes them), status (preparing → running → completed/failed) and truncated output

### Memory
- **Sessions** — every conversation is persisted (`~/.opendesign/sessions/*.json`) with full message parts, resumable anytime
- **Long-term memory** — the agent has `memory_save` / `memory_search` / `memory_list` / `memory_delete` tools; recent memories are auto-injected into every system prompt (opencode v2 has no memory subsystem — this is an intentional extension)

### MCP integration
- Local (stdio) and remote (HTTP) servers, configured in Settings → MCP or `settings.json`
- Tools are namespaced `{server}_{tool}` (opencode convention), server JSON Schemas pass through untouched
- Per-server execution timeout, auto-reconnect, live status + tool explorer
- Default seed: auto-detects a sibling `openfigma/` checkout and registers its MCP server (52 tools: projects, elements, transforms, styling, pages, composed drawing)

## Getting started

```bash
# 1. Install
bun install        # or: npm install

# 2. Run the design editor (OpenFigma) — needs its own port
git clone https://github.com/Ultrasound123D/openfigma ../openfigma
cd ../openfigma && npm install && npm run build && npm run start   # port 3000

# 3. Run opendesign (use another port for the editor, e.g. 3111)
cd ../opendesign
OPENFIGMA_API_URL=http://localhost:3111 bun run dev                # port 3000
```

Then:
1. Open **Settings → Providers**, paste an API key for any provider (or export e.g. `OPENAI_API_KEY` before starting), or add a **Custom provider**.
2. Make sure the MCP server points at your editor: **Settings → MCP → openfigma** — the command is auto-seeded if `../openfigma` exists; set `EDITOR_API_URL` in its environment to your editor's URL.
3. Chat: *"Create a music player mobile screen with a dark theme"* and watch it build.

> **No API key at all?** On platforms where the `z-ai-web-dev-sdk` package is installed, a built-in **`zai-sandbox`** provider (GLM-4.6) appears automatically and works with zero configuration. On a plain clone it is simply absent.

### Data & configuration

| Path | Contents |
|---|---|
| `~/.opendesign/settings.json` | providers (keys/endpoints), custom providers, MCP servers, default model, agent steps |
| `~/.opendesign/sessions/` | one JSON file per session |
| `~/.opendesign/memory.json` | long-term memories |
| `~/.opendesign/catalog-cache.json` | models.dev catalog cache |

Override the directory with `OPENDESIGN_DATA_DIR`.

### Scripts

```bash
bun run dev    # development server (port 3000)
bun run build  # production build (standalone output)
bun run start  # run the standalone production server
bun run lint   # eslint
```

## How it relates to opencode

opendesign replicates the mechanisms of [opencode](https://github.com/sst/opencode) v2 (analyzed from source) for the design domain:

| Mechanism | opencode v2 | opendesign |
|---|---|---|
| Provider catalog | models.dev + bundled snapshot, 5-min cache | models.dev + disk cache, 24h TTL |
| Custom providers | `providers.<id> = {package, settings.baseURL, models}` | `customProviders.<id> = {baseURL, apiKey, env, models}` |
| Auth | SQLite credential store + env fallback | settings file + env fallback |
| Agent loop | hand-rolled step runner, normalized LLM events | AI SDK `streamText` multi-step + same event model (`text-*`, `reasoning-*`, `tool-input-*`, `tool-call/result`, `step-finish`) |
| MCP | `@modelcontextprotocol/client` 2.0, `server_tool` namespacing, JSON Schema pass-through | `@modelcontextprotocol/sdk` 1.x, identical namespacing & pass-through |
| Plan mode | dedicated `plan` agent + permission deny-rules | Build/Plan toggle; mutating tools filtered + `write_plan` tool |
| Memory | none in v2 (AGENTS.md/skills only) | session persistence + memory tools + prompt injection |
| Persistence | event-sourced SQLite | JSON files (zero native deps) |

## API surface

| Route | Purpose |
|---|---|
| `POST /api/chat` | SSE agent stream (session create, user message, assistant parts) |
| `GET /api/sessions`, `GET/PATCH/DELETE /api/sessions/:id` | session CRUD |
| `GET /api/providers` | full provider/model catalog with key status |
| `POST /api/providers/test` | verify an endpoint/key by listing models |
| `GET/PUT /api/settings` | settings (keys are write-only; GET never returns them) |
| `GET/POST /api/mcp` | MCP server statuses + tools / force reload |
| `GET/POST/DELETE /api/memory` | memory store |
| `POST /api/editor/ensure` | convenience: spawn the sibling OpenFigma editor if reachable path exists |

## License

MIT
