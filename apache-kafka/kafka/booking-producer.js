import { randomUUID } from "node:crypto";
import { createKafka, TOPIC } from "./config.js";

// Simulates the booking service: emits one booking_created event per booking.
// idempotent: the broker drops duplicates caused by producer retries.
const producer = createKafka("booking-service").producer({ idempotent: true });
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 5);
const poison = args.includes("--poison");
// --key=<k> forces every booking onto one partition.
const fixedKey = flag("key");
// --hot sends 80% of bookings for one artist. --salt=<n> spreads that artist
// over n keys.
const hot = args.includes("--hot");
const salt = Number(flag("salt") ?? 0);
const HOT_ARTIST = "taylor-swift";

function keyFor(bookingId, i) {
  if (fixedKey) return fixedKey;
  if (!hot) return bookingId;
  if (Math.random() >= 0.8) return `artist-${Math.floor(Math.random() * 20)}`;
  return salt > 0 ? `${HOT_ARTIST}-${i % salt}` : HOT_ARTIST;
}

const perPartition = {};

await producer.connect();

for (let i = 0; i < count; i++) {
  const event = {
    type: "booking_created",
    bookingId: `booking-${randomUUID().slice(0, 8)}`,
    tenantEmail: `tenant${i}@example.com`,
    amountEur: poison && i === count - 1 ? 0 : 1000 + i * 150,
    createdAt: new Date().toISOString(),
  };
  const key = keyFor(event.bookingId, i);

  const [meta] = await producer.send({
    topic: TOPIC,
    messages: [{ key, value: JSON.stringify(event) }],
  });

  perPartition[meta.partition] = (perPartition[meta.partition] ?? 0) + 1;
  if (!hot) console.log(`Sent ${event.bookingId} to partition ${meta.partition}`);
}

if (hot) {
  console.log(`Sent ${count} bookings, ${salt > 0 ? `hot artist salted over ${salt} keys` : "hot artist unsalted"}`);
  for (const partition of Object.keys(perPartition).sort()) {
    const n = perPartition[partition];
    console.log(`partition ${partition}: ${String(n).padStart(4)} ${"#".repeat(Math.round((n / count) * 50))}`);
  }
}

await producer.disconnect();
