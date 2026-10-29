// Nettversjonen: npm run web, åpne http://localhost:3000
import './miljo.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { kjørAgent } from './agent.js';
import { system, verktøy, konsulenter } from './verktoy.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3000);
const forside = path.join(import.meta.dirname, '..', 'public', 'index.html');

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(forside).pipe(res);
    }
    if (req.method === 'POST' && req.url === '/api/spor') {
      const { oppgave } = JSON.parse(await lesKropp(req));
      if (typeof oppgave !== 'string' || !oppgave.trim()) return svarJson(res, 400, { feil: 'Skriv et spørsmål først.' });
      console.log(`\n🎃 ${oppgave}\n`);
      return strømAgent(res, oppgave);
    }
    svarJson(res, 404, { feil: 'Finnes ikke.' });
  } catch (e) {
    console.error(e);
    svarJson(res, 500, { feil: e.message });
  }
});

server.listen(PORT, () => console.log(`🎃 Seansen kjører på http://localhost:${PORT}`));

// Agenten svarer i markdown. Teksten bygger på data og fritekst vi ikke styrer,
// så rå HTML vises som tekst, og lenker må være http(s) eller mailto.
const escape = (t) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ text }) => escape(text),
    link({ href, tokens }) {
      const tekst = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:)/i.test(href)) return tekst;
      return `<a href="${escape(href)}" target="_blank" rel="noopener">${tekst}</a>`;
    },
  },
});

// Svaret strømmes som NDJSON: én JSON-hendelse per linje mens agenten jobber
// (tanke, kall, resultat), og til slutt «svar» eller «feil».
async function strømAgent(res, oppgave) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' });
  const send = (hendelse) => res.write(`${JSON.stringify(hendelse)}\n`);
  try {
    const svar = await kjørAgent({ system, oppgave, verktøy, påHendelse: (h) => send(medNavn(h)) });
    const tekst = tekstFra(svar);
    send({ type: 'svar', svar: tekst, html: markdown.parse(tekst) });
  } catch (e) {
    console.error(e);
    send({ type: 'feil', melding: e.message });
  }
  res.end();
}

// Siden viser «Leser CV-en til Sander Myrlys» i stedet for «hent_cv k079».
const navnPåId = new Map(konsulenter.map((k) => [k.id, k.navn]));
function medNavn(h) {
  if (h.type !== 'kall') return h;
  const ider = [h.input.id, ...(Array.isArray(h.input.ider) ? h.input.ider : [])].filter(Boolean);
  return { ...h, personer: ider.map((id) => navnPåId.get(id) ?? String(id)) };
}

// kjørAgent returnerer ingenting når den stopper på MAX_ITERASJONER.
function tekstFra(svar) {
  if (!svar) return 'Agenten ga seg før den ble ferdig (MAX_ITERASJONER).';
  const tekst = svar.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
  if (svar.stop_reason === 'refusal') return tekst || 'Modellen avslo å svare.';
  if (svar.stop_reason === 'max_tokens') return `${tekst}\n\n(Svaret ble kuttet.)`;
  return tekst;
}

async function lesKropp(req) {
  let kropp = '';
  for await (const bit of req) {
    kropp += bit;
    if (kropp.length > 10_000) throw new Error('For langt spørsmål.');
  }
  return kropp;
}

function svarJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
