// Mints a signed JWT you can hand to an MCP client.
//
// In production you would NEVER do this yourself: the authorization server (Auth0,
// Okta, your own OAuth server) signs tokens after a login flow, using a private key
// you do not have. This script plays the role of that server so you can experiment.
// Because it signs with the SAME secret the server verifies with (see config.ts),
// the server will accept what it produces.
//
// Usage:
//   yarn token                          # a valid token, scope "hello", 1h expiry
//   yarn token --name "Ada" --sub u-42  # custom identity
//   yarn token --scope ""               # valid token but NO "hello" scope (tool returns 403-style error)
//   yarn token --ttl 30                 # expires in 30 seconds (watch it go stale)
//   yarn token --expired                # already-expired token (server returns 401)

import { SignJWT } from "jose";
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET_BYTES } from "./config.js";

// Tiny flag parser: turns ["--name", "Ada", "--expired"] into { name: "Ada", expired: true }.
function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true; // boolean flag, e.g. --expired
    } else {
      flags[key] = next; // value flag, e.g. --name Ada
      i++;
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const subject = (flags.sub as string) ?? "user-123";
  const name = (flags.name as string) ?? "Gbenga";
  // Default to the "hello" scope so the happy path works. Pass --scope "" to drop it.
  const scope = flags.scope !== undefined ? String(flags.scope) : "hello";
  const ttlSeconds = flags.ttl ? Number(flags.ttl) : 3600;

  const now = Math.floor(Date.now() / 1000);
  const exp = flags.expired ? now - 60 : now + ttlSeconds;

  const token = await new SignJWT({ name, scope })
    .setProtectedHeader({ alg: "HS256" }) // HMAC with the shared secret
    .setSubject(subject)
    .setIssuer(JWT_ISSUER) // must match what the server expects
    .setAudience(JWT_AUDIENCE) // must match what the server expects
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(JWT_SECRET_BYTES);

  const status = flags.expired ? "ALREADY EXPIRED" : `valid for ${ttlSeconds}s`;
  // Human-readable summary on stderr, the bare token on stdout (so it pipes cleanly).
  console.error(`# subject=${subject} name=${name} scope="${scope}" (${status})`);
  console.error(`# Authorization: Bearer <token>`);
  console.log(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
