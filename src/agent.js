// Agent-løkken. Hele «agent-greia» er dette: spør modellen, kjør verktøyene
// den ber om, send resultatene tilbake, gjenta til den er ferdig.
import Anthropic from '@anthropic-ai/sdk';

const MODELL = process.env.MODELL ?? 'claude-sonnet-5-5';

// Stopper en agent som går i ring før den brenner opp kostnadstaket.
const MAX_ITERASJONER = Number(process.env.MAX_ITERASJONER ?? 10);

const klient = new Anthropic();

const grå = (t) => `\x1b[90m${t}\x1b[0m`;
const oransje = (t) => `\x1b[38;5;208m${t}\x1b[0m`;
const grønn = (t) => `\x1b[32m${t}\x1b[0m`;

// påHendelse får hvert steg underveis (tanke, kall, resultat), så nettsiden kan
// vise arbeidet live. Terminalen logger som før uansett.
export async function kjørAgent({ system, oppgave, verktøy, påHendelse = () => {} }) {
  // Bare verktøy med en kjør-funksjon sendes til modellen. Stubbene i
  // verktoy.js blir med av seg selv når dere implementerer dem.
  const aktive = verktøy.filter((v) => v.kjør);
  const etterNavn = new Map(aktive.map((v) => [v.definisjon.name, v]));

  const messages = [{ role: 'user', content: oppgave }];

  for (let i = 1; i <= MAX_ITERASJONER; i++) {
    const svar = await klient.messages.create({
      model: MODELL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system,
      tools: aktive.map((v) => v.definisjon),
      messages,
    });

    messages.push({ role: 'assistant', content: svar.content });

    for (const blokk of svar.content) {
      if (blokk.type === 'text' && blokk.text.trim()) {
        console.log(svar.stop_reason === 'tool_use' ? grå(blokk.text) : blokk.text);
        if (svar.stop_reason === 'tool_use') påHendelse({ type: 'tanke', tekst: blokk.text });
      }
    }

    if (svar.stop_reason === 'end_turn') return svar;
    if (svar.stop_reason === 'refusal') {
      console.log(oransje(`\n✖ Modellen avslo (${svar.stop_details?.category ?? 'ukjent grunn'}).`));
      return svar;
    }
    if (svar.stop_reason === 'max_tokens') {
      console.log(oransje('\n✖ Svaret ble kuttet (max_tokens).'));
      return svar;
    }

    // Modellen kan be om flere verktøy samtidig. Alle resultatene må tilbake
    // i én og samme melding.
    const kall = svar.content.filter((b) => b.type === 'tool_use');
    const resultater = [];
    for (const k of kall) {
      console.log(oransje(`→ ${k.name}`) + grå(` ${JSON.stringify(k.input)}`));
      påHendelse({ type: 'kall', id: k.id, verktøy: k.name, input: k.input });
      const resultat = await kjørVerktøy(etterNavn, k);
      påHendelse({ type: 'resultat', id: k.id, innhold: resultat.content, feil: !!resultat.is_error });
      resultater.push(resultat);
    }
    messages.push({ role: 'user', content: resultater });
  }

  console.log(oransje(`\n✖ Stoppet etter ${MAX_ITERASJONER} runder (MAX_ITERASJONER).`));
}

async function kjørVerktøy(etterNavn, kall) {
  const v = etterNavn.get(kall.name);
  if (!v) {
    return feil(kall, `Ukjent verktøy «${kall.name}». Gyldige: ${[...etterNavn.keys()].join(', ')}`);
  }
  try {
    const resultat = await v.kjør(kall.input);
    const tekst = typeof resultat === 'string' ? resultat : JSON.stringify(resultat, null, 2);
    console.log(grønn(`  ✓ ${tekst.length} tegn tilbake`));
    return { type: 'tool_result', tool_use_id: kall.id, content: tekst };
  } catch (e) {
    return feil(kall, e.message);
  }
}

function feil(kall, melding) {
  console.log(oransje(`  ✖ ${melding}`));
  return { type: 'tool_result', tool_use_id: kall.id, content: melding, is_error: true };
}
