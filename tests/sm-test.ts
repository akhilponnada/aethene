/**
 * Supermemory LoCoMo Test - Search only (data already ingested)
 */
const SM_API = 'https://api.supermemory.ai';
const SM_KEY = 'sm_jUqfEvKttp8dGVup2x3eaF_WmqwSzZOkKZSrLWVVDacTCcBsXnrktoFyixCKuhTBIywSPeGgikyKaRYXnpyWPQX';
const GEMINI = 'process.env.GEMINI_API_KEY';
const TAG = 'locomo_test_1772670362817';

async function sm(endpoint: string, body: any) {
  const r = await fetch(`${SM_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SM_KEY },
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
      generationConfig: { temperature: 0, maxOutputTokens: 20 }
    })
  });
  return ((await r.json()) as any).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'N/A';
}

const tests = [
  { q: "What is Caroline's identity?", a: "transgender" },
  { q: "What did Caroline research?", a: "adoption" },
  { q: "When is Melanie going camping?", a: "june" },
  { q: "Where did Caroline move from?", a: "sweden" },
  { q: "Is Caroline single or married?", a: "single" },
];

async function main() {
  console.log("🧪 SUPERMEMORY LoCoMo Test\n");

  let correct = 0;

  for (const t of tests) {
    console.log(`Q: ${t.q}`);

    const search = await sm('/v4/search', { q: t.q, containerTag: TAG, limit: 5 }) as any;
    const results = search.results || [];
    const ctx = results.map((r: any) => r.memory || '').join('\n');

    const ans = ctx ? await gemini(`Context:\n${ctx}\n\nQ: ${t.q}\nA (1-3 words only):`) : 'No info';
    const match = ans.toLowerCase().includes(t.a);
    if (match) correct++;

    console.log(`   Results: ${results.length} | Top: "${results[0]?.memory?.slice(0,40) || 'none'}..."`);
    console.log(`   Expected: ${t.a}`);
    console.log(`   Got: ${ans}`);
    console.log(`   ${match ? '✅' : '❌'}\n`);
  }

  console.log("=".repeat(40));
  console.log(`SUPERMEMORY: ${correct}/${tests.length} = ${(correct/tests.length*100).toFixed(0)}%`);
  console.log("=".repeat(40));
}

main();
