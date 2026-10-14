// Local verification permits loopback bridges and Unix sockets only.
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_HIDE_BANNER = "true";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";

const net = require("node:net");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...input) {
  const args = Array.isArray(input[0]) ? input[0] : input;
  const options =
    typeof args[0] === "object"
      ? args[0]
      : {
          port: args[0],
          host: typeof args[1] === "string" ? args[1] : undefined,
        };
  const pipe =
    options.path || (typeof args[0] === "string" && !/^\d+$/.test(args[0]));
  const host = options.host ?? "localhost";
  if (!pipe && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`External network disabled in local verification: ${host}`);
  }
  return connect.apply(this, input);
};
