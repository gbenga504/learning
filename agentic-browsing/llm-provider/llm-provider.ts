import ollama, { Tool as OllamaTool } from "ollama";
import { browser } from "../browser/browser";
import z from "zod";
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import ansiEscapes from "ansi-escapes";
import stringWidth from "string-width";

marked.use(markedTerminal() as any);

const RENDER_THROTTLE_MS = 80;
type Tool = Pick<OllamaTool, "type"> & {
  function: OllamaTool["function"] & {
    call: (args: unknown) => Promise<unknown>;
  };
};

class LLMProvider {
  private chatHistory: {
    role: "system" | "assistant" | "user" | "tool";
    content: string;
  }[] = [
    {
      role: "system",
      content:
        "Reply to the user using markdown formatting (headings, bold, lists, code blocks) where it improves readability.",
    },
  ];
  private lastRenderedLineCount = 0;

  throttle(callback: Function, limit: number) {
    let lastRunAt = 0;

    return (...args: any[]) => {
      const now = Date.now();

      if (now - lastRunAt >= limit) {
        callback(args);

        lastRunAt = now;
      }
    };
  }

  private getTerminalRowsForText(text: string): number {
    const columns = process.stdout.columns || 80;

    return text.split("\n").reduce((total, line) => {
      const width = stringWidth(line);

      return total + Math.max(1, Math.ceil(width / columns));
    }, 0);
  }

  async run({ model, prompt }: { model: string; prompt: string }) {
    this.chatHistory = [...this.chatHistory, { role: "user", content: prompt }];

    await this.runAgenticLoop({ model });
  }

  private renderMarkdownFrame(markdownText: string): void {
    const rendered = marked.parse(markdownText) as string;

    if (this.lastRenderedLineCount > 0) {
      process.stdout.write(ansiEscapes.eraseLines(this.lastRenderedLineCount));
    }

    process.stdout.write(rendered);

    this.lastRenderedLineCount = this.getTerminalRowsForText(rendered);
  }

  async runAgenticLoop({ model }: { model: string }): Promise<void> {
    this.lastRenderedLineCount = 0;

    process.stdout.write(chalk.green("\n💭 Thinking...\n\n"));

    const response = await ollama.chat({
      model,
      messages: [...this.chatHistory],
      stream: true,
      think: true,
      tools: this.getTools(),
    });

    let isStreamingThought = false;
    let fullResponseText = "";

    const throttledRenderMarkdownFrame = this.throttle(() => {
      this.renderMarkdownFrame(fullResponseText);
    }, RENDER_THROTTLE_MS);

    for await (const chunk of response) {
      if (chunk.message.thinking) {
        if (!isStreamingThought) {
          isStreamingThought = true;

          process.stdout.write(chalk.gray("❄️  Thoughts: "));
        }

        process.stdout.write(chalk.gray(chunk.message.thinking));
      }

      if (chunk.message.content) {
        if (isStreamingThought) {
          isStreamingThought = false;

          process.stdout.write("\n\n");
          this.lastRenderedLineCount = 0;
        }

        fullResponseText += chunk.message.content;
        throttledRenderMarkdownFrame(fullResponseText);
      }

      if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
        for (const toolCall of chunk.message.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = toolCall.function.arguments;

          const tool = this.getTools().find(
            (t) => t.function.name === functionName,
          );

          if (!tool) {
            process.stdout.write("\n\n");
            process.stdout.write("🔴 ");

            process.stdout.write(chalk.red("Failed to find tool"));
            this.chatHistory = [
              ...this.chatHistory,
              {
                role: "tool",
                content: "Failed to find the proper tool. Please try again",
              },
            ];

            return this.runAgenticLoop({ model });
          }

          const result = await tool.function.call(functionArgs);
          this.chatHistory = [
            ...this.chatHistory,
            {
              role: "tool",
              content: JSON.stringify(result),
            },
          ];

          return this.runAgenticLoop({ model });
        }
      }

      if (chunk.done) {
        if (fullResponseText) {
          this.renderMarkdownFrame(fullResponseText);
          this.lastRenderedLineCount = 0;
        }

        this.chatHistory = [
          ...this.chatHistory,
          { role: "assistant", content: fullResponseText },
        ];

        process.stdout.write(
          chalk.gray(
            `❄️  Crunched for ${Math.round(chunk.total_duration / 1_000_000_000)}s`,
          ),
        );
        process.stdout.write("\n\n");

        await browser.close();
      }
    }
  }

  private getTools(): Tool[] {
    return [
      {
        type: "function",
        function: {
          name: "navigate_to_url",
          description:
            "Navigate to a URL and returns the html of the navigated page",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "The url to navigate to",
              },
            },
            required: ["url"],
          },
          call: async function (args: unknown): Promise<string> {
            const parsedArgs = z
              .object({
                url: z.string(),
              })
              .parse(args);

            try {
              return browser.visit({ url: parsedArgs.url });
            } catch (error) {
              return `An error occurred. ${error}`;
            }
          },
        },
      },
    ];
  }
}

const llmProvider = new LLMProvider();
export { llmProvider };
