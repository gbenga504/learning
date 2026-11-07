import { micromark } from "micromark";
import chalk from "chalk";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
}

const TOKEN_RE = /<([a-zA-Z0-9]+)(?:\s[^>]*)?\/?>|<\/([a-zA-Z0-9]+)>|([^<]+)/g;

type StyleFn = (text: string) => string;

/**
 * micromark disables raw HTML passthrough by default, so its output only
 * ever contains the closed set of tags it generates itself from markdown
 * constructs - a lightweight tag-token walk is safe here, no HTML parser needed.
 */
function htmlToAnsi(html: string): string {
  let out = "";
  const styleStack: StyleFn[] = [];
  const listStack: Array<{ ordered: boolean; index: number }> = [];
  let inPre = false;

  const applyStyles = (text: string): string =>
    styleStack.reduce((acc, style) => style(acc), text);

  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(html))) {
    const [, openTag, closeTag, text] = match;

    if (text !== undefined) {
      if (!inPre && text.trim() === "") {
        // Whitespace-only text nodes are micromark's own HTML pretty-printing
        // between tags, not real content - skip so block styles (blockquote,
        // list bullets) don't get applied to blank padding lines.
        continue;
      }

      const decoded = decodeEntities(text);
      out += inPre
        ? chalk.gray(decoded)
        : applyStyles(decoded.replace(/\s+/g, " "));
      continue;
    }

    const tag = (openTag ?? closeTag ?? "").toLowerCase();
    const isClose = Boolean(closeTag);

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        if (!isClose) {
          out += "\n";
          styleStack.push(tag === "h1" ? chalk.bold.underline : chalk.bold);
        } else {
          styleStack.pop();
          out += "\n\n";
        }
        break;
      case "p":
        if (isClose) out += "\n\n";
        break;
      case "strong":
        isClose ? styleStack.pop() : styleStack.push(chalk.bold);
        break;
      case "em":
        isClose ? styleStack.pop() : styleStack.push(chalk.italic);
        break;
      case "a":
        isClose ? styleStack.pop() : styleStack.push(chalk.blue.underline);
        break;
      case "code":
        if (!inPre) {
          isClose ? styleStack.pop() : styleStack.push(chalk.cyan);
        }
        break;
      case "pre":
        if (!isClose) {
          inPre = true;
          out += "\n";
        } else {
          inPre = false;
          out += "\n\n";
        }
        break;
      case "ul":
      case "ol":
        if (!isClose) {
          // A nested list can immediately follow its parent <li>'s text with
          // no whitespace text node to separate them - always break the line.
          if (!out.endsWith("\n")) out += "\n";
          listStack.push({ ordered: tag === "ol", index: 0 });
        } else {
          listStack.pop();
          if (listStack.length === 0) out += "\n";
        }
        break;
      case "li": {
        if (isClose) {
          out += "\n";
          break;
        }

        const current = listStack[listStack.length - 1];
        if (current) {
          current.index += 1;
          const indent = "  ".repeat(listStack.length - 1);
          const bullet = current.ordered ? `${current.index}.` : "-";
          out += `${indent}${chalk.gray(bullet)} `;
        }
        break;
      }
      case "blockquote":
        if (!isClose) {
          out += "\n";
          styleStack.push((text) => chalk.gray(text.replace(/^/gm, "│ ")));
        } else {
          styleStack.pop();
          out += "\n\n";
        }
        break;
      case "hr":
        out += `\n${chalk.gray("─".repeat(process.stdout.columns || 40))}\n\n`;
        break;
      case "br":
        out += "\n";
        break;
      default:
        break;
    }
  }

  return `${out.trimEnd()}\n`;
}

function renderMarkdownToAnsi(markdownText: string): string {
  return htmlToAnsi(micromark(markdownText));
}

export { renderMarkdownToAnsi };
