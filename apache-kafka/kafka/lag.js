import { createKafka, TOPIC } from "./config.js";

const groups = process.argv.slice(2);
if (groups.length === 0) groups.push("invoice-service", "email-service");

const admin = createKafka("lag").admin();
await admin.connect();

const end = await admin.fetchTopicOffsets(TOPIC);

for (const groupId of groups) {
  const [{ partitions }] = await admin.fetchOffsets({ groupId, topics: [TOPIC] });
  console.log(`\n${groupId}`);
  console.log("partition  committed  log-end  lag");
  let total = 0;
  for (const { partition, offset: committed } of partitions) {
    const logEnd = Number(end.find((p) => p.partition === partition).offset);
    const done = Number(committed) < 0 ? 0 : Number(committed);
    total += logEnd - done;
    console.log(
      `${String(partition).padEnd(10)} ${String(committed).padEnd(10)} ${String(logEnd).padEnd(8)} ${logEnd - done}`,
    );
  }
  console.log(`total lag: ${total}`);
}

await admin.disconnect();
