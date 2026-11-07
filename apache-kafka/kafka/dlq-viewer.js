import { createKafka, DLQ_TOPIC } from "./config.js";

// Prints everything parked on the dead letter topic.
const consumer = createKafka("dlq-viewer").consumer({ groupId: "dlq-viewer" });
await consumer.connect();
await consumer.subscribe({ topic: DLQ_TOPIC, fromBeginning: true });

await consumer.run({
  eachMessage: async ({ message }) => {
    const h = (k) => message.headers[k]?.toString();
    console.log(
      `[dlq] from ${h("service")} (partition ${h("sourcePartition")}, offset ${h("sourceOffset")}): ${message.value.toString()}`,
    );
  },
});

console.log(`Reading "${DLQ_TOPIC}", waiting for messages...`);

process.on("SIGINT", async () => {
  await consumer.disconnect();
  process.exit(0);
});
