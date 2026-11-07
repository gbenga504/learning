import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
client.on("error", (err) => console.error("Redis Client Error", err));
await client.connect();

async function fetchUserFromSource(id) {
  // simulate a slow database/API call
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { id, name: `User ${id}`, fetchedAt: new Date().toISOString() };
}

async function getUser(id) {
  const cacheKey = `user:${id}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    console.log("Cache hit");
    return JSON.parse(cached);
  }

  console.log("Cache miss, fetching from source...");
  const user = await fetchUserFromSource(id);
  await client.set(cacheKey, JSON.stringify(user), { EX: 30 });
  return user;
}

const userId = process.argv[2] ?? "42";
const user = await getUser(userId);
console.log(user);

const ttl = await client.ttl(`user:${userId}`);
console.log(`Key expires in ${ttl}s`);

await client.quit();
