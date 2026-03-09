const AETHENE = 'http://localhost:3006';
const KEY = 'ae_dev_test123';
const GEMINI = 'AIzaSyA22gt7KozJT6uM4RMq9zeqC-SdCUBZOTI';

async function search(q: string) {
  const r = await fetch(`${AETHENE}/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ query: q, limit: 3 })
  });
  return ((await r.json()) as any).results || [];
}

async function ask(q: string, ctx: string) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Context:\n${ctx}\n\nQ: ${q}\nA (1-3 words only):` }] }],
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
  console.log("🧪 AETHENE LoCoMo Test\n");
  let correct = 0;

  for (const t of tests) {
    const results = await search(t.q);
    const ctx = results.map((r: any) => r.content || r.memory).join('\n');
    const ans = await ask(t.q, ctx);
    const match = ans.toLowerCase().includes(t.a);
    if (match) correct++;
    console.log(`Q: ${t.q}`);
    console.log(`   Expected: ${t.a}`);
    console.log(`   Got: ${ans}`);
    console.log(`   ${match ? '✅' : '❌'}\n`);
  }

  console.log("=".repeat(40));
  console.log(`SCORE: ${correct}/${tests.length} = ${(correct/tests.length*100).toFixed(0)}%`);
  console.log("=".repeat(40));
}

main();
