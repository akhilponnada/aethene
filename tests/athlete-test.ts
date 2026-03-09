import 'dotenv/config';
import Supermemory from 'supermemory';

const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_URL = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';

const sm = new Supermemory({ apiKey: SM_KEY });
const TAG = `athlete_${Date.now()}`;

// TEST DATA: Professional athlete
const FACTS = [
  "My name is Jordan Rivera and I'm a professional basketball player.",
  "I play point guard for the Portland Trail Blazers.",
  "I was drafted 8th overall in the 2021 NBA draft.",
  "My jersey number is 23.",
  "I have a $92 million contract over 4 years.",
  "My agent is Kevin Williams from CAA Sports.",
  "I grew up in Oakland, California and went to UCLA.",
  "I average 18.5 points and 7.2 assists per game this season.",
  "My girlfriend Maya is a fashion designer.",
  "I have a charity foundation that builds basketball courts in underserved communities.",
];

const QUESTIONS = [
  { q: "What sport does Jordan play?", expected: "basketball" },
  { q: "What team does Jordan play for?", expected: "Trail Blazers" },
  { q: "What position does Jordan play?", expected: "point guard" },
  { q: "What is Jordan's jersey number?", expected: "23" },
  { q: "How much is Jordan's contract worth?", expected: "$92 million" },
  { q: "Who is Jordan's agent?", expected: "Kevin Williams" },
  { q: "Where did Jordan go to college?", expected: "UCLA" },
  { q: "Who is Maya?", expected: "girlfriend" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('='.repeat(60));
  console.log('TEST: NBA Player Jordan Rivera');
  console.log('='.repeat(60));

  // Ingest
  console.log('\n-> Ingesting to both systems...');
  const entityContext = "Jordan Rivera, professional NBA basketball player";
  
  for (const fact of FACTS) {
    await sm.add({ content: fact, containerTag: TAG });
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG, entityContext })
    });
  }

  console.log('Waiting 25s...');
  await sleep(25000);

  // Test
  let smCorrect = 0, aeCorrect = 0;

  for (const test of QUESTIONS) {
    const smResults = await sm.search.memories({ q: test.q, containerTag: TAG, limit: 3 });
    const smContext = smResults.results.map((r: any) => r.memory).join(' ');
    
    const aeResp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 3, mode: 'memories' })
    });
    const aeResults = await aeResp.json();
    const aeContext = aeResults.results?.map((r: any) => r.memory).join(' ') || '';

    const smMatch = smContext.toLowerCase().includes(test.expected.toLowerCase());
    const aeMatch = aeContext.toLowerCase().includes(test.expected.toLowerCase());
    
    if (smMatch) smCorrect++;
    if (aeMatch) aeCorrect++;

    console.log(`${smMatch ? '✅' : '❌'}/${aeMatch ? '✅' : '❌'} ${test.q} → ${test.expected}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Supermemory: ${smCorrect}/${QUESTIONS.length} = ${(smCorrect/QUESTIONS.length*100).toFixed(0)}%`);
  console.log(`Aethene:     ${aeCorrect}/${QUESTIONS.length} = ${(aeCorrect/QUESTIONS.length*100).toFixed(0)}%`);
  
  if (aeCorrect >= smCorrect) console.log('\n✅ Aethene matches or beats Supermemory!');
}

main().catch(console.error);
