/**
 * Work/Professional Test - SM vs Aethene
 */
const SM_API = 'https://api.supermemory.ai';
const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const AETHENE_API = 'http://localhost:3006';
const AETHENE_KEY = 'ae_dev_test123';
const GEMINI = 'process.env.GEMINI_API_KEY';
const TAG = `work_${Date.now()}`;

const workFacts = [
  "Emma joined the company in January 2022",
  "Emma's salary is $120,000 per year",
  "Emma reports to David Chen, the VP of Engineering",
  "Emma leads a team of 5 engineers",
  "Emma's main project is the recommendation system",
  "Emma uses Python and TypeScript at work",
  "Emma has a standup meeting every morning at 9am",
  "Emma's performance review is in March",
  "Emma worked at Amazon before this job",
  "Emma has 3 weeks of vacation days remaining",
];

const questions = [
  { q: "When did Emma join the company?", expected: "january" },
  { q: "What is Emma's salary?", expected: "120" },
  { q: "Who is Emma's manager?", expected: "david" },
  { q: "How many engineers does Emma lead?", expected: "5" },
  { q: "What project does Emma work on?", expected: "recommendation" },
  { q: "What programming languages does Emma use?", expected: "python" },
  { q: "What time is Emma's standup?", expected: "9" },
  { q: "When is Emma's performance review?", expected: "march" },
  { q: "Where did Emma work before?", expected: "amazon" },
  { q: "How many vacation days does Emma have?", expected: "3" },
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

// Number word mapping for flexible matching
const numberWords: Record<string, string> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'
};

function matchAnswer(answer: string, expected: string): boolean {
  const lower = answer.toLowerCase();
  const exp = expected.toLowerCase();
  if (lower.includes(exp)) return true;
  // Check word form of numbers
  if (numberWords[exp] && lower.includes(numberWords[exp])) return true;
  return false;
}

async function main() {
  console.log("💼 WORK TEST - SM vs AETHENE\n");
  console.log(`Tag: ${TAG}\n`);

  console.log("📥 Ingesting work facts...\n");

  console.log("  → Supermemory...");
  for (const fact of workFacts) {
    await smRequest('/v3/documents', { content: fact, containerTags: [TAG] });
  }
  console.log(`    ✓ Ingested ${workFacts.length} facts`);

  console.log("  → Aethene...");
  const ae = await aetheneRequest('/v1/memories', {
    memories: workFacts.map(f => ({ content: f, isCore: true })),
    containerTag: TAG
  });
  console.log(`    ✓ Created ${ae.created || 0} memories`);

  console.log("\n⏳ Waiting 10s...\n");
  await new Promise(r => setTimeout(r, 10000));

  console.log("📝 Testing...\n");
  let smCorrect = 0, aeCorrect = 0;

  for (const test of questions) {
    console.log(`Q: ${test.q}`);

    const smSearch = await smRequest('/v4/search', { q: test.q, containerTag: TAG, limit: 5 }) as any;
    const smCtx = (smSearch.results || []).map((r: any) => r.memory || '').join('\n');
    const smAns = smCtx ? await gemini(`Context:\n${smCtx}\n\nQ: ${test.q}\nA (1-5 words):`) : 'No info';
    const smMatch = matchAnswer(smAns, test.expected);
    if (smMatch) smCorrect++;

    const aeSearch = await aetheneRequest('/v1/search', { query: test.q, containerTag: TAG, limit: 5 }) as any;
    const aeCtx = (aeSearch.results || []).map((r: any) => r.memory || '').join('\n');
    const aeAns = aeCtx ? await gemini(`Context:\n${aeCtx}\n\nQ: ${test.q}\nA (1-5 words):`) : 'No info';
    const aeMatch = matchAnswer(aeAns, test.expected);
    if (aeMatch) aeCorrect++;

    console.log(`   SM: "${smAns}" ${smMatch ? '✅' : '❌'}`);
    console.log(`   AE: "${aeAns}" ${aeMatch ? '✅' : '❌'}`);
    console.log();

    await new Promise(r => setTimeout(r, 300));
  }

  console.log("=".repeat(50));
  console.log(`SUPERMEMORY: ${smCorrect}/${questions.length} = ${(smCorrect/questions.length*100).toFixed(0)}%`);
  console.log(`AETHENE:     ${aeCorrect}/${questions.length} = ${(aeCorrect/questions.length*100).toFixed(0)}%`);
  console.log("=".repeat(50));
}

main().catch(console.error);
