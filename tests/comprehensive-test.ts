/**
 * Comprehensive SM vs Aethene comparison test
 */
const SM_API = 'https://api.supermemory.ai';
const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_API = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';
const GEMINI = 'AIzaSyA22gt7KozJT6uM4RMq9zeqC-SdCUBZOTI';
const TAG = `test_${Date.now()}`;

// Test data - various types of facts
const testFacts = [
  "Sarah Johnson is 28 years old",
  "Sarah works as a software engineer at Google",
  "Sarah's favorite color is blue",
  "Sarah moved to San Francisco in 2020",
  "Sarah has a golden retriever named Max",
  "Sarah prefers dark mode in all her apps",
  "Mike Thompson is Sarah's manager",
  "Sarah is learning Japanese",
  "Sarah's birthday is March 15th",
  "Sarah completed her PhD at MIT in 2019"
];

// Test questions
const testQuestions = [
  { q: "How old is Sarah?", expected: "28" },
  { q: "Where does Sarah work?", expected: "google" },
  { q: "What is Sarah's favorite color?", expected: "blue" },
  { q: "When did Sarah move to San Francisco?", expected: "2020" },
  { q: "What kind of pet does Sarah have?", expected: "golden retriever" },
  { q: "Does Sarah prefer dark mode or light mode?", expected: "dark" },
  { q: "Who is Sarah's manager?", expected: "mike" },
  { q: "What language is Sarah learning?", expected: "japanese" },
  { q: "When is Sarah's birthday?", expected: "march" },
  { q: "Where did Sarah get her PhD?", expected: "mit" },
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
  console.log("🧪 COMPREHENSIVE SM vs AETHENE TEST\n");
  console.log(`Container/Tag: ${TAG}\n`);

  // ============================================================
  // PHASE 1: INGEST DATA TO BOTH SYSTEMS
  // ============================================================
  console.log("📥 PHASE 1: Ingesting test facts...\n");

  // Ingest to Supermemory
  console.log("  → Supermemory...");
  for (const fact of testFacts) {
    await smRequest('/v3/documents', {
      content: fact,
      containerTags: [TAG]
    });
  }
  console.log(`    ✓ Ingested ${testFacts.length} facts to SM`);

  // Ingest to Aethene
  console.log("  → Aethene...");
  const aetheneIngest = await aetheneRequest('/v1/memories', {
    memories: testFacts.map(f => ({ content: f, isCore: true })),
    containerTag: TAG
  });
  console.log(`    ✓ Created ${aetheneIngest.created || 0} memories in Aethene`);

  // Wait for processing
  console.log("\n⏳ Waiting for processing (8s)...\n");
  await new Promise(r => setTimeout(r, 8000));

  // ============================================================
  // PHASE 2: TEST SEARCH ON BOTH SYSTEMS
  // ============================================================
  console.log("📝 PHASE 2: Testing search queries...\n");

  let smCorrect = 0;
  let aetheneCorrect = 0;

  for (const test of testQuestions) {
    console.log(`Q: ${test.q}`);

    // Search Supermemory
    const smSearch = await smRequest('/v4/search', { q: test.q, containerTag: TAG, limit: 3 }) as any;
    const smResults = smSearch.results || [];
    const smCtx = smResults.map((r: any) => r.memory || '').join('\n');
    const smAns = smCtx ? await gemini(`Context:\n${smCtx}\n\nQ: ${test.q}\nA (1-3 words):`) : 'No info';
    const smMatch = smAns.toLowerCase().includes(test.expected.toLowerCase());
    if (smMatch) smCorrect++;

    // Search Aethene (with containerTag to filter results)
    const aeSearch = await aetheneRequest('/v1/search', { query: test.q, containerTag: TAG, limit: 3 }) as any;
    const aeResults = aeSearch.results || [];
    const aeCtx = aeResults.map((r: any) => r.memory || r.content || '').join('\n');
    const aeAns = aeCtx ? await gemini(`Context:\n${aeCtx}\n\nQ: ${test.q}\nA (1-3 words):`) : 'No info';
    const aeMatch = aeAns.toLowerCase().includes(test.expected.toLowerCase());
    if (aeMatch) aetheneCorrect++;

    console.log(`   SM: ${smResults.length} results → "${smAns}" ${smMatch ? '✅' : '❌'}`);
    console.log(`   AE: ${aeResults.length} results → "${aeAns}" ${aeMatch ? '✅' : '❌'}`);
    console.log();

    await new Promise(r => setTimeout(r, 300));
  }

  // ============================================================
  // PHASE 3: RESULTS
  // ============================================================
  console.log("=".repeat(50));
  console.log(`SUPERMEMORY: ${smCorrect}/${testQuestions.length} = ${(smCorrect/testQuestions.length*100).toFixed(0)}%`);
  console.log(`AETHENE:     ${aetheneCorrect}/${testQuestions.length} = ${(aetheneCorrect/testQuestions.length*100).toFixed(0)}%`);
  console.log("=".repeat(50));

  // ============================================================
  // PHASE 4: COMPARE RESPONSE FORMATS
  // ============================================================
  console.log("\n📋 PHASE 4: Response format comparison...\n");

  const smSample = await smRequest('/v4/search', { q: "Sarah age", containerTag: TAG, limit: 1 }) as any;
  const aeSample = await aetheneRequest('/v1/search', { query: "Sarah age", containerTag: TAG, limit: 1 }) as any;

  console.log("SM Response Fields:");
  if (smSample.results?.[0]) {
    console.log(`  ${Object.keys(smSample.results[0]).join(', ')}`);
  } else {
    console.log("  (no results)");
  }

  console.log("\nAethene Response Fields:");
  if (aeSample.results?.[0]) {
    console.log(`  ${Object.keys(aeSample.results[0]).join(', ')}`);
  } else {
    console.log("  (no results)");
  }

  // Check field compatibility
  const requiredFields = ['id', 'memory', 'similarity', 'rootMemoryId', 'metadata', 'updatedAt', 'version'];
  console.log("\n✓ Field compatibility check:");
  for (const field of requiredFields) {
    const hasField = aeSample.results?.[0]?.[field] !== undefined;
    console.log(`  ${field}: ${hasField ? '✅' : '❌'}`);
  }
}

main().catch(console.error);
