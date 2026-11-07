import { createKafka, TOPIC, DLQ_TOPIC } from "./config.js";

const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PARTITIONS_CONCURRENTLY = Number(process.env.PARTITIONS_CONCURRENTLY ?? 1);
const time = () => new Date().toISOString().slice(11, 23);

// Shared plumbing for a downstream service.
// Each service has its own groupId, so every service receives every event.
// Several instances of one service share a groupId, so they split partitions.
//
// Failure handling: a failing message is retried up to MAX_ATTEMPTS times.
// If it still fails, it is parked on the dead letter topic and we move on,
// so one bad message cannot block the partition.
export async function runService({ name, groupId, handle }) {
  const instance = process.argv[2] ?? "1";
  const label = `${name}#${instance}`;

  const kafka = createKafka(label);
  const consumer = kafka.consumer({ groupId });
  const dlqProducer = kafka.producer({ idempotent: true });
  const log = (msg) => console.log(`${time()} [${label}] ${msg}`);

  consumer.on(consumer.events.REBALANCING, () => log("rebalancing, partitions revoked"));
  consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
    const owned = payload.memberAssignment[TOPIC] ?? [];
    log(`joined group, owns partitions [${owned.join(", ")}]`);
  });

  await Promise.all([consumer.connect(), dlqProducer.connect()]);
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  const commit = async (partition, message) => {
    const next = String(Number(message.offset) + 1);
    await consumer.commitOffsets([{ topic: TOPIC, partition, offset: next }]);
    log(`committed partition ${partition}, next offset ${next}`);
  };

  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: PARTITIONS_CONCURRENTLY,
    eachMessage: async ({ partition, message }) => {
      const event = JSON.parse(message.value.toString());
      log(`start ${event.bookingId} partition ${partition}, offset ${message.offset}`);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await handle(event);
          await commit(partition, message);
          return;
        } catch (err) {
          console.log(
            `  attempt ${attempt}/${MAX_ATTEMPTS} failed for ${event.bookingId}: ${err.message}`,
          );
          if (attempt < MAX_ATTEMPTS) await sleep(200 * 2 ** attempt);
        }
      }

      await dlqProducer.send({
        topic: DLQ_TOPIC,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers: {
              service: name,
              sourcePartition: String(partition),
              sourceOffset: message.offset,
            },
          },
        ],
      });
      console.log(`  parked ${event.bookingId} on ${DLQ_TOPIC}`);
      await commit(partition, message);
    },
  });

  log(`running in group "${groupId}", partitionsConsumedConcurrently=${PARTITIONS_CONCURRENTLY}`);

  process.on("SIGINT", async () => {
    await consumer.disconnect();
    await dlqProducer.disconnect();
    process.exit(0);
  });
}
