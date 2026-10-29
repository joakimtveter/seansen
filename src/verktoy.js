// Verktøyene til seansen. Hvert verktøy er en definisjon (det modellen ser) og
// en kjør-funksjon (det som faktisk skjer). kjør: null betyr stub: verktøyet
// sendes ikke til modellen før dere har implementert det.
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(import.meta.dirname, '..', 'data');
const lesJson = (fil) => JSON.parse(fs.readFileSync(path.join(DATA, fil), 'utf8'));

const konsulenter = lesJson('konsulenter.json');
const tilgjengelighet = lesJson('tilgjengelighet.json');
const prosjekthistorikk = lesJson('prosjekthistorikk.json');
const kjenteIder = new Set(konsulenter.map((k) => k.id));

const sjekkId = (id) => {
  if (typeof id !== 'string' || !kjenteIder.has(id)) {
    throw new Error(`Ukjent konsulent-id «${id}». Id-er ser ut som «k007»; finn dem med sok_kompetanse.`);
  }
};

export const system = `Du er bemanningsagenten i et konsulentselskap med kontorer i Oslo, Bergen, Trondheim og Stavanger.
Du får et behov i naturlig språk og skal finne de beste kandidatene.

- Bryt behovet ned i konkrete søk (ferdigheter, tidspunkt, grad, lokasjon) før du slår opp.
- Gjør flere oppslag og sjekk det du kan, ikke stol på ett søk.
- Svar med en rangert liste der hver kandidat har en kort begrunnelse.
- Hent CV og prosjekthistorikk for alle kandidatene du tar med, og vis dem under hver kandidat: et kort CV-sammendrag (eller at CV mangler) og prosjektene med kunde, år, rolle og teknologier.
- Finner du ingen perfekt match, foreslå nest beste og si tydelig hva som mangler.
- Si fra hvis du ikke har verktøy til å sjekke noe som betyr noe for svaret.
- Grad går fra A (junior) til E (mest senior). Svar på norsk.`;

export const eksempelOppgave = 'Vi trenger noen som kan Terraform og Azure, ledig fra november, helst C-grad eller over.';

