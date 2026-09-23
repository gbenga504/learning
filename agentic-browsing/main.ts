import { browser } from "./browser/browser";
import { llmProvider } from "./llm-provider/llm-provider";

async function main() {
  await llmProvider.run({
    model: "gpt-oss:20b",
    prompt:
      "visit https://donodash.com and tell me what the front page is about",
  });
}

main();
