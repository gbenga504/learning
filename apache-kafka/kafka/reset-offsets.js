import { createKafka, TOPIC } from "./config.js";

const [groupId, mode, value] = process.argv.slice(2);
const usage =
  "usage: npm run reset -- <group> --earliest | --offset <n> | --timestamp <ISO date>";

if (!groupId || !["--earliest", "--latest", "--offset", "--timestamp"].includes(mode)) {
  console.error(usage);
  process.exit(1);
}

const admin = createKafka("reset").admin();
await admin.connect();

try {
  if (mode === "--earliest") {
    const partitions = (await admin.fetchTopicOffsets(TOPIC)).map((p) => ({
      partition: p.partition,
      offset: p.low,
    }));
    await admin.setOffsets({ groupId, topic: TOPIC, partitions });
  } else if (mode === "--latest") {
    const partitions = (await admin.fetchTopicOffsets(TOPIC)).map((p) => ({
      partition: p.partition,
      offset: p.high,
    }));
    await admin.setOffsets({ groupId, topic: TOPIC, partitions });
  } else if (mode === "--offset") {
    const partitions = (await admin.fetchTopicOffsets(TOPIC)).map((p) => ({
      partition: p.partition,
      offset: String(Math.min(Number(value), Number(p.offset))),
    }));
    await admin.setOffsets({ groupId, topic: TOPIC, partitions });
  } else {
    const at = new Date(value).getTime();
    const partitions = await admin.fetchTopicOffsetsByTimestamp(TOPIC, at);
    await admin.setOffsets({
      groupId,
      topic: TOPIC,
      partitions: partitions.map((p) => ({ partition: p.partition, offset: p.offset })),
    });
  }
  console.log(`Reset "${groupId}" on "${TOPIC}" (${mode} ${value ?? ""}). Run npm run lag to check.`);
} catch (err) {
  console.error(`Reset failed: ${err.message}`);
  console.error("The group must have no running consumers. Stop the service first.");
  process.exitCode = 1;
}

await admin.disconnect();
