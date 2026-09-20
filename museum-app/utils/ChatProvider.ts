import chalk from "chalk";
import ollama, { AbortableAsyncIterator, ChatResponse } from "ollama";

class ChatProvider {
  async chat({
    model,
    prompt,
  }: {
    model: string;
    prompt: string;
  }): Promise<void> {
    const response = await ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      think: true,
    });

    this.performOperation(response);
  }

  private async performOperation(
    response: AbortableAsyncIterator<ChatResponse>,
  ) {
    let isStreamingThought = false;

    for await (const chunk of response) {
      if (chunk.message.thinking) {
        if (!isStreamingThought) {
          isStreamingThought = true;
        }

        process.stdout.write(chalk.blue(chunk.message.thinking));
      }

      if (chunk.message.content) {
        if (isStreamingThought) {
          isStreamingThought = false;

          process.stdout.write(
            "\n\n ================ Answer ====================== \n\n",
          );
        }

        process.stdout.write(chunk.message.content);
      }
    }
  }
}

const chatProvider = new ChatProvider();

export { chatProvider };
