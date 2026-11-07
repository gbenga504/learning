# Redis examples

Minimal, runnable setup for learning Redis basics: Redis via Docker, plus small
Node.js scripts using the official [node-redis](https://github.com/redis/node-redis) client.

```
cache.js, pubsub-publisher.js, pubsub-subscriber.js
```

## Setup

```bash
docker compose up -d   # starts Redis on localhost:6379
npm install
```

Check it is healthy:

```bash
docker compose ps
docker compose logs -f redis
```

## 1. Caching (`cache.js`)

The most common Redis use case: keep an expensive value (a DB row, an API call)
in memory for a while so repeat reads are fast, using `SET ... EX <seconds>` for
a time-to-live and `GET` to read it back.

```bash
npm run cache            # first run: cache miss, "fetches" from source
npm run cache            # run again within 30s: cache hit, instant
npm run cache -- 99      # different key (user:99): cache miss again
```

## 2. Pub/Sub (`pubsub-publisher.js`, `pubsub-subscriber.js`)

Redis can also broadcast messages to whoever is listening right now:

- **No persistence**: a message is only delivered to clients subscribed at the
  moment it is published. A late or offline subscriber has missed it for good.
- **No consumer groups**: every subscriber to a channel gets every message.

Start a subscriber (prints anything published to the `notifications` channel):

```bash
npm run sub
```

In another terminal, publish a message:

```bash
npm run pub
npm run pub -- "a custom message"
```

Things to try:

- Publish while no subscriber is running: the message just disappears.
- Open two subscriber terminals and publish once: both receive it.

## Cleanup

```bash
docker compose down
```
