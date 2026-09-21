import chalk from "chalk";
import ollama, { Tool } from "ollama";
import readline from "node:readline";
import { PDFParse } from "pdf-parse";
import ansiEscapes from "ansi-escapes";
import stringWidth from "string-width";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as any);

class ChatProvider {
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
  private readonly RENDER_THROTTLE_MS = 80;

  private getTerminalRowsForText(text: string): number {
    const columns = process.stdout.columns || 80;

    return text.split("\n").reduce((total, line) => {
      const width = stringWidth(line);

      return total + Math.max(1, Math.ceil(width / columns));
    }, 0);
  }

  private renderMarkdownFrame(markdownText: string): void {
    const rendered = marked.parse(markdownText) as string;

    if (this.lastRenderedLineCount > 0) {
      process.stdout.write(ansiEscapes.eraseLines(this.lastRenderedLineCount));
    }

    process.stdout.write(rendered);

    this.lastRenderedLineCount = this.getTerminalRowsForText(rendered);
  }

  private throttle(callback: Function, limit: number) {
    let lastRenderTime = 0;

    return function (...args: any[]) {
      let now = Date.now();

      if (now - lastRenderTime >= limit) {
        callback(args);

        lastRenderTime = now;
      }
    };
  }

  async generate({
    model,
    prompt,
  }: {
    model: string;
    prompt: string;
  }): Promise<void> {
    await this.startAgenticLoop({ model, prompt });
  }

  async agentic({ model }: { model: string }): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You > ",
    });

    const that = this;

    rl.prompt();

    rl.on("line", async function processLine(line: string) {
      const userInput = line.trim();

      if (userInput.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      await that.startAgenticLoop({ model, prompt: userInput });

      rl.prompt();
    });

    rl.on("close", function () {
      process.stdout.write(chalk.red("Exiting..."));
      process.exit();
    });
  }

  async runAgent({ model }: { model: string }): Promise<void> {
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
    }, this.RENDER_THROTTLE_MS);

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

            return this.runAgent({ model });
          }

          const result = await tool.function.call(functionArgs);
          this.chatHistory = [
            ...this.chatHistory,
            {
              role: "tool",
              content: JSON.stringify(result),
            },
          ];

          return this.runAgent({ model });
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
      }
    }
  }

  async startAgenticLoop({ model, prompt }: { model: string; prompt: string }) {
    this.chatHistory = [...this.chatHistory, { role: "user", content: prompt }];

    return this.runAgent({ model });
  }

  private getTools(): (Pick<Tool, "type"> & {
    function: Tool["function"] & { call: (args: any) => Promise<any> };
  })[] {
    return [
      {
        type: "function",
        function: {
          name: "get_author_name",
          description: "Retrieves the name of the current code author",
          call: async function (args: any) {
            return "Gbenga";
          },
        },
      },
      {
        type: "function",
        function: {
          name: "calculate_numbers",
          description: "Solves simple mathematical and arithmetic expressions.",
          parameters: {
            type: "object",
            properties: {
              expression: {
                type: "string",
                description: "The math string to evaluate e.g 22 * 2",
              },
            },
            required: ["expression"],
          },
          call: async function (args: {
            expression: string;
          }): Promise<number | string> {
            try {
              const sanitized = args.expression.replace(
                /[^0-9+\-*/().\s]/g,
                "",
              );
              const result: number = new Function(`return (${sanitized})`)();

              return result;
            } catch (error) {
              return `An error occurred. ${error}`;
            }
          },
        },
      },
      {
        type: "function",
        function: {
          name: "parse_pdf_to_text",
          description: "Extract text, images, and tables from PDFs",
          parameters: {
            type: "object",
            properties: {
              pdfFilePath: {
                type: "string",
                description: "The url or file path to the pdf file",
              },
            },
            required: ["pdfFilePath"],
          },
          call: async function (args: {
            pdfFilePath: string;
          }): Promise<string> {
            try {
              const parser = new PDFParse({
                url: args.pdfFilePath,
              });

              const result = await parser.getText();
              return result.text;
            } catch (error) {
              return `An error occurred. ${error}`;
            }
          },
        },
      },
    ];
  }
}

const chatProvider = new ChatProvider();

export { chatProvider };
