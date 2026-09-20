import {
  createReadStream,
  createWriteStream,
  existsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

function reverseString(stringToReverse: string): string {
  return stringToReverse
    .split("")
    .reduce((acc: string[], s) => [s, ...acc], [])
    .join("");
}

async function reverseFileContent(): Promise<void> {
  const readerStream = createReadStream(
    path.join(__dirname, "reading-file.txt"),
    { highWaterMark: 1024 * 2 },
  );
  const writeFilePath = path.join(__dirname, "writing-file.txt");

  const doesWriteFileExist = existsSync(writeFilePath);

  if (!doesWriteFileExist) {
    writeFileSync(writeFilePath, "");
  }

  const readLine = readline.createInterface({
    input: readerStream,
    crlfDelay: Infinity,
  });

  const writerStream = createWriteStream(writeFilePath);
  const chunks: string[] = [];

  try {
    for await (const chunk of readLine) {
      const transformedChunk = chunk.toUpperCase();

      chunks.unshift(`${transformedChunk}\n`);
    }

    for (const chunk of chunks) {
      writerStream.write(chunk);
    }
  } catch (err) {
    console.log("An error occurred");
  } finally {
    writerStream.end();
  }
}

reverseFileContent();
