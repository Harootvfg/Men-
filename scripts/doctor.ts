// Runs one full production without the web UI and prints the result. Usage: npm run doctor -- "Thema"
import { createAndStart, waitFor } from "../src/lib/workflow/engine";
import { getProject, listEvents } from "../src/lib/store";
import { closeDb } from "../src/lib/db";

async function main() {
  const topic = process.argv[2];
  const p = await createAndStart(topic ? "custom" : "autopilot", { topic: topic || "", durationSec: 20 });
  await waitFor(p.id);
  const done = (await getProject(p.id))!;
  console.log("\nStatus:", done.status, "| Titel:", done.title);
  console.log("Render:", done.state.render);
  console.log("QA:", done.state.qa?.score, done.state.qa?.verdict, done.state.qa?.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.label} (${c.detail})`));
  if (done.status !== "completed") console.log("Fehler:", done.state.error, (await listEvents(p.id)).slice(0, 5));
  await closeDb();
}
main();
