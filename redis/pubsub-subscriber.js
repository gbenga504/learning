import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
client.on("error", (err) => console.error("Redis Client Error", err));
await client.connect();

const channel = "notifications";

await client.subscribe(channel, (message) => {
  console.log(`Received on "${channel}": ${message}`);
});

console.log(`Subscribed to "${channel}", waiting for messages...`);

process.on("SIGINT", async () => {
  await client.quit();
  process.exit(0);
});
