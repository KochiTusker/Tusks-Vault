import { startServer } from "./src/server/index";

startServer().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
