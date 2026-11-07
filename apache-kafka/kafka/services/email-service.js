import { runService } from "../service-runner.js";
import * as store from "../processed-store.js";

// Failure simulation, controlled by environment variables:
//   CRASH_ONCE=1            kill the process once, after the email is sent but
//                           before we record that it was sent
//   NO_IDEMPOTENCY_KEY=1    do not send an idempotency key to the provider
const CRASH_ONCE = process.env.CRASH_ONCE === "1";
const USE_KEY = process.env.NO_IDEMPOTENCY_KEY !== "1";

// Stands in for an email provider. With an idempotency key, it ignores a
// second request carrying the same key. Every real delivery is appended to
// emails-delivered.log so you can count them.
function sendViaProvider(event, idempotencyKey) {
  if (idempotencyKey && store.has("provider-keys.log", idempotencyKey)) {
    console.log(`  provider ignored duplicate request, key ${idempotencyKey}`);
    return;
  }
  if (idempotencyKey) store.add("provider-keys.log", idempotencyKey);
  store.add("emails-delivered.log", event.bookingId);
  console.log(`  confirmation email sent to ${event.tenantEmail} for ${event.bookingId}`);
}

await runService({
  name: "email-service",
  groupId: "email-service",
  handle: async (event) => {
    if (store.has("emails.log", event.bookingId)) {
      console.log(`  duplicate, email for ${event.bookingId} already sent, skipping`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    sendViaProvider(event, USE_KEY ? event.bookingId : undefined);

    if (CRASH_ONCE && store.once("email-crashed.marker")) {
      console.log("  CRASH: dying after sending, before recording it");
      process.exit(1);
    }

    store.add("emails.log", event.bookingId);
  },
});
