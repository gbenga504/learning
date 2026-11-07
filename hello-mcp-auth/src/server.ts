// A minimal MCP server over Streamable HTTP, protected by bearer-token auth.
//
// Shape of the request flow for a tool call:
//
//   client --POST /mcp--> [express.json] -> [requireBearerToken] -> [MCP transport]
//                                                  |                       |
//                                          verifies the JWT         runs say_hello
//
// We run "stateless": every POST spins up a fresh McpServer + transport, handles
// the one request, and tears them down. No session store. This is the simplest
// faithful model of "JWT verified on each request, no server-side state".

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { type AuthInfo, requireBearerToken } from "./auth.js";
import { PORT } from "./config.js";

// Build a one-shot MCP server that knows WHO is calling. We pass the verified
// identity in so the tool can use it. In a multi-tool server you would register
// all tools here.
function createMcpServer(auth: AuthInfo): McpServer {
  const server = new McpServer({ name: "hello-mcp-auth", version: "1.0.0" });

  // The input schema is a Zod shape. The SDK validates the arguments against it
  // before our handler runs, and exposes it to the client for discovery.
  const inputSchema: ZodRawShape = {
    name: z.string().min(1).describe("The name to greet"),
  };

  // One bit of type plumbing, isolated here and explained:
  // server.registerTool has an enormous generic signature (it accepts both Zod v3
  // and v4 schemas). On this toolchain that makes tsc bail out with "Type
  // instantiation is excessively deep". We register through a minimal hand-written
  // signature instead. This is purely a compile-time concern: at runtime it calls
  // the exact same method, and we still get a typed `name` argument.
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: ZodRawShape },
    handler: (args: {
      name: string;
    }) => CallToolResult | Promise<CallToolResult>,
  ) => void;

  registerTool(
    "say_hello",
    {
      title: "Say Hello",
      description: "Returns a friendly greeting for the given name.",
      inputSchema,
    },
    async ({ name }) => {
      // AUTHORIZATION (separate from authentication): the token was valid, but
      // does it grant permission to use this tool? We require a "hello" scope.
      // Mint a token without it (yarn token --scope "") to see this path.
      if (!auth.scopes.includes("hello")) {
        return {
          isError: false,
          content: [
            {
              type: "text",
              text:
                `Your token is valid (you are '${auth.subject}'), but it is missing the ` +
                `required "hello" scope. Authentication answered "who are you"; this is ` +
                `authorization answering "what may you do".`,
            },
          ],
        };
      }

      const who = auth.name ? `${auth.name} (${auth.subject})` : auth.subject;
      return {
        content: [
          {
            type: "text",
            text:
              `Hello, ${name}! 👋\n` +
              `This greeting came from the hello-mcp-auth server.\n` +
              `It knows who called because your bearer token verified as: ${who}.\n` +
              `Token scopes: ${auth.scopes.join(", ") || "(none)"}.`,
          },
        ],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json());

// --- Public routes (no token needed) -------------------------------------

// A browser-friendly description so hitting the server in a browser explains itself.
app.get("/", (_req, res) => {
  res
    .type("text")
    .send(
      [
        "hello-mcp-auth: a tiny MCP server with bearer-token auth.",
        "",
        "  GET  /health   -> liveness check (no auth)",
        "  POST /mcp       -> MCP endpoint (requires 'Authorization: Bearer <token>')",
        "",
        "Mint a token with:  yarn token",
        "See README.md to wire it into Claude Code.",
      ].join("\n"),
    );
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// --- Protected MCP route --------------------------------------------------

// requireBearerToken runs FIRST. If the token is bad, the MCP transport is never
// even reached and the client gets a 401.
app.post("/mcp", requireBearerToken, async (req: Request, res: Response) => {
  const server = createMcpServer(req.mcpAuth!);

  // sessionIdGenerator: undefined  -> stateless mode (no session tracking).
  // enableJsonResponse: true       -> reply with plain JSON, not an SSE stream,
  //                                   which is far easier to read with curl.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Tear everything down when the response closes. Nothing persists between requests.
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// In stateless mode there is no long-lived stream to GET and no session to DELETE.
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({
    error: "method_not_allowed",
    error_description: "This server is stateless; use POST /mcp.",
  });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`hello-mcp-auth listening on http://localhost:${PORT}`);
  console.log(
    `  MCP endpoint: POST http://localhost:${PORT}/mcp  (bearer token required)`,
  );
  console.log(`  Mint a token: yarn token`);

  console.log("This is going to be superfulios");
});
