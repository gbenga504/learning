import { chatProvider } from "./utils/ChatProvider";

async function main() {
  chatProvider.agentic({
    model: "gpt-oss:20b",
  });
}

main();
