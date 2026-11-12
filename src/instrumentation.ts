export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { resumeInterrupted } = await import("./lib/workflow/engine");
    resumeInterrupted().catch((e) => console.error("resume failed", e));
  }
}
