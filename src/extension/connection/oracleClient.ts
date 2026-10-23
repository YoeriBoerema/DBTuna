import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { once } from "node:events";
import oracledb from "oracledb";
import type { Connection, ConnectionAttributes } from "oracledb";
import {
  DATABASE_TIMEOUTS,
  PLAN_LIMITS,
} from "../../../packages/plan-core/src/limits";
import {
  OracleAdapter,
  type OracleEnvelope,
} from "../../../packages/adapter-oracle/src/oracleAdapter";
import { oracleKind, validateOracle } from "../sql/oracleSelection";
import type { Profile } from "./profile";

export type OracleConnection = Pick<
  Connection,
  | "execute"
  | "close"
  | "break"
  | "rollback"
  | "commit"
  | "callTimeout"
  | "currentSchema"
  | "oracleServerVersionString"
>;
export type OracleDriver = {
  getConnection(config: ConnectionAttributes): Promise<OracleConnection>;
};
const driver: OracleDriver = oracledb;
const columns =
  "ID, PARENT_ID, POSITION, DEPTH, OPERATION, OPTIONS, OBJECT_OWNER, OBJECT_NAME, OBJECT_ALIAS, OBJECT_TYPE, COST, CARDINALITY, BYTES, CPU_COST, IO_COST, TEMP_SPACE, ACCESS_PREDICATES, FILTER_PREDICATES, PARTITION_START, PARTITION_STOP, DISTRIBUTION, OTHER_TAG, DBMS_LOB.SUBSTR(OTHER_XML, 4000, 1) AS OTHER_XML, CASE WHEN DBMS_LOB.INSTR(OTHER_XML, 'adaptive_plan') > 0 THEN 1 ELSE 0 END AS DBTUNA_ADAPTIVE";
const runtimeColumns =
  "LAST_STARTS, LAST_OUTPUT_ROWS, LAST_ELAPSED_TIME, LAST_CR_BUFFER_GETS, LAST_CU_BUFFER_GETS, LAST_DISK_READS, LAST_DISK_WRITES, LAST_EXECUTION, LAST_TEMPSEG_SIZE, LAST_DEGREE";

export function oracleConfig(
  profile: Profile,
  password?: string,
): ConnectionAttributes {
  if (profile.type !== "oracle") throw Error("Expected an Oracle connection.");
  // This wizard offers Easy Connect service names only, not arbitrary descriptors.
  // Restrict its components so they cannot inject descriptor/security options.
  if (
    !/^[A-Za-z0-9._:[\]-]+$/.test(profile.host) ||
    !/^[A-Za-z0-9._-]+$/.test(profile.database)
  )
    throw Error(
      "Use an Oracle host and service name, not a SID or connect descriptor.",
    );
  const host =
    profile.host.includes(":") && !profile.host.startsWith("[")
      ? `[${profile.host}]`
      : profile.host;
  return {
    user: profile.user,
    password,
    connectString: `${profile.ssl === "verify" ? "tcps" : "tcp"}://${host}:${profile.port}/${profile.database}?connect_timeout=5&transport_connect_timeout=5&retry_count=0`,
    sslServerDNMatch: true,
    ...(profile.walletLocation
      ? { walletLocation: profile.walletLocation }
      : {}),
  };
}

