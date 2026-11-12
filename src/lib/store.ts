import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { dataDir } from "./config";
import type { Project, ProjectState, Status } from "./schemas";

type Row = { id: string; mode: string; title: string; status: string; cancel_requested: boolean; state: ProjectState | string; created_at: Date | string; updated_at: Date | string };
const json = <T,>(v: T | string): T => (typeof v === "string" ? JSON.parse(v) : v);
const iso = (d: Date | string) => new Date(d).toISOString();
const toProject = (r: Row): Project => ({
  id: r.id, mode: r.mode as Project["mode"], title: r.title, status: r.status as Status, cancelRequested: r.cancel_requested,
  state: json(r.state), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

export async function createProject(mode: Project["mode"], title: string, state: ProjectState): Promise<Project> {
  const db = await getDb();
  const id = crypto.randomBytes(6).toString("hex");
  await db.query("INSERT INTO projects(id, mode, title, status, state) VALUES ($1,$2,$3,'created',$4)", [id, mode, title, JSON.stringify(state)]);
  return (await getProject(id))!;
}
export async function getProject(id: string): Promise<Project | null> {
  const rows = await (await getDb()).query<Row>("SELECT * FROM projects WHERE id=$1", [id]);
  return rows[0] ? toProject(rows[0]) : null;
}
export async function listProjects(): Promise<Project[]> {
  return (await (await getDb()).query<Row>("SELECT * FROM projects ORDER BY created_at DESC LIMIT 200")).map(toProject);
}
export async function saveProject(p: Pick<Project, "id" | "title" | "status" | "state">) {
  await (await getDb()).query("UPDATE projects SET title=$2, status=$3, state=$4, updated_at=now() WHERE id=$1", [p.id, p.title, p.status, JSON.stringify(p.state)]);
}
export async function setCancel(id: string, v: boolean) {
  await (await getDb()).query("UPDATE projects SET cancel_requested=$2 WHERE id=$1", [id, v]);
}
export async function isCancelRequested(id: string) {
  const r = await (await getDb()).query<{ cancel_requested: boolean }>("SELECT cancel_requested FROM projects WHERE id=$1", [id]);
  return !r[0] || r[0].cancel_requested;
}
export async function deleteProject(id: string) {
  await (await getDb()).query("DELETE FROM projects WHERE id=$1", [id]);
  fs.rmSync(path.join(dataDir(), "projects", id), { recursive: true, force: true });
}

export interface EventRow { id: number; ts: string; level: string; step: string; message: string }
export async function logEvent(projectId: string, level: "info" | "warn" | "error", step: string, message: string, data?: unknown) {
  // Structured log line for operators plus a persisted event for the UI.
  console.log(JSON.stringify({ t: new Date().toISOString(), level, project: projectId, step, message }));
  await (await getDb()).query("INSERT INTO events(project_id, level, step, message, data) VALUES ($1,$2,$3,$4,$5)", [projectId, level, step, message.slice(0, 2000), data ? JSON.stringify(data) : null]);
}
export async function listEvents(projectId: string): Promise<EventRow[]> {
  const rows = await (await getDb()).query<{ id: number; ts: Date; level: string; step: string; message: string }>("SELECT id, ts, level, step, message FROM events WHERE project_id=$1 ORDER BY id DESC LIMIT 80", [projectId]);
  return rows.map((r) => ({ ...r, ts: iso(r.ts) }));
}

export async function addCost(projectId: string | null, provider: string, kind: string, amountUsd: number, detail = "") {
  await (await getDb()).query("INSERT INTO costs(project_id, provider, kind, amount_usd, detail) VALUES ($1,$2,$3,$4,$5)", [projectId, provider, kind, amountUsd, detail]);
}
export async function projectCost(projectId: string): Promise<{ total: number; lines: { provider: string; kind: string; usd: number }[] }> {
  const rows = await (await getDb()).query<{ provider: string; kind: string; usd: number }>("SELECT provider, kind, SUM(amount_usd)::float8 AS usd FROM costs WHERE project_id=$1 GROUP BY provider, kind ORDER BY provider", [projectId]);
  return { total: rows.reduce((a, r) => a + Number(r.usd), 0), lines: rows.map((r) => ({ ...r, usd: Number(r.usd) })) };
}
export async function totalCost(sinceDays = 30): Promise<number> {
  const rows = await (await getDb()).query<{ usd: number | null }>(`SELECT SUM(amount_usd)::float8 AS usd FROM costs WHERE ts > now() - interval '${Math.floor(sinceDays)} days'`);
  return Number(rows[0]?.usd || 0);
}
