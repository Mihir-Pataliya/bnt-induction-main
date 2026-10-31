import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
console.log("root", root);
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 5203 }
});
console.log("created");
await server.listen();
console.log("listening");
await server.close();
console.log("closed");
