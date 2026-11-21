import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const file = process.argv[2];
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!file) throw new Error("Usage: npm run db:restore -- backups/file.dump");

await new Promise((resolve, reject) => {
  const child = spawn("pg_restore", ["--clean", "--if-exists", "--dbname", databaseUrl, file], {
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_restore exited with ${code}`)));
});

console.log("Database restore completed");
