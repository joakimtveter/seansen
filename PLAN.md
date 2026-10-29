# Plan: orchestrator + subagents

The plan delegates each candidate's detailed check to its own subagent. Subagents don't add much to the search step: with 80 consultants, one agent with all four tools can probably answer most requests fine. They pay off for the per-candidate check, where CVs, project history and availability comments would otherwise pile up in one context. That check is also the part that can run in parallel, and it shows well in a demo.

## Target architecture

```
Orkestrator (kjørAgent, own system prompt)
├─ sok_kompetanse            ← broad search, cheap
├─ sjekk_tilgjengelighet     ← quick filter on dates and %
└─ vurder_kandidater         ← starts one subagent per candidate, in parallel
     └─ Kandidatvurderer (kjørAgent, own system prompt)
          ├─ hent_cv
          ├─ finn_prosjekthistorikk
          └─ sjekk_tilgjengelighet
          → returns a short verdict: fit, evidence, gaps, profile/CV mismatches
```

The orchestrator never sees full CVs or project lists, only the short verdicts. It plans the search, picks a shortlist and ranks the result. The subagent is just a tool whose `kjør` calls `kjørAgent` again, so the existing loop is reused as it is.

## Step by step

### Step 0: Agree on the contract (15 min, whole team)

- Input to a subagent: `{ id, behov }`, where `behov` is the orchestrator's summary of the request (skills, start date, grade, location).
- Output: a fixed text format, for example:
  - `id`
  - `Match: sterk/middels/svak`
  - `Bevis: …`
  - `Mangler: …`
  - `Avvik CV↔profil: …`
  - `Tilgjengelighet: …`

  Plain text is enough, since an LLM reads it.
- Once this is agreed, steps 1–3 can be done in parallel by different people.

### Step 1: Implement the three stub tools in `src/verktoy.js`

- This is required either way, because the subagents need these tools.
- Edge cases to handle:
  - an empty or unknown `ider` list
  - a missing CV should return the text "Ingen CV for kXXX" instead of throwing an error
  - validate the id against `/^k\d{3}$/` in `hent_cv` (blocks paths like `../../.env`)
  - `prosjekthistorikk.json` uses `konsulent_id`, not `id`
- **Record a baseline.** Run the single agent on 4–5 test requests and save the output. That gives you something to compare against in the demo.

### Step 2: Make `kjørAgent` reusable (`src/agent.js`)

- **Run tool calls in parallel.** The loop currently `await`s each call in turn, so parallel subagents would actually run one after another. Switch to `Promise.all(kall.map(...))` and still return every result in *one* user message, which the loop already does correctly.
- **New parameters:**
  - `modell`
  - `maksIterasjoner`
  - `effort`
  - `navn`, a log prefix so parallel output stays readable, e.g. `[k023] → hent_cv`
- **Return the final text** instead of `svar`. Right now the function returns `undefined` when it hits `MAX_ITERASJONER`. The subagent needs an explicit failure there (throw an error), so the orchestrator gets `is_error`.

### Step 3: Restructure the tools

- Pull each tool into its own named constant (`sokKompetanse`, `hentCv`, …) so you can build two different tool sets.
- Write two prompts: `orkestratorSystem` and `vurdererSystem`.
- **Leave `hent_cv` and `finn_prosjekthistorikk` out of the orchestrator's tools.** Otherwise it will often do the detailed checks itself instead of delegating.

### Step 4: Build the `vurder_kandidater` tool

```js
kjør: async ({ ider, behov }) => {
  if (!ider?.length) throw new Error('Oppgi minst én id.');
  if (ider.length > 6) throw new Error('Maks 6 kandidater per kall. Snevre inn først.');
  const res = await Promise.allSettled(ider.map((id) =>
    kjørAgent({ system: vurdererSystem, oppgave: `Behov: ${behov}\nKandidat: ${id}`,
                verktøy: [hentCv, finnProsjekthistorikk, sjekkTilgjengelighet],
                navn: id, maksIterasjoner: 5 })));
  return res.map((r, i) => r.status === 'fulfilled' ? r.value : `${ider[i]}: vurdering feilet (${r.reason.message})`).join('\n\n');
},
```

- Take a list rather than one candidate per call. That gives you control over how many run at once and caps the cost, instead of hoping the model makes parallel calls.
- With `allSettled`, one failed subagent doesn't take down the others.

### Step 5: The orchestrator prompt

- The workflow to spell out:
  1. Break the request into skills, date, grade and location.
  2. Run several `sok_kompetanse` searches.
  3. Filter with `sjekk_tilgjengelighet`.
  4. Pick a shortlist of 3–6.
  5. Call `vurder_kandidater`.
  6. Return a ranked list with reasons, say plainly what's missing, and answer in Norwegian.
- Keep the grade scale (A junior → E most senior) and the rule "si fra hvis du mangler verktøy" (say so when a tool is missing).
- The subagent prompt should tell it to check the availability `kommentar` field and to flag mismatches between CV and profile.

### Step 6: Model and effort per role

- Start with `claude-sonnet-5-5` for both roles, as today.
- Give the subagent `effort: 'low'`. Its job is narrow and well defined.
- If you want it faster or cheaper, try `claude-haiku-5-5` for the subagent through its own env variable (e.g. `UNDERAGENT_MODELL`). Only keep it if verdict quality holds up against the Step 1 baseline.

### Step 7: Cost guardrails

- `maksIterasjoner: 5` per subagent.
- At most 6 candidates per call.
- Keep `MAX_ITERASJONER` for the orchestrator. Worst case is roughly 10 orchestrator rounds plus 6 × 5 subagent rounds per request.

### Step 8: Test against the baseline with tricky cases

- A CV that disagrees with the profile.
- Someone who is only partly available, or has a limiting `kommentar`.
- A request with no perfect match.
- A request where grade matters.
- Compare the answers and run time with the Step 1 baseline.

### Step 9: Demo polish

- Show the tool calls as a tree, with the orchestrator first and then the subagents indented under their id.
- Show the time per phase so the audience can see the speedup from running in parallel.

## Suggested team split after Step 0

| Person | Work |
|---|---|
| A | Step 1 (tools and baseline) |
| B | Step 2 (`agent.js`) |
| C | Steps 3 and 5 (prompts and tool sets) |
| Together | Step 4, then 8–9 |

Step 4 depends on 1–3. Everything else can start right away.
