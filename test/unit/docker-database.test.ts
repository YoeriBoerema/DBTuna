import { test } from "node:test";
import assert from "node:assert/strict";
const load = () =>
  import(new URL("../helpers/dockerDatabase.mjs", import.meta.url).href);
const config = {
  engine: "sqlserver",
  image: "test@sha256:" + "a".repeat(64),
  port: 55440,
  containerPort: 1433,
  environment: { MSSQL_SA_PASSWORD: "test-secret" },
  ready: () => true,
};
function fake(
  options: {
    startFails?: boolean;
    stopped?: boolean;
    wrongOwner?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  const labels: Record<string, string> = {};
  const command = (args: string[]) => {
    calls.push(args);
    if (args[0] === "create")
      for (let i = 0; i < args.length; i++)
        if (args[i] === "--label") {
          const [key, value] = args[i + 1].split("=");
          labels[key] = value;
        }
    if (args[0] === "start" && options.startFails)
      throw Error("Port already bound");
    if (args[0] === "inspect" && args[2].includes(".State"))
      return JSON.stringify({ Running: !options.stopped });
    if (args[0] === "inspect")
      return JSON.stringify(options.wrongOwner ? {} : labels);
    return "container-id";
  };
  return { command, calls };
}
test("Docker database runner binds localhost, hides passwords in args and removes owned data", async () => {
  const { withDockerDatabase } = await load();
  for (const engine of ["postgresql", "sqlserver", "oracle"]) {
    const { command, calls } = fake();
    assert.equal(
      await withDockerDatabase(
        { ...config, engine },
        async () => "passed",
        command,
      ),
      "passed",
    );
    const create = calls.find((args) => args[0] === "create")!;
    assert.ok(create.includes("127.0.0.1:55440:1433"));
    assert.ok(create.includes("MSSQL_SA_PASSWORD"));
    assert.ok(!create.includes("test-secret"));
    assert.ok(!create.includes("--volume"));
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ["rm", "--force", "--volumes"]);
  }
});
test("Docker database runner cleans up after suite, startup and readiness failures", async () => {
  const { withDockerDatabase } = await load();
  for (const options of [{}, { startFails: true }, { stopped: true }]) {
    const { command, calls } = fake(options);
    await assert.rejects(
      withDockerDatabase(
        config,
        async () => {
          throw Error("Suite failed");
        },
        command,
      ),
    );
    assert.equal(calls.filter((args) => args[0] === "rm").length, 1);
  }
});
test("Docker database runner refuses to remove an unowned container or use floating image tags", async () => {
  const { withDockerDatabase } = await load(),
    { command, calls } = fake({ wrongOwner: true });
  await assert.rejects(
    withDockerDatabase(config, async () => {}, command),
    /ownership/,
  );
  assert.ok(!calls.some((args) => args[0] === "rm"));
  await assert.rejects(
    withDockerDatabase(
      { ...config, image: "test:latest" },
      async () => {},
      command,
    ),
    /pinned/,
  );
});