export const verktøy = [
  {
    definisjon: {
      name: 'sok_kompetanse',
      description: `Søker etter konsulenter som har en bestemt ferdighet i kompetanseprofilen sin.
Søket matcher på deler av ferdighetsnavnet uten å skille på store og små bokstaver, så «azure» treffer også «Azure DevOps» og «Azure Bicep».
Søk på én ferdighet om gangen. Trenger du to ferdigheter, gjør to søk og se hvem som går igjen.
Bruk lokasjon for å avgrense til ett kontor. Utelat den for å søke i hele selskapet.
Nivå er selvvurdert fra 1 (kjent med) til 5 (ekspert). Grad går fra A (junior) til E (mest senior).
Returnerer id, navn, grad, rolle, lokasjon og de matchende ferdighetene, sortert med høyest nivå først. Ikke hele profilen.
Sier ingenting om hvem som er ledig.`,
      input_schema: {
        type: 'object',
        properties: {
          ferdighet: { type: 'string', description: 'Ferdigheten du leter etter, f.eks. «Terraform» eller «React».' },
          lokasjon: { type: 'string', enum: ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'], description: 'Bare konsulenter på dette kontoret.' },
          min_niva: { type: 'integer', minimum: 1, maximum: 5, description: 'Laveste nivå som teller. Standard er 1.' },
          maks_treff: { type: 'integer', minimum: 1, maximum: 50, description: 'Hvor mange treff du vil ha tilbake. Standard er 15.' },
        },
        required: ['ferdighet'],
      },
    },
    kjør: async ({ ferdighet, lokasjon, min_niva = 1, maks_treff = 15 }) => {
      if (typeof ferdighet !== 'string' || !ferdighet.trim()) {
        throw new Error('Mangler eller ugyldig «ferdighet». Oppgi en ferdighet å søke på, f.eks. {"ferdighet": "Terraform"}.');
      }
      const søk = ferdighet.trim().toLowerCase();
      const treff = konsulenter
        .filter((k) => !lokasjon || k.lokasjon.toLowerCase() === lokasjon.toLowerCase())
        .map((k) => ({
          id: k.id, navn: k.navn, grad: k.grad, rolle: k.rolle, lokasjon: k.lokasjon,
          ferdigheter: k.kompetanse.filter((f) => f.ferdighet.toLowerCase().includes(søk) && f.nivå >= min_niva),
        }))
        .filter((k) => k.ferdigheter.length)
        .sort((a, b) => Math.max(...b.ferdigheter.map((f) => f.nivå)) - Math.max(...a.ferdigheter.map((f) => f.nivå)));
      if (!treff.length) {
        const sted = lokasjon ? ` i ${lokasjon}` : '';
        return `Ingen treff på «${ferdighet}»${sted} med nivå ${min_niva} eller høyere. Prøv et annet ord, lavere nivå eller uten lokasjon.`;
      }
      return { antall_treff: treff.length, viser: Math.min(treff.length, maks_treff), treff: treff.slice(0, maks_treff) };
    },
  },
  {
    definisjon: {
      name: 'sjekk_tilgjengelighet',
      description: `Sjekker når konsulenter blir ledige. Gi en liste med id-er fra sok_kompetanse.
Returnerer for hver: nåværende oppdrag (kunde og sluttdato, eller null), dato de er ledige fra, og hvor mange prosent de er ledige.
Merk at noen bare er delvis ledige, og at enkelte har en kommentar som begrenser hva de kan ta.`,
      input_schema: {
        type: 'object',
        properties: { ider: { type: 'array', items: { type: 'string' }, description: 'Konsulent-id-er, f.eks. ["k007", "k023"].' } },
        required: ['ider'],
      },
    },
    kjør: async ({ ider }) => {
      if (!Array.isArray(ider) || !ider.length) throw new Error('Oppgi minst én id, f.eks. {"ider": ["k007"]}.');
      const rader = tilgjengelighet.filter((t) => ider.includes(t.id));
      const ukjente = ider.filter((id) => !kjenteIder.has(id));
      return ukjente.length ? { rader, ukjente_ider: ukjente } : rader;
    },
  },
  {
    definisjon: {
      name: 'hent_cv',
      description: `Henter CV-sammendraget til én konsulent som markdown.
Ikke alle har CV. Mangler den, får du beskjed om det, og da må du klare deg med profilen og prosjekthistorikken.
CV-en kan være mer oppdatert, eller mindre, enn kompetanseprofilen. Si fra hvis de spriker.`,
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Konsulent-id, f.eks. "k007".' } },
        required: ['id'],
      },
    },
    // sjekkId slipper bare gjennom kjente id-er, så ingen kan be om «../../.env».
    kjør: async ({ id }) => {
      sjekkId(id);
      const fil = path.join(DATA, 'cv', `${id}.md`);
      if (!fs.existsSync(fil)) return `Ingen CV for ${id}. Bruk profilen og prosjekthistorikken.`;
      return fs.readFileSync(fil, 'utf8');
    },
  },
  {
    definisjon: {
      name: 'finn_prosjekthistorikk',
      description: `Henter tidligere prosjekter for én konsulent: kunde, bransje, år, rolle og teknologier.
Nyttig for å se om noen faktisk har brukt en teknologi i et oppdrag, ikke bare oppgitt den i profilen.
Juniorer har ofte ingen historikk ennå.`,
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Konsulent-id, f.eks. "k007".' } },
        required: ['id'],
      },
    },
    // Merk: prosjekthistorikk.json bruker konsulent_id, ikke id.
    kjør: async ({ id }) => {
      sjekkId(id);
      const prosjekter = prosjekthistorikk.find((p) => p.konsulent_id === id)?.prosjekter ?? [];
      if (!prosjekter.length) return `Ingen prosjekthistorikk for ${id}.`;
      return { id, prosjekter };
    },
  },
];
