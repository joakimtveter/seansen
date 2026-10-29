# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Seansen is a Halloween-hackathon starter: a tool-using Claude agent that answers "who can take this job?" (staffing/bemanning) by searching synthetic data for 80 fictional consultants. Code, comments, identifiers, prompts and agent output are all in **Norwegian** (including non-ASCII identifiers like `kjør`, `verktøy`, `nivå`) — keep new code consistent with that.

## Commands

```bash
npm install
cp .env.example .env                                          # set ANTHROPIC_API_KEY
npm start                                                     # runs eksempelOppgave from src/verktoy.js
npm start -- "Vi trenger en React-utvikler i Bergen fra desember"   # custom request
npm run web                                                   # web UI on http://localhost:3000 (PORT to override)
```

- Requires Node >= 20.12 (uses `process.loadEnvFile()` and `import.meta.dirname`). ES modules (`"type": "module"`).
- Optional env: `MODELL` (default `claude-sonnet-5-5`), `MAX_ITERASJONER` (default 10, stops a looping agent).
- No build step, linter or test suite. Verify changes by running the agent and watching the printed tool calls.

## Architecture

- `src/index.js` — entry point: loads `.env`, takes the request from argv (or falls back to `eksempelOppgave`), calls `kjørAgent`.
- `src/server.js` — web entry point (plain `node:http`): serves `public/index.html` on `/` and runs `kjørAgent` for `POST /api/spor` (`{ oppgave }` → `{ svar, html }`: the final text as markdown, and rendered with `marked`). The renderer escapes raw HTML, drops images and only keeps http(s)/mailto links, since the answer is built from data we don't control — the page inserts `html` with `innerHTML` and relies on this. Tool calls still print to the server console.
- `src/agent.js` — the generic agent loop (~80 lines): calls `messages.create` with the tools, executes every `tool_use` block, returns all `tool_result`s in a single user message, repeats until `end_turn`, `refusal`, `max_tokens` or `MAX_ITERASJONER`. Tool exceptions are converted into `is_error: true` results so the model can retry; unknown tool names are handled the same way. Normally doesn't need changing.
- `src/verktoy.js` — where the hackathon work happens: the `system` prompt, `eksempelOppgave`, and the `verktøy` array.

### Tool contract

Each entry in `verktøy` is `{ definisjon, kjør }`:
- `definisjon` is the Anthropic tool definition (`name`, `description`, `input_schema`). The description is what the model reads, so write it like an explanation to a new colleague.
- `kjør` is an async function receiving the tool input; return a string or an object (objects are JSON-stringified). Throw an `Error` for invalid input — the message goes back to the model.
- **`kjør: null` marks a stub. `agent.js` only sends tools with a `kjør` function to the model**, so implementing a stub automatically activates it.

Currently only `sok_kompetanse` is implemented. Stubs with finished descriptions and TODO notes: `sjekk_tilgjengelighet`, `hent_cv`, `finn_prosjekthistorikk`. The TODOs call out edge cases to handle (empty/unknown id lists; missing CV files should return a clear text instead of throwing; validate ids in `hent_cv` to prevent path traversal like `../../.env`).

## Data (`data/`)

Loaded via `lesJson(fil)` in `verktoy.js`. All synthetic and deliberately a bit messy — CV and profile don't always agree.

- `konsulenter.json` — profiles keyed by `id` (`k001`–`k080`): `grad`, `rolle`, `avdeling`, `lokasjon` (Oslo/Bergen/Trondheim/Stavanger), `kompetanse[]` (`ferdighet`, `nivå` 1–5 self-assessed), `sertifiseringer`, `språk`.
- `tilgjengelighet.json` — one row per `id`: `nåværende_oppdrag` (`kunde`, `rolle`, `til`, or null), `ledig_fra` (ISO date), `ledig_prosent`, optional free-text `kommentar` that may restrict what they can take.
- `prosjekthistorikk.json` — keyed by **`konsulent_id`** (not `id`): `prosjekter[]` with `kunde`, `bransje`, `år`, `rolle`, `teknologier`.
- `cv/<id>.md` — short markdown CV summaries; only ~20 consultants have one.

**Grad** is assumed to run A (graduate/junior) → E (most senior). If that changes, update both the `system` prompt and the `sok_kompetanse` description.

`.env` is gitignored and must never be committed.
