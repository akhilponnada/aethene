import 'dotenv/config';
import Supermemory from 'supermemory';

const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_URL = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';

const sm = new Supermemory({ apiKey: SM_KEY });
const TAG = `date_test_${Date.now()}`;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== DATE HANDLING COMPARISON ===\n');
  
  const fact = "Melanie ran a charity race the Sunday before May 25th, 2023.";
  console.log(`Input: "${fact}"\n`);
  
  // Ingest to both
  console.log('Ingesting to Supermemory...');
  await sm.add({ content: fact, containerTag: TAG });
  
  console.log('Ingesting to Aethene...');
  await fetch(`${AETHENE_URL}/v3/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
    body: JSON.stringify({ content: fact, containerTag: TAG, entityContext: "Melanie, a friend" })
  });
  
  console.log('\nWaiting 15s...\n');
  await sleep(15000);
  
  // Search both
  console.log('=== SUPERMEMORY RESULT ===');
  const smResult = await sm.search.memories({ q: "When did Melanie run charity race", containerTag: TAG, limit: 3 });
  smResult.results.forEach((m: any) => console.log('  ' + m.memory));
  
  console.log('\n=== AETHENE RESULT ===');
  const aeResp = await fetch(`${AETHENE_URL}/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
    body: JSON.stringify({ query: "When did Melanie run charity race", containerTag: TAG, limit: 3, mode: 'memories' })
  });
  const aeResult = await aeResp.json();
  aeResult.results?.forEach((m: any) => console.log('  ' + m.memory));
  
  // Check preservation
  const smPreserved = smResult.results.some((m: any) => 
    m.memory.toLowerCase().includes('sunday before may 25') ||
    m.memory.toLowerCase().includes('sunday before 25 may')
  );
  const aePreserved = aeResult.results?.some((m: any) => 
    m.memory.toLowerCase().includes('sunday before may 25') ||
    m.memory.toLowerCase().includes('sunday before 25 may')
  );
  
  console.log('\n=== VERDICT ===');
  console.log(`Supermemory preserved "Sunday before May 25th": ${smPreserved ? '✅ YES' : '❌ NO'}`);
  console.log(`Aethene preserved "Sunday before May 25th": ${aePreserved ? '✅ YES' : '❌ NO'}`);
}

main().catch(console.error);
