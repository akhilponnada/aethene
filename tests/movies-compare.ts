/**
 * Movies & Entertainment Test - Aethene vs Supermemory
 */
import 'dotenv/config';

const AETHENE_URL = 'http://localhost:3006';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const AETHENE_KEY = 'ae_dev_test123';
const SM_KEY = process.env.SUPERMEMORY_API_KEY;

const TAG = `movies_${Date.now()}`;

const CONTENT = `
I absolutely loved Oppenheimer - Christopher Nolan really outdid himself. Cillian Murphy deserved
that Oscar for Best Actor. The movie won 7 Academy Awards including Best Picture and Best Director.
It was released in July 2023 and had a runtime of 3 hours.

My all-time favorite movie is The Shawshank Redemption starring Morgan Freeman and Tim Robbins.
It came out in 1994 and was directed by Frank Darabont. Even though it didn't win any Oscars,
it's ranked #1 on IMDB's top 250.

For TV shows, I'm currently binge-watching Breaking Bad. Bryan Cranston plays Walter White, a
chemistry teacher who becomes a meth dealer. The show ran from 2008 to 2013 on AMC and won 16 Emmy Awards.
I'm on season 4 right now.

I also recently finished watching The Bear on Hulu. Jeremy Allen White plays a chef named Carmy
who returns to Chicago to run his family's sandwich shop. It won 10 Emmys in 2023.

My favorite director is Denis Villeneuve - I loved Dune, Arrival, and Blade Runner 2049.
I'm excited for Dune Part Three which is supposed to come out in 2026.

For music, I've been listening to Taylor Swift's Eras Tour recordings. She's been touring since
March 2023 and the tour grossed over $1 billion. My favorite album of hers is 1989.
`;

const QUESTIONS = [
  { q: "Who directed Oppenheimer?", expected: "Nolan" },
  { q: "Who won Best Actor for Oppenheimer?", expected: "Cillian" },
  { q: "How many Oscars did Oppenheimer win?", expected: "7" },
  { q: "What is my favorite movie of all time?", expected: "Shawshank" },
  { q: "Who stars in Shawshank Redemption?", expected: "Morgan Freeman" },
  { q: "What show am I currently watching?", expected: "Breaking Bad" },
  { q: "Who plays Walter White?", expected: "Bryan Cranston" },
  { q: "What channel was Breaking Bad on?", expected: "AMC" },
  { q: "What season of Breaking Bad am I on?", expected: "4" },
  { q: "What show did I recently finish?", expected: "Bear" },
  { q: "Who is my favorite director?", expected: "Villeneuve" },
  { q: "When is Dune Part Three coming out?", expected: "2026" },
  { q: "What Taylor Swift album is my favorite?", expected: "1989" },
  { q: "How much did the Eras Tour gross?", expected: "billion" },
  { q: "How long is Oppenheimer?", expected: "3 hour" },
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function checkMatch(ctx: string, exp: string): boolean {
  return ctx.toLowerCase().includes(exp.toLowerCase());
}

async function testAethene(): Promise<{ score: number; details: string[] }> {
  const details: string[] = [];

  console.log('\n[Aethene] Ingesting movie content...');
  const resp = await fetch(`${AETHENE_URL}/v3/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
    body: JSON.stringify({ content: CONTENT, containerTag: TAG })
  });
  if (!resp.ok) console.log('  ERROR:', await resp.text());
  else console.log('  ✓ Ingested');

  console.log('[Aethene] Waiting 35s...');
  await sleep(35000);

  let score = 0;
  console.log('[Aethene] Testing:');
  for (const test of QUESTIONS) {
    const r = await fetch(`${AETHENE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AETHENE_KEY },
      body: JSON.stringify({ query: test.q, containerTag: TAG, limit: 5, mode: 'memories' })
    });
    const data = await r.json();
    const ctx = data.results?.map((x: any) => x.memory).join(' ') || '';
    const match = checkMatch(ctx, test.expected);
    if (match) score++;
    console.log(`  ${match ? '✓' : '✗'} ${test.q} [${test.expected}]`);
    if (!match) details.push(`✗ ${test.q} - got: ${ctx.slice(0, 80)}...`);
  }
  return { score, details };
}

async function testSupermemory(): Promise<{ score: number; details: string[] }> {
  if (!SM_KEY) return { score: -1, details: ['No API key'] };
  const details: string[] = [];
  const smTag = `${TAG}_sm`;

  console.log('\n[Supermemory] Ingesting movie content...');
  const resp = await fetch(`${SUPERMEMORY_URL}/v3/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
    body: JSON.stringify({ content: CONTENT, containerTag: smTag })
  });
  if (!resp.ok) console.log('  ERROR');
  else console.log('  ✓ Ingested');

  console.log('[Supermemory] Waiting 35s...');
  await sleep(35000);

  let score = 0;
  console.log('[Supermemory] Testing:');
  for (const test of QUESTIONS) {
    const r = await fetch(`${SUPERMEMORY_URL}/v3/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SM_KEY}` },
      body: JSON.stringify({ q: test.q, containerTags: [smTag] })
    });
    const data = await r.json();
    const ctx = data.results?.flatMap((x: any) => x.chunks?.map((c: any) => c.content) || []).join(' ') || '';
    const match = checkMatch(ctx, test.expected);
    if (match) score++;
    console.log(`  ${match ? '✓' : '✗'} ${test.q} [${test.expected}]`);
    if (!match) details.push(`✗ ${test.q}`);
  }
  return { score, details };
}

async function main() {
  console.log('='.repeat(60));
  console.log('  MOVIES & ENTERTAINMENT TEST: 15 Questions');
  console.log('='.repeat(60));

  const [a, s] = await Promise.all([testAethene(), testSupermemory()]);

  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS');
  console.log('='.repeat(60));
  console.log(`\n  AETHENE:     ${a.score}/${QUESTIONS.length} (${(a.score/QUESTIONS.length*100).toFixed(0)}%)`);
  if (s.score >= 0) {
    console.log(`  SUPERMEMORY: ${s.score}/${QUESTIONS.length} (${(s.score/QUESTIONS.length*100).toFixed(0)}%)`);
  }

  if (a.details.length) {
    console.log('\n  Aethene misses:');
    a.details.slice(0, 5).forEach(d => console.log(`    ${d}`));
  }

  console.log('\n' + '='.repeat(60));
  if (s.score >= 0) {
    if (a.score > s.score) console.log('🏆 AETHENE WINS');
    else if (s.score > a.score) console.log('🏆 SUPERMEMORY WINS');
    else console.log('🤝 TIE');
  }
}

main().catch(console.error);
