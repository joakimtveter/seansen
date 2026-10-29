// Leser .env. Må importeres før agent.js: importer kjøres før resten av
// index.js, og agent.js leser miljøvariablene idet den lastes.
try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}