// Cleanup must be bounded even after a failed transport. A timed-out connection
// is never pooled or reused. Observe late rejections without retrying any SQL.
async function cleanup(action: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.resolve()
      .then(action)
      .catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DATABASE_TIMEOUTS.cancelMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

export async function withOracle<T>(
  profile: Profile,
  password: string | undefined,
  action: (connection: OracleConnection, check: () => void) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs: number = DATABASE_TIMEOUTS.estimateStatementMs,
  transport: OracleDriver = driver,
): Promise<T> {
  if (signal?.aborted)
    throw Error("Oracle operation cancelled before connecting.");
  let connection: OracleConnection | undefined,
    expired = false;
  let rejectStop: (error: Error) => void = () => {};
  let cancellationDeadline: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  // A driver that cannot finish cancellation must not retain the UI indefinitely.
  // Late operations still check the expired flag before collecting or committing.
  void stopped.catch(() => {});
  let breaking: Promise<void> | undefined;
  const stop = () => {
    if (expired) return;
    expired = true;
    if (connection) breaking = cleanup(() => connection!.break());
    cancellationDeadline = setTimeout(
      () =>
        rejectStop(
          Error(
            signal?.aborted
              ? "Oracle operation cancelled. INSERT outcomes may be uncertain if a commit was in progress."
              : "Oracle operation exceeded its overall deadline. INSERT outcomes may be uncertain if a commit was in progress.",
          ),
        ),
      DATABASE_TIMEOUTS.cancelMs,
    );
  };
  const timer = setTimeout(stop, timeoutMs);
  signal?.addEventListener("abort", stop, { once: true });
  const check = () => {
    if (expired || signal?.aborted)
      throw Error(
        signal?.aborted
          ? "Oracle operation cancelled."
          : "Oracle operation exceeded its overall deadline.",
      );
  };
  try {
    const connecting = transport.getConnection(oracleConfig(profile, password));
    void connecting.then(
      (late) => {
        if (expired && !connection) void cleanup(() => late.close());
      },
      () => {},
    );
    connection = await Promise.race([connecting, stopped]);
    connection.callTimeout = Math.min(
      timeoutMs,
      DATABASE_TIMEOUTS.estimateStatementMs,
    );
    check();
    if (profile.type === "oracle" && profile.currentSchema)
      connection.currentSchema = profile.currentSchema;
    const result = await Promise.race([action(connection, check), stopped]);
    check();
    return result;
  } finally {
    clearTimeout(timer);
    if (cancellationDeadline) clearTimeout(cancellationDeadline);
    signal?.removeEventListener("abort", stop);
    if (connection) {
      if (breaking) await breaking;
      await cleanup(() => connection!.rollback());
      await cleanup(() => connection!.close());
    }
  }
}

async function rows(
  connection: OracleConnection,
  sql: string,
  binds: Record<string, string | number> = {},
) {
  const result = await connection.execute<Record<string, unknown>>(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    maxRows: PLAN_LIMITS.operators + 1,
    autoCommit: false,
  });
  const value = result.rows || [];
  if (value.length > PLAN_LIMITS.operators)
    throw Error("Oracle plan exceeds 1000 operators.");
  return value;
}

// LOB contents and nested cursor rows are not query-plan data. Release their
// resources without materializing potentially unbounded business result data.
async function discard(value: unknown): Promise<void> {
  if (value instanceof Readable) {
    if (!value.closed) {
      const closed = once(value, "close");
      value.destroy();
      await closed;
    }
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    "getRows" in value &&
    "close" in value &&
    typeof value.close === "function"
  ) {
    await value.close();
    return;
  }
  if (Array.isArray(value)) for (const item of value) await discard(item);
}

export async function testOracle(profile: Profile, password?: string) {
  await withOracle(profile, password, async (connection) => {
    await rows(connection, "SELECT 1 FROM dual");
  });
}

