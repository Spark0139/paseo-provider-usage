// Paseo evaluates the server bundle without an installation directory.
// Keep the launcher self-contained so it can run via Node -e.
function launchClaude(load, parseClaudeWindows) {
  const {spawn} = load("node:child_process");
  const {createConnection} = load("node:net");
  const {createHash} = load("node:crypto");

  const [path, prefixLength, prefixDigest, command, ...args] = process.argv.slice(1);
  if (!command) {
    process.stderr.write("A session executable is required.\n");
    process.exit(2);
  }

  // Paseo applies this prefix to all its session launches. The Claude Agent SDK
  // prepends this exact stream-json sequence, and Paseo sets the session-state flag
  // on the harness environment. A command override gives us an additional match.
  const sdkStart = args.findIndex((arg, i) => arg === "--output-format" &&
    args[i + 1] === "stream-json" && args[i + 2] === "--verbose" &&
    args[i + 3] === "--input-format" && args[i + 4] === "stream-json");
  const prefixMatches = !prefixDigest || (
    sdkStart === Number(prefixLength) - 1 &&
    createHash("sha256").update(JSON.stringify([command, ...args.slice(0, sdkStart)])).digest("hex") === prefixDigest
  );
  const endpoint = process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS === "1" && sdkStart !== -1 && prefixMatches ? path : undefined;

  // stdin and stderr use the original file descriptors, including during startup.
  const child = spawn(command, args, {stdio: ["inherit", endpoint ? "pipe" : "inherit", "inherit"]});
  if (endpoint) {
    child.once("spawn", () => sendObservation(endpoint, "launcher-connected"));
    child.stdout.pipe(process.stdout, {end: false});
    observeLines(child.stdout, line => {
      // Large tool results and messages are common. Only decode candidate lines.
      if (!line.includes('"rate_limit_event"')) return;
      let event;
      try {
        event = JSON.parse(line.toString("utf8"));
      } catch {
        return;
      }
      const windows = parseClaudeWindows(event);
      if (windows.length) sendObservation(endpoint, windows);
    });
    // The SDK may have gone away while the harness is completing a write.
    process.stdout.on("error", () => child.kill("SIGTERM"));
  }

  const signals = ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"];
  const forward = signal => child.kill(signal);
  for (const signal of signals) process.on(signal, forward);

  child.once("error", error => {
    // Never print the provider's command arguments or environment.
    process.stderr.write("Could not start wrapped session executable.\n");
    process.exitCode = error.code === "ENOENT" ? 127 : 126;
  });
  child.once("close", (code, signal) => {
    for (const name of signals) process.off(name, forward);
    if (signal) {
      const exitBySignal = () => process.kill(process.pid, signal);
      // A pipe may still have bytes queued in the parent. Mirror termination
      // after forwarding them, exactly as for a normal child exit.
      if (endpoint && !process.stdout.destroyed) process.stdout.write("", exitBySignal);
      else exitBySignal();
    } else if (process.exitCode === undefined) {
      process.exitCode = code ?? 1;
    }
  });

  function sendObservation(path, message) {
    let socket;
    try { socket = createConnection({path}); } catch { return; }
    if (message === "launcher-connected") socket.unref();
    socket.setTimeout(250, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.once("connect", () => socket.end(JSON.stringify(message)));
  }

  function observeLines(stream, consume) {
    const limit = 64 * 1024;
    let parts = [];
    let size = 0;
    let oversized = false;
    stream.on("data", chunk => {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const part = chunk.subarray(offset, newline === -1 ? chunk.length : newline);
        size += part.length;
        if (size > limit) {
          oversized = true;
          parts = [];
        } else if (!oversized) {
          parts.push(part);
        }
        if (newline === -1) break;
        if (!oversized) consume(Buffer.concat(parts, size));
        parts = [];
        size = 0;
        oversized = false;
        offset = newline + 1;
      }
    });
  }
}

module.exports = { launchClaude };
