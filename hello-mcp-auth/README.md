# hello-mcp-auth

A minimal MCP server with one tool (`say_hello`) and real bearer-token
authentication. It is built to be **read**, not just run. Everything fits in
three small source files, each heavily commented.

It uses the **Streamable HTTP** transport, because that is the transport where
authentication actually lives. (Local `stdio` servers have no network auth; they
get secrets from environment variables.)

---

## What you will learn by reading it

1. How an MCP tool is defined and discovered (`tools/list` / `tools/call`).
2. How a server authenticates a caller with a JWT in the
   `Authorization: Bearer <token>` header.
3. Why that verification is **stateless**: it is a pure function of
   `(token, secret)`, with no session table.
4. The difference between **authentication** (who are you) and **authorization**
   (what may you do), shown with a token scope.

---

## The files, in the order worth reading

| File                | What it does                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/auth.ts`       | The whole auth story: pull the bearer token, verify it, attach the identity, or return 401. Start here. |
| `src/server.ts`     | The Express app, the MCP transport wiring, and the one `say_hello` tool.                                |
| `src/mint-token.ts` | Stands in for the OAuth server: signs tokens you can play with.                                         |
| `src/config.ts`     | One place for the secret, issuer, audience, and port.                                                   |

---

## Run it

```bash
# from this folder
yarn install        # already done if you are reading this
yarn dev            # starts on http://localhost:8765, restarts on change
```

No `.env` is needed: it runs on built-in defaults. To change the secret or port,
copy `.env.example` to `.env` and edit.

`tsx` runs the TypeScript directly, with no build step.

---

## Mint a token

The server rejects every request without a valid token, so mint one first:

```bash
yarn token                       # valid token, "hello" scope, 1h expiry
yarn token --name "Ada" --sub u-42   # custom identity
yarn token --scope ""            # valid token, but NO "hello" scope
yarn token --ttl 30              # expires in 30 seconds
yarn token --expired             # already expired
```

The token is printed to stdout. The human-readable summary goes to stderr, so you
can capture just the token with `TOKEN=$(yarn token 2>/dev/null | tail -1)`.

---

## Play with it via curl

The Streamable HTTP transport requires the `Accept` header to list **both**
`application/json` and `text/event-stream`.

```bash
TOKEN=$(yarn token 2>/dev/null | tail -1)

# 1. Discover the tools
curl -s http://localhost:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 2. Call the tool
curl -s http://localhost:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"say_hello","arguments":{"name":"World"}}}'

# 3. Watch auth fail: drop the header -> 401
curl -s -i http://localhost:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"say_hello","arguments":{"name":"World"}}}'
```

Things to try, and what you will see:

| Token        | Outcome                                                          |
| ------------ | ---------------------------------------------------------------- |
| valid        | `200`, a greeting that names you (read from the token)           |
| missing      | `401 missing_token`                                              |
| `--expired`  | `401 invalid_token` (server logs "token expired")                |
| tampered     | `401 invalid_token` (server logs "bad signature")                |
| `--scope ""` | `200`, but the tool returns an error: valid token, missing scope |

Watch the server terminal: every request logs `[auth] OK ...` or `[auth] FAIL ...`.

---

## Play with it inside Claude Code

```bash
# start the server first (yarn dev), then mint a token
TOKEN=$(yarn token 2>/dev/null | tail -1)

claude mcp add hello-auth http://localhost:8765/mcp \
  --transport http \
  --header "Authorization: Bearer $TOKEN"
```

Then, in a Claude Code session, ask it to use the `say_hello` tool. Remove it
later with `claude mcp remove hello-auth`. Note the token expires (1h by default),
so you will re-mint and re-add to see expiry handling.

---

## How this maps to real OAuth 2.1

This example deliberately takes one shortcut so it runs with zero setup: it signs
and verifies with a single **shared secret** (`HS256`). Here is what changes in a
real deployment, and where:

- **Who signs the token.** Here, `mint-token.ts` does. In production an
  **authorization server** (Auth0, Okta, Keycloak, your own) signs it after the
  user logs in, using a **private key** the MCP server never has.
- **How the server verifies.** Real setups use **asymmetric** signing (`RS256`).
  The server fetches the auth server's **public keys** from a **JWKS** URL and
  verifies offline. Swap `jwtVerify(token, SECRET, ...)` in `auth.ts` for
  `jose`'s `createRemoteJWKSet(new URL(".../jwks.json"))`. The rest is identical.
- **Where the token comes from.** A client (Claude Code, claude.ai) runs the
  OAuth 2.1 Authorization Code flow with PKCE, stores the result, and attaches
  `Authorization: Bearer <token>` on each request. We mint it by hand to skip
  that flow.
- **Refresh.** The access token here is short-lived. A real client also holds a
  long-lived **refresh token** and silently mints new access tokens. The MCP
  server never sees the refresh token.
- **The SDK has batteries.** The MCP SDK ships `requireBearerAuth` middleware and
  an `OAuthTokenVerifier` interface, plus a demo OAuth provider under
  `@modelcontextprotocol/sdk/.../examples/server/demoInMemoryOAuthProvider`. This
  example hand-rolls the middleware so the mechanism is visible; that is the
  idiomatic next step.

---

## A note on "stateless"

Two different kinds of state are easy to confuse:

- **Auth state.** There is none. The JWT is self-contained, so each request is
  verified independently. That is the whole point of JWT.
- **MCP session state.** This server runs in the SDK's **stateless** transport
  mode (`sessionIdGenerator: undefined`): a fresh server is created per request,
  no session is tracked. For richer flows (server-to-client streaming, sampling)
  you would switch to the **session** mode, which keeps a small `Mcp-Session-Id`
  map. That is orthogonal to auth: you can keep JWT verification stateless either
  way.
