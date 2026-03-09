/**
 * Proper LoCoMo Test with entityContext
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const API_KEY = 'ae_dev_test123';
const TAG = `locomo_${Date.now()}`;

// LoCoMo-style conversation data about Caroline
const CONVERSATIONS = [
  {
    entityContext: "Caroline, a transgender woman who moved from Sweden",
    facts: [
      "My name is Caroline and I'm a transgender woman.",
      "I moved to the US from Sweden about 4 years ago.",
      "I attended an LGBTQ support group on May 7th, 2023.",
      "I've been researching adoption agencies because I want to start a family.",
      "I'm currently single but hopeful about finding a partner.",
      "I'm interested in pursuing a career in psychology or counseling.",
    ]
  },
  {
    entityContext: "Melanie, an artist and friend of the user",
    facts: [
      "My friend Melanie is an amazing artist.",
      "Melanie painted a beautiful sunrise scene back in 2022.",
      "Melanie ran a charity race the Sunday before May 25th, 2023.",
      "Melanie is planning a camping trip in June 2023.",
      "Melanie works at a local art gallery.",
    ]
  }
];

const QUESTIONS = [
  { q: "What is Caroline's identity?", expected: "transgender woman" },
  { q: "When did Caroline attend the LGBTQ support group?", expected: "May 7" },
  { q: "What did Caroline research?", expected: "adoption" },
  { q: "Where did Caroline move from?", expected: "Sweden" },
  { q: "What career fields interest Caroline?", expected: "psychology" },
  { q: "When did Melanie paint a sunrise?", expected: "2022" },
  { q: "When did Melanie run a charity race?", expected: "Sunday before May 25" },
  { q: "When is Melanie planning to go camping?", expected: "June 2023" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(answer: string, expected: string): boolean {
  const a = answer.toLowerCase();
  const e = expected.toLowerCase();
  return a.includes(e) || e.split(' ').every(word => a.includes(word));
}

async function main() {
  console.log('='.repeat(60));
  console.log('LoCoMo-Style Test with EntityContext');
  console.log('='.repeat(60));
  console.log(`Tag: ${TAG}\n`);

  // Ingest conversations
  console.log('📥 Ingesting conversation data...');
  for (const conv of CONVERSATIONS) {
    for (const fact of conv.facts) {
      await fetch(`${AETHENE_URL}/v3/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ 
          content: fact, 
          containerTag: TAG, 
          entityContext: conv.entityContext 
        })
      });
    }
    console.log(`  ✓ ${conv.entityContext.split(',')[0]}: ${conv.facts.length} facts`);
  }

  console.log('\n⏳ Waiting 30s for processing...');
  await sleep(30000);

  // Test questions
  console.log('\n📝 Testing questions:\n');
  let correct = 0;

  for (const test of QUESTIONS) {
    const resp = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 3, mode: 'memories' })
    });
    const data = await resp.json();
    const context = data.results?.map((r: any) => r.memory).join(' ') || '';
    
    const match = checkMatch(context, test.expected);
    if (match) correct++;

    console.log(`${match ? '✅' : '❌'} ${test.q}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Context: ${context.slice(0, 100)}...\n`);
  }

  console.log('='.repeat(60));
  console.log(`SCORE: ${correct}/${QUESTIONS.length} = ${(correct/QUESTIONS.length*100).toFixed(0)}%`);
  console.log('='.repeat(60));
}

main().catch(console.error);
