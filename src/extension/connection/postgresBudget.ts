import { Transform, type Duplex, type TransformCallback } from "node:stream";
import type { Client } from "pg";
import { PLAN_LIMITS } from "../../../packages/plan-core/src/limits";
import { UserFacingError } from "../../../packages/plan-core/src/errors";

// Bound the entire dedicated session, including authentication and diagnostic
// messages. Protocol overhead is separate from the 5 MiB decoded plan limit.
export const POSTGRES_WIRE_BYTES = PLAN_LIMITS.bytes + 64 * 1024;

export class PostgresResponseBudget extends Transform {
  private received = 0;
  private header = Buffer.alloc(5);
  private headerBytes = 0;
  private remaining = 0;
  constructor(private limit = POSTGRES_WIRE_BYTES) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    try {
      this.received += chunk.length;
      if (this.received > this.limit)
        throw new UserFacingError(
          "PostgreSQL response exceeds the 5 MiB plan budget.",
        );
      let offset = 0;
      while (offset < chunk.length) {
        if (this.remaining) {
          const size = Math.min(this.remaining, chunk.length - offset);
          offset += size;
          this.remaining -= size;
        } else {
          const size = Math.min(5 - this.headerBytes, chunk.length - offset);
          chunk.copy(this.header, this.headerBytes, offset, offset + size);
          offset += size;
          this.headerBytes += size;
          if (this.headerBytes === 5) {
            const length = this.header.readUInt32BE(1);
            if (length < 4 || length + 1 > this.limit)
              throw new UserFacingError(
                "PostgreSQL response frame exceeds the plan budget or is invalid.",
              );
            this.remaining = length - 4;
            this.headerBytes = 0;
          }
        }
      }
      callback(null, chunk);
    } catch (error) {
      callback(error as Error);
    }
  }
}

export function protectPostgresResponses(client: Client): void {
  // pg 8's connection attaches its parser here for both plaintext and decrypted
  // TLS streams. Keep this narrow adapter covered by real-driver protocol tests.
  const connection = client.connection as typeof client.connection & {
    attachListeners(stream: Duplex): void;
  };
  const attach = connection.attachListeners.bind(connection);
  connection.attachListeners = (stream) => {
    const budget = new PostgresResponseBudget();
    budget.on("error", (error) => stream.destroy(error));
    attach(budget);
    stream.pipe(budget);
  };
}
