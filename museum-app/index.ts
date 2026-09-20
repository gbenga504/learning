import { chatProvider } from "./utils/ChatProvider";

async function main() {
  await chatProvider.chat({
    model: "gpt-oss:20b",
    prompt: "Do you know who elon musk is ?",
  });
}

main();
