// Runs the real router prompt against the regression set and reports accuracy per intent.
// Usage: node scripts/eval-router.js   (needs GROQ_API_KEY). Calls the model once per case.
require("dotenv").config();
const cases = require("./eval/router-cases");
const { processText } = require("../src/services/groqService");
const { buildRouterPrompt, safeJsonParse } = require("../src/controllers/iaController");

(async () => {
  const prompt = buildRouterPrompt("");
  const perIntent = {};
  let correct = 0;
  const misses = [];

  for (const c of cases) {
    let got = null;
    try {
      got = safeJsonParse(await processText(c.text, prompt))?.intent ?? null;
    } catch (err) {
      got = `ERROR: ${err.message}`;
    }
    const ok = got === c.intent;
    if (ok) correct += 1;
    else misses.push({ text: c.text, expected: c.intent, got });
    perIntent[c.intent] ||= { total: 0, ok: 0 };
    perIntent[c.intent].total += 1;
    if (ok) perIntent[c.intent].ok += 1;
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\nIntent                    ok/total");
  for (const [intent, v] of Object.entries(perIntent)) {
    console.log(`${intent.padEnd(26)}${v.ok}/${v.total}`);
  }
  console.log(`\nOverall: ${correct}/${cases.length} (${Math.round((100 * correct) / cases.length)}%)`);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log(`- "${m.text}"\n    expected ${m.expected}, got ${m.got}`);
  }
})();
