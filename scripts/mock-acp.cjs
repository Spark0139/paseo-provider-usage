// Minimal local ACP peer for the demo's real, idle chat composer.
const { createInterface } = require("node:readline");
const input = createInterface({ input: process.stdin });
input.on("line", line => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  const send = value => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...value }) + "\n");
  if (method === "initialize") {
    send({ result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "Demo", version: "1.0.0" } } });
  } else if (method === "session/new") {
    send({ result: { sessionId: "demo-session" } });
  } else if (method === "session/close") {
    send({ result: {} });
  } else {
    send({ error: { code: -32601, message: "Unsupported by the quota demo." } });
  }
});
