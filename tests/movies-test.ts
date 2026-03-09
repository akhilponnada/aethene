/**
 * Movies Test - SM vs Aethene with movie facts
 */
const SM_API = 'https://api.supermemory.ai';
const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_API = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';
const GEMINI = 'AIzaSyA22gt7KozJT6uM4RMq9zeqC-SdCUBZOTI';
const TAG = `movies_${Date.now()}`;

// Movie facts about a fictional user
const movieFacts = [
  "Alex's favorite movie is The Shawshank Redemption",
  "Alex watched Inception 5 times",
  "Alex thinks Christopher Nolan is the best director",
  "Alex's favorite Marvel movie is Avengers Endgame",
  "Alex cried during the ending of Titanic",
  "Alex prefers sci-fi over horror movies",
  "Alex's favorite actor is Leonardo DiCaprio",
  "Alex watched The Matrix on his 16th birthday",
  "Alex hates romantic comedies",
  "Alex owns the entire Lord of the Rings extended edition",
  "Alex's favorite animated movie is Spirited Away",
  "Alex goes to the cinema every Friday night",
];

// Number word mapping for flexible matching
const numberWords: Record<string, string> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'
};

function matchAnswer(answer: string, expected: string): boolean {
  const lower = answer.toLowerCase();
  const exp = expected.toLowerCase();
  if (lower.includes(exp)) return true;
  if (numberWords[exp] && lower.includes(numberWords[exp])) return true;
  return false;
}

const questions = [
  { q: "What is Alex's favorite movie?", expected: "shawshank" },
  { q: "How many times did Alex watch Inception?", expected: "5" },
  { q: "Who does Alex think is the best director?", expected: "nolan" },
  { q: "What's Alex's favorite Marvel movie?", expected: "endgame" },
  { q: "Which movie made Alex cry?", expected: "titanic" },
  { q: "Does Alex prefer sci-fi or horror?", expected: "sci-fi" },
  { q: "Who is Alex's favorite actor?", expected: "dicaprio" },
  { q: "When did Alex watch The Matrix?", expected: "birthday" },
  { q: "What genre does Alex hate?", expected: "romantic" },
  { q: "Does Alex own Lord of the Rings?", expected: "yes" },
  { q: "What's Alex's favorite animated movie?", expected: "spirited" },
  { q: "When does Alex go to the cinema?", expected: "friday" },
];

async function smRequest(endpoint: string, body: any) {
  const r = await fetch(`${SM_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SM_KEY },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function aetheneRequest(endpoint: string, body: any) {
  const r = await fetch(`${AETHENE_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': AETHENE_KEY },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function gemini(prompt: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 30 }
    })
  });
  return ((await r.json()) as any).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'N/A';
}

async function main() {
  console.log("🎬 MOVIES TEST - SM vs AETHENE\n");
  console.log(`Tag: ${TAG}\n`);

  // Ingest to both
  console.log("📥 Ingesting movie facts...\n");

  console.log("  → Supermemory...");
  for (const fact of movieFacts) {
    await smRequest('/v3/documents', { content: fact, containerTags: [TAG] });
  }
  console.log(`    ✓ Ingested ${movieFacts.length} facts`);

  console.log("  → Aethene...");
  const ae = await aetheneRequest('/v1/memories', {
    memories: movieFacts.map(f => ({ content: f, isCore: true })),
    containerTag: TAG
  });
  console.log(`    ✓ Created ${ae.created || 0} memories`);

  console.log("\n⏳ Waiting 10s for processing...\n");
  await new Promise(r => setTimeout(r, 10000));

  // Test
  console.log("📝 Testing questions...\n");
  let smCorrect = 0, aeCorrect = 0;

  for (const test of questions) {
    console.log(`Q: ${test.q}`);

    // SM
    const smSearch = await smRequest('/v4/search', { q: test.q, containerTag: TAG, limit: 3 }) as any;
    const smCtx = (smSearch.results || []).map((r: any) => r.memory || '').join('\n');
    const smAns = smCtx ? await gemini(`Context:\n${smCtx}\n\nQ: ${test.q}\nA (1-5 words):`) : 'No info';
    const smMatch = matchAnswer(smAns, test.expected);
    if (smMatch) smCorrect++;

    // Aethene
    const aeSearch = await aetheneRequest('/v1/search', { query: test.q, containerTag: TAG, limit: 3 }) as any;
    const aeCtx = (aeSearch.results || []).map((r: any) => r.memory || r.content || '').join('\n');
    const aeAns = aeCtx ? await gemini(`Context:\n${aeCtx}\n\nQ: ${test.q}\nA (1-5 words):`) : 'No info';
    const aeMatch = matchAnswer(aeAns, test.expected);
    if (aeMatch) aeCorrect++;

    console.log(`   SM: ${(smSearch.results||[]).length} results → "${smAns}" ${smMatch ? '✅' : '❌'}`);
    console.log(`   AE: ${(aeSearch.results||[]).length} results → "${aeAns}" ${aeMatch ? '✅' : '❌'}`);
    console.log();

    await new Promise(r => setTimeout(r, 300));
  }

  console.log("=".repeat(50));
  console.log(`SUPERMEMORY: ${smCorrect}/${questions.length} = ${(smCorrect/questions.length*100).toFixed(0)}%`);
  console.log(`AETHENE:     ${aeCorrect}/${questions.length} = ${(aeCorrect/questions.length*100).toFixed(0)}%`);
  console.log("=".repeat(50));
}

main().catch(console.error);