export async function collectOraclePlan(
  profile: Profile,
  password: string | undefined,
  input: string,
  actual: boolean,
  signal?: AbortSignal,
  transport: OracleDriver = driver,
) {
  const sql = validateOracle(input),
    kind = oracleKind(sql);
  return withOracle(
    profile,
    password,
    async (connection, check) => {
      const token = randomBytes(12).toString("hex");
      let phase:
        "planning" | "executing" | "collecting" | "committing" | "committed" =
        "planning";
      try {
        let planRows: Record<string, unknown>[];
        if (!actual) {
          await connection.execute(
            `EXPLAIN PLAN SET STATEMENT_ID = '${token}' FOR ${sql}`,
            {},
            { autoCommit: false },
          );
          check();
          planRows = await rows(
            connection,
            `SELECT ${columns} FROM PLAN_TABLE WHERE STATEMENT_ID = :statementId ORDER BY ID`,
            { statementId: token },
          );
        } else {
          // Check diagnostic privileges before any business SQL is executed.
          await rows(
            connection,
            "SELECT SQL_ID, CHILD_NUMBER FROM V$SQL WHERE 1 = 0",
          );
          await rows(
            connection,
            "SELECT ID FROM V$SQL_PLAN_STATISTICS_ALL WHERE 1 = 0",
          );
          await connection.execute("ALTER SESSION SET STATISTICS_LEVEL = ALL");
          check();
          const prefix = `/* DBTuna_${token} */ `;
          phase = "executing";
          const result = await connection.execute<unknown[]>(
            prefix + sql,
            {},
            {
              resultSet: kind === "SELECT",
              autoCommit: false,
              outFormat: oracledb.OUT_FORMAT_ARRAY,
              fetchArraySize: 128,
              prefetchRows: 128,
            },
          );
          try {
            if (kind === "SELECT") {
              if (!result.resultSet)
                throw Error("Oracle SELECT did not return a result set.");
              for (;;) {
                check();
                const chunk = await result.resultSet.getRows(128);
                for (const row of chunk) await discard(row);
                if (!chunk.length) break;
              }
            }
          } finally {
            if (result.resultSet) await result.resultSet.close();
          }
          check();
          phase = "collecting";
          // A unique execution tag excludes shared LAST_* counters from other runs.
          // V$ views are local to this dedicated connection's instance/container.
          const cursors = await rows(
            connection,
            "SELECT SQL_ID, CHILD_NUMBER FROM V$SQL WHERE SUBSTR(SQL_TEXT, 1, :prefixLength) = :prefix AND EXECUTIONS > 0",
            { prefix, prefixLength: prefix.length },
          );
          if (
            cursors.length !== 1 ||
            typeof cursors[0].SQL_ID !== "string" ||
            typeof cursors[0].CHILD_NUMBER !== "number"
          )
            throw Error(
              "Could not identify exactly one Oracle execution cursor; no actual plan was selected.",
            );
          planRows = await rows(
            connection,
            `SELECT ${columns}, ${runtimeColumns} FROM V$SQL_PLAN_STATISTICS_ALL WHERE SQL_ID = :sqlId AND CHILD_NUMBER = :childNumber ORDER BY ID`,
            { sqlId: cursors[0].SQL_ID, childNumber: cursors[0].CHILD_NUMBER },
          );
        }
        check();
        const raw: OracleEnvelope = {
          kind: "dbtuna-oracle-native",
          nativeVersion: 1,
          query: sql,
          version: connection.oracleServerVersionString,
          planKind: actual ? "actual" : "estimated",
          statementType: kind,
          rows: planRows,
        };
        // Parse and validate before committing INSERT, so malformed/missing plan
        // data is a rollback outcome rather than a committed-but-unusable result.
        new OracleAdapter().parse(raw);
        check();
        if (actual && kind === "INSERT") {
          phase = "committing";
          await connection.commit();
          phase = "committed";
          check();
        }
        return { raw, version: connection.oracleServerVersionString };
      } catch (error) {
        const code =
          error && typeof error === "object" && "errorNum" in error
            ? error.errorNum
            : undefined;
        const reason =
          code === 942 || code === 1031
            ? "Oracle privileges or PLAN_TABLE are missing. Estimated plans require PLAN_TABLE; actual plans require V$SQL, V$SQL_PLAN_STATISTICS_ALL and session statistics instrumentation. See Oracle setup documentation."
            : signal?.aborted
              ? "Oracle operation cancelled."
              : phase === "planning"
                ? "Oracle could not compile or collect this plan. Check SQL syntax, object names, service/schema and plan permissions."
                : "Oracle execution or runtime-plan collection failed. Check SQL validity, diagnostic privileges and runtime statistics.";
        const outcome =
          phase === "committing"
            ? " INSERT commit outcome is uncertain; check the database before retrying."
            : phase === "committed"
              ? " INSERT was committed."
              : actual && kind === "INSERT" && phase !== "planning"
                ? " INSERT was not committed by DBTuna; connection cleanup attempts rollback. Autonomous trigger/function effects may persist."
                : "";
        // Native errors can echo SQL and bind values; keep them out of UI/logs.
        throw Error(
          reason +
            (typeof code === "number"
              ? ` (ORA-${String(code).padStart(5, "0")})`
              : "") +
            outcome,
        );
      }
    },
    signal,
    actual
      ? DATABASE_TIMEOUTS.actualStatementMs
      : DATABASE_TIMEOUTS.estimateStatementMs,
    transport,
  );
}
