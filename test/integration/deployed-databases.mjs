import { fileURLToPath } from "node:url";
import { manageDatabases } from "../helpers/deployedDatabases.mjs";
const path = fileURLToPath(
  new URL("../../work/test-databases.json", import.meta.url),
);
try {
  await manageDatabases(process.argv[2], path);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
