import 'dotenv/config';
import Supermemory from 'supermemory';

const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_URL = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';

const sm = new Supermemory({ apiKey: SM_KEY });
const TAG = `chef_${Date.now()}`;

// NEW TEST DATA: A professional chef
const FACTS = [
  "My name is Chef Olivia Park and I run a Michelin-starred restaurant in New York.",
  "I specialize in Korean-French fusion cuisine.",
  "I trained at Le Cordon Bleu in Paris for 3 years.",
  "My restaurant is called 'Harmony' and it seats 40 guests.",
  "I wake up at 5 AM every day to visit the fish market.",
  "I have 12 staff members in my kitchen.",
  "My signature dish is a kimchi-infused bouillabaisse that costs $85.",
  "I'm allergic to shellfish but I still cook with it.",
  "My sous chef is named Daniel Kim, he's been with me for 5 years.",
  "I'm writing a cookbook that will be published next March.",
];

const QUESTIONS = [
  { q: "What is Olivia's profession?", expected: "chef" },
  { q: "Where did Olivia train?", expected: "Le Cordon Bleu" },
  { q: "What type of cuisine does Olivia specialize in?", expected: "Korean-French" },
  { q: "What is the name of Olivia's restaurant?", expected: "Harmony" },
  { q: "How much does the signature dish cost?", expected: "$85" },
  { q: "Who is Daniel Kim?", expected: "sous chef" },
  { q: "What is Olivia allergic to?", expected: "shellfish" },
  { q: "When is the cookbook being published?", expected: "March" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('='.repeat(60));
  console.log('NEW DATA TEST: Chef Olivia Park');
  console.log('='.repeat(60));
  console.log(`\nTag: ${TAG}`);

  // Ingest to both
  console.log('\n-> Ingesting to Supermemory...');
  for (const fact of FACTS) {
    await sm.add({ content: fact, containerTag: TAG });
  }
  console.log(`   Added ${FACTS.length} facts`);

  console.log('\n-> Ingesting to Aethene...');
  const entityContext = "Chef Olivia Park, Michelin-starred chef in New York";
  for (const fact of FACTS) {
    await fetch(`${AETHENE_URL}/v3/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ content: fact, containerTag: TAG, entityContext })
    });
  }
  console.log(`   Added ${FACTS.length} facts`);

  console.log('\nWaiting 25s for processing...');
  await sleep(25000);

  // Test questions
  console.log('\n' + '='.repeat(60));
  console.log('QUESTION ANSWERING');
  console.log('='.repeat(60));

  let smCorrect = 0, aeCorrect = 0;

  for (const test of QUESTIONS) {
    // Supermemory
    const smResults = await sm.search.memories({ q: test.q, containerTag: TAG, limit: 3 });
    const smContext = smResults.results.map((r: any) => r.memory).join('\n');
    
    // Aethene
    const aeResp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 3, mode: 'memories' })
    });
    const aeResults = await aeResp.json();
    const aeContext = aeResults.results?.map((r: any) => r.memory).join('\n') || '';

    // Check if answer is in context
    const smMatch = smContext.toLowerCase().includes(test.expected.toLowerCase());
    const aeMatch = aeContext.toLowerCase().includes(test.expected.toLowerCase());
    
    if (smMatch) smCorrect++;
    if (aeMatch) aeCorrect++;

    console.log(`\nQ: ${test.q}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   SM: ${smMatch ? '✅' : '❌'} ${smContext.slice(0, 80)}...`);
    console.log(`   AE: ${aeMatch ? '✅' : '❌'} ${aeContext.slice(0, 80)}...`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('FINAL RESULTS');
  console.log('='.repeat(60));
  console.log(`\nSupermemory: ${smCorrect}/${QUESTIONS.length} = ${(smCorrect/QUESTIONS.length*100).toFixed(0)}%`);
  console.log(`Aethene:     ${aeCorrect}/${QUESTIONS.length} = ${(aeCorrect/QUESTIONS.length*100).toFixed(0)}%`);
  
  if (smCorrect === aeCorrect) {
    console.log('\n🎉 PERFECT MATCH!');
  } else if (aeCorrect > smCorrect) {
    console.log(`\n🚀 Aethene is ${aeCorrect - smCorrect} ahead!`);
  } else {
    console.log(`\n⚠️  Aethene is ${smCorrect - aeCorrect} behind`);
  }
}

main().catch(console.error);
