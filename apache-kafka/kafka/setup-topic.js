import { createKafka, TOPIC, DLQ_TOPIC, PARTITIONS } from "./config.js";

const admin = createKafka("setup").admin();
await admin.connect();

for (const [topic, numPartitions] of [
  [TOPIC, PARTITIONS],
  [DLQ_TOPIC, 1],
]) {
  const created = await admin.createTopics({
    topics: [{ topic, numPartitions }],
  });
  console.log(
    created
      ? `Created topic "${topic}" with ${numPartitions} partition(s)`
      : `Topic "${topic}" already exists`,
  );
}

await admin.disconnect();
