import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
client.on("error", (err) => console.error("Redis Client Error", err));
await client.connect();

const channel = "notifications";
const message = process.argv[2] ?? `Hello Redis at ${new Date().toISOString()}`;

const receivers = await client.publish(channel, message);
console.log(`Published to "${channel}", received by ${receivers} subscriber(s)`);

await client.quit();
