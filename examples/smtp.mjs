import { VLoggo } from "vloggo";

// Load SMTP variables into process.env before creating this logger.
const logger = new VLoggo({
  client: "Payments",
  notify: true,
  throttle: 300_000,
  notificationTimeout: 10_000,
  retryDelay: 1_000,
});

try {
  await runPaymentJob();
} catch (error) {
  await logger.fatal("PAYMENT_JOB_FAILED", "Payment job failed", {
    error,
    jobId: "job-314",
  });
} finally {
  await logger.close({ timeout: 10_000 });
}

async function runPaymentJob() {
  logger.info("PAYMENT_JOB_STARTED", "Payment job started", { jobId: "job-314" });
  throw new Error("Example failure; replace runPaymentJob with application code");
}
