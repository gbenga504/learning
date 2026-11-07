import { runService } from "../service-runner.js";
import * as store from "../processed-store.js";

// Failure simulation, controlled by environment variables:
//   FAIL_RATE=0.5   each attempt fails randomly (transient error, retry fixes it)
//   SLOW_MS=2000    time one invoice takes (default 300)
//   CRASH_ONCE=1    kill the process once, after the invoice is saved but
//                   before Kafka records the offset
// An amountEur <= 0 always fails (poison message, ends up on the DLQ).
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0);
const SLOW_MS = Number(process.env.SLOW_MS ?? 300);
const CRASH_ONCE = process.env.CRASH_ONCE === "1";

await runService({
  name: "invoice-service",
  groupId: "invoice-service",
  handle: async (event) => {
    // Idempotency: the same booking must never be invoiced twice.
    if (store.has("invoices.log", event.bookingId)) {
      console.log(`  duplicate, invoice for ${event.bookingId} already exists, skipping`);
      return;
    }

    if (event.amountEur <= 0) {
      throw new Error(`invalid amount ${event.amountEur}`);
    }
    if (Math.random() < FAIL_RATE) {
      throw new Error("temporary failure");
    }

    // simulate generating an invoice
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    store.add("invoices.log", event.bookingId);
    console.log(`  invoice created for ${event.bookingId}: ${event.amountEur} EUR`);

    if (CRASH_ONCE && store.once("crashed.marker")) {
      console.log("  CRASH: dying before the offset is committed");
      process.exit(1);
    }
  },
});
