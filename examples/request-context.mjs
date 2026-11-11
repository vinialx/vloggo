import { VLoggo } from "vloggo";

const logger = new VLoggo({ client: "HTTPService", notify: false });

export async function handleRequest(request) {
  const requestLogger = logger.child({
    requestId: request.id,
    userId: request.user?.id,
  });

  requestLogger.info("HTTP_START", "Request received", {
    method: request.method,
    path: request.url,
  });

  try {
    return await processRequest(request);
  } catch (error) {
    requestLogger.error("HTTP_FAILED", "Request failed", { error });
    throw error;
  }
}

async function processRequest(request) {
  return { accepted: true, requestId: request.id };
}

// The application owns shutdown and closes the parent logger once.
process.once("SIGTERM", async () => {
  await logger.close();
  process.exit(0);
});
