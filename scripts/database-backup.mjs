import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

await mkdir("backups", { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = `backups/playpulse-${timestamp}.dump`;

await new Promise((resolve, reject) => {
  const child = spawn("pg_dump", ["--format=custom", "--dbname", databaseUrl, "--file", file], {
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}`)));
});

console.log(`Database backup created: ${file}`);
