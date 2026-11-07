# Kafka examples

Minimal, runnable setup for learning Kafka basics: a broker via Docker, plus small
Node.js scripts using [KafkaJS](https://kafka.js.org/).

```
kafka/    booking producer, consumer services (see example below)
```

## Setup

```bash
docker compose up -d   # starts Kafka on localhost:9094
npm install
```

Check it is healthy:

```bash
docker compose ps
docker compose logs -f kafka
```

## Concepts

Kafka is a distributed log: producers append messages to a **topic**, consumers
read them back, and messages stay around (subject to retention) so multiple
consumers can read the same data independently.

- **Broker**: the Kafka server that stores and serves messages. This example runs one.
- **Topic**: a named stream of messages (here: `booking-created`).
- **Partition**: a topic is split into partitions so it can be parallelized across
  consumers. Our topic has 3 partitions.
- **Consumer group**: consumers sharing a `groupId` split a topic's partitions
  between them, and Kafka tracks each group's read position (offset) per partition.

## Example: booking_created fan-out

A booking service emits a `booking_created` event. Two downstream services react
to it independently.

```
kafka/config.js              broker address, topic name, partition count
kafka/setup-topic.js         creates the topic with 3 partitions
kafka/booking-producer.js    the booking service, sends events keyed by bookingId (idempotent producer)
kafka/service-runner.js      shared consumer plumbing
kafka/services/invoice-service.js
kafka/services/email-service.js
```

Setup, once:

```bash
npm run setup
```

Start the services, each in its own terminal:

```bash
npm run invoice
npm run email
```

Send bookings from a third terminal:

```bash
npm run produce        # 5 bookings
npm run produce -- 20  # 20 bookings
```

What you see:

- **Fan-out between services.** Invoice and email use different `groupId`s, so
  each one receives every booking.
- **Key decides the partition.** The producer sets `key: bookingId`, so a booking
  always goes to the same partition. The producer prints which one.

Things to try:

- Scale a service. Start a second invoice instance with `npm run invoice -- 2`.
  Both share the group `invoice-service`, so Kafka splits the 3 partitions between
  them. Each booking is invoiced once, by one instance.
- Start a third and fourth instance. With 3 partitions, the fourth sits idle.
  Partitions cap how many consumers in a group can work in parallel.
- Stop a service, produce more, then start it again. It catches up from its
  committed offset. Other services are not affected.
- Add a new service (for example `analytics`) with a new `groupId`. With
  `fromBeginning: true` it replays all past bookings.

## Failure handling

Kafka delivers **at least once**. A message can arrive twice, so handlers must
cope. The invoice service shows three patterns.

```
kafka/processed-store.js   file-backed "table" with a unique key (stands in for a DB)
kafka/service-runner.js    retries (3 attempts, backoff), then parks the message on the DLQ
kafka/dlq-viewer.js        prints what is parked on booking-created.dlq
```

Create the DLQ topic (safe to re-run): `npm run setup`.

**1. Crash and redelivery, plus an idempotent handler**

`CRASH_ONCE=1` kills the invoice service after the invoice is saved but before
Kafka records the offset. This is the real duplicate window.

```bash
CRASH_ONCE=1 npm run invoice    # terminal 1
npm run produce -- 3            # terminal 2
npm run invoice                 # terminal 1 again, after the crash
```

After the restart the same booking arrives again. The log says
`duplicate, invoice for booking-... already exists, skipping`. The handler checks
the unique key first, so no second invoice is created. Reset state with `rm -rf .data`.

**2. Retries and the dead letter queue**

`--poison` makes the last booking invalid (amount 0). It can never succeed.

```bash
npm run invoice
npm run dlq                     # another terminal
npm run produce -- 3 --poison
```

The invoice service tries 3 times, then publishes the message to
`booking-created.dlq` with headers (service, source partition, source offset) and
moves on. Without a DLQ, one bad message would block its partition forever.

**3. Transient failures**

`FAIL_RATE=0.5 npm run invoice` makes half of the attempts fail randomly. Most
bookings succeed on a retry. A few fail all 3 attempts and land on the DLQ.

Note: after killing a consumer, the group waits for its old session to expire
(about 30s) before rebalancing. If a restarted service looks idle, wait a bit.

## Offsets: manual commits, lag and replay

An offset is a position in a partition. A group's committed offset means
"everything before this is done".

```
kafka/service-runner.js   autoCommit is off, the offset is committed after the handler succeeds
kafka/lag.js              committed offset, log end and lag per partition
kafka/reset-offsets.js    moves a group's offsets to replay history
```

**Manual commits.** Run `npm run invoice` and `npm run produce -- 2`. After each
booking the log shows `committed partition 1, next offset 10`. The committed
value is the offset of the processed message plus one. A crash before that line
means the message is delivered again.

**Lag.** Lag is log end minus committed offset: how far behind a group is.

```bash
npm run lag                       # invoice-service and email-service
npm run lag -- invoice-service
```

Stop the invoice service, produce a few bookings, run `npm run lag`, and watch
the lag grow. Start the service again and it drops to 0.

**Replay.** Stop the service first. Offsets can only be changed for a group with
no running consumers.

```bash
npm run reset -- invoice-service --earliest
npm run reset -- invoice-service --latest      # skip the backlog
npm run reset -- invoice-service --offset 5
npm run reset -- invoice-service --timestamp 2026-10-06T21:00:00Z
npm run invoice
```

The service reads the old messages again. Because the handler is idempotent,
bookings that already have an invoice are skipped. Run `rm -rf .data` before
the replay to see every invoice created again.

## Rebalancing and sequential processing

The service runner now timestamps every line and logs group membership changes.

**Rebalancing.** Start two instances of one service, then stop one.

```bash
npm run invoice          # terminal 1
npm run invoice -- 2     # terminal 2
```

Terminal 1 first owns `[0, 1, 2]`. When instance 2 joins, the log shows
`rebalancing, partitions revoked`, then instance 1 owns `[0, 1]` and instance 2
owns `[2]`. Press Ctrl+C in terminal 2 and instance 1 gets all three back. A
Ctrl+C leaves the group cleanly. A killed process (kill -9) is only noticed after
the session timeout (about 30s). KafkaJS also prints a few "group is
rebalancing" error lines during this. They are normal.

**Sequential processing.** One partition is processed one message at a time.
`SLOW_MS` sets how long an invoice takes, and `--key=` sends every booking to
one partition.

```bash
SLOW_MS=1000 npm run invoice
npm run produce -- 6 --key=taylor-swift
```

The start and committed timestamps show each message finishing before the next
one starts. Slow messages delay everything behind them in that partition, even
other bookings. This is head-of-line blocking, and the reason a hot key hurts.

**Parallel partitions in one instance.** By default an instance handles one
partition at a time, even if it owns three.

```bash
PARTITIONS_CONCURRENTLY=3 SLOW_MS=1000 npm run invoice
npm run produce -- 6
```

Messages from different partitions now overlap in time. Messages inside one
partition are still strictly sequential.

## Hot keys and salting

When one key gets most of the traffic, its partition becomes hot. The producer
can simulate this: `--hot` sends 80% of bookings for one artist, and prints how
many messages each partition received.

```bash
npm run produce -- 200 --hot              # no salting
npm run produce -- 200 --hot --salt=8     # hot artist spread over 8 keys
npm run produce -- 200 --hot --salt=30
```

Sample result from a 3-partition topic (200 bookings):

```
unsalted   partition 2: 175 (88%), partition 1: 16, partition 0: 9
salt=8     partition 1: 113, partition 0: 76, partition 2: 11
salt=30    partition 1: 100, partition 0: 61, partition 2: 39
```

Salting turns the key `taylor-swift` into `taylor-swift-0` ... `taylor-swift-N`. Each
salted key hashes to a partition, so the load spreads. Two things to notice:

- The spread is random, not even. With 8 salts, partition 2 got almost nothing
  because the keys happened to hash to partitions 0 and 1. More salts even it out.
- Ordering for that artist is gone. Its bookings now sit in several partitions
  and can be processed out of order.

Run `npm run lag` after a hot run to see the backlog per partition. These demos
leave unread messages behind. Skip them with
`npm run reset -- invoice-service --latest` (and the same for `email-service`).

## Idempotency for side effects (email)

The invoice handler writes to our own store, so "create invoice" and "remember
it" can be one atomic step. Sending an email is different: it happens in an
outside system. A crash can land between "email sent" and "recorded as sent".

```
kafka/services/email-service.js   local record, plus an idempotency key for the provider
```

The email service uses two layers:

1. A local record (`emails.log`) skips bookings it already handled.
2. The provider call carries an idempotency key (the `bookingId`). The provider
   ignores a second request with the same key.

`CRASH_ONCE=1` kills the service after the email is sent but before the local
record is written. Compare the two cases, with `rm -rf .data` between them.

```bash
CRASH_ONCE=1 npm run email                         # terminal 1, crashes once
npm run produce -- 2                               # terminal 2
npm run email                                      # terminal 1, restart
cat .data/emails-delivered.log                     # one line per booking
```

The restart log shows `provider ignored duplicate request, key booking-...`.
Now repeat it with `NO_IDEMPOTENCY_KEY=1` on both runs of the service:

```bash
CRASH_ONCE=1 NO_IDEMPOTENCY_KEY=1 npm run email
npm run produce -- 2
NO_IDEMPOTENCY_KEY=1 npm run email
cat .data/emails-delivered.log                     # one booking appears twice
```

The tenant gets two confirmation emails. This is the at-least-once gap: with no
key, nothing can tell the provider that the second request is a repeat.

Why not record first, then send? Then a crash between the two steps loses the
email forever (at-most-once). For a booking confirmation, a rare duplicate is
better than a missing email, so send first and use the key to protect against
the duplicate.

Note: the services share one Kafka and one `.data/` folder. If you run
experiments in several terminals at once, their messages and files mix.

## Cleanup

```bash
docker compose down       # stop and remove the container
docker compose down -v    # also wipe stored data/topics
```
