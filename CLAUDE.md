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
- `src/server.js` — web entry point (plain `node:http`): serves `public/index.html` on `/` and runs `kjørAgent` for `POST /api/spor` (`{ oppgave }`). The response is streamed as NDJSON, one event per line: `tanke`, `kall` (with `personer`, the names for the ids in the input), `resultat`, then finally `svar` (`{ svar, html }`: the final text as markdown, and rendered with `marked`) or `feil`. The page shows the events as a live log. The renderer escapes raw HTML, drops images and only keeps http(s)/mailto links, since the answer is built from data we don't control — the page inserts `html` with `innerHTML` and relies on this. Tool calls still print to the server console.
- `src/agent.js` — the generic agent loop (~80 lines): calls `messages.create` with the tools, executes every `tool_use` block, returns all `tool_result`s in a single user message, repeats until `end_turn`, `refusal`, `max_tokens` or `MAX_ITERASJONER`. Tool exceptions are converted into `is_error: true` results so the model can retry; unknown tool names are handled the same way. Optional `påHendelse` callback receives each step (`tanke`, `kall`, `resultat`) for the web UI; terminal logging is unchanged. Normally doesn't need changing.
- `src/verktoy.js` — where the hackathon work happens: the `system` prompt, `eksempelOppgave`, and the `verktøy` array.

### Tool contract

Each entry in `verktøy` is `{ definisjon, kjør }`:
- `definisjon` is the Anthropic tool definition (`name`, `description`, `input_schema`). The description is what the model reads, so write it like an explanation to a new colleague.
- `kjør` is an async function receiving the tool input; return a string or an object (objects are JSON-stringified). Throw an `Error` for invalid input — the message goes back to the model.
- **`kjør: null` marks a stub. `agent.js` only sends tools with a `kjør` function to the model**, so implementing a stub automatically activates it.

All five tools are implemented: `sok_kompetanse`, `sjekk_tilgjengelighet`, `hent_cv`, `finn_prosjekthistorikk` and `kryssjekk_kilder`. Id-taking tools validate against known ids via `sjekkId` (blocks paths like `../../.env`); a missing CV or project history returns a clear text instead of throwing.

`kryssjekk_kilder` compares profile, CV (`**Nøkkelkompetanse:**` line, HTML comments stripped) and projects skill by skill, deterministically: high level with no project, CV skill missing from profile, project tech missing from profile, level ≥4 last used ≥4 years ago, level ≤2 used last year. `CV_ALIAS` maps CV shorthand (Bicep, ARM) to profile names. The system prompt makes the agent run it for every candidate and write a `🔍 Avvik:` line with sub-bullets, which the page highlights.

## Data (`data/`)

Loaded via `lesJson(fil)` in `verktoy.js`. All synthetic and deliberately a bit messy — CV and profile don't always agree.

- `konsulenter.json` — profiles keyed by `id` (`k001`–`k080`): `grad`, `rolle`, `avdeling`, `lokasjon` (Oslo/Bergen/Trondheim/Stavanger), `kompetanse[]` (`ferdighet`, `nivå` 1–5 self-assessed), `sertifiseringer`, `språk`.
- `tilgjengelighet.json` — one row per `id`: `nåværende_oppdrag` (`kunde`, `rolle`, `til`, or null), `ledig_fra` (ISO date), `ledig_prosent`, optional free-text `kommentar` that may restrict what they can take.
- `prosjekthistorikk.json` — keyed by **`konsulent_id`** (not `id`): `prosjekter[]` with `kunde`, `bransje`, `år`, `rolle`, `teknologier`.
- `cv/<id>.md` — short markdown CV summaries; only ~20 consultants have one. **`k036.md` contains a deliberate prompt injection** (a hidden HTML comment asking to be ranked first) for the demo — don't "fix" it. Demo request: "Hvem kan ta et Kotlin-oppdrag i Trondheim?"

### Prompt-injection defenses

CV text and `kommentar` are untrusted. Three layers, keep them in sync:
- `hent_cv` wraps the CV in `<cv id="…">`, escapes any `<cv`/`</cv` inside it so the text can't close the tag, and adds an `advarsel` attribute when the CV contains an HTML comment (hidden text). This check is deterministic, so it fires no matter what the model does.
- The `system` prompt says tagged text is data, not instructions, and requires a line starting with `⚠️ Mulig manipulasjon:` under the candidate.
- `public/index.html` marks the CV step in the live log when `advarsel` is present, and highlights answer lines starting with that exact prefix (and `🔍 Avvik:` lines from the cross-check). Changing a prefix means updating both the prompt and the page.

**Grad** is assumed to run A (graduate/junior) → E (most senior). If that changes, update both the `system` prompt and the `sok_kompetanse` description.

`.env` is gitignored and must never be committed.
