import { buildApp } from "./app.js";
import { startExpiryCron } from "./services/expiry.js";

async function main() {
  const app = await buildApp();
  const port = app.config.PORT;
  try {
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info({ port }, `LSPS API listening`);
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }

  const stopCron = startExpiryCron(app);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    try {
      stopCron();
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
