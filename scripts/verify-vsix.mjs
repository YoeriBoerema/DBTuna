import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yauzl from "yauzl";

// Stream the entire archive so truncated/corrupt entries fail before distribution.
// Compare the runtime entry points with this checkout's freshly built bundles.
export function verifyVsix(path, manifest, root = process.cwd()) {
  const required = new Map([
    ["extension/dist/extension.cjs", resolve(root, "dist/extension.cjs")],
    ["extension/dist/webview.js", resolve(root, "dist/webview.js")],
    ["extension/dist/webview.css", resolve(root, "dist/webview.css")],
    [
      "extension/dist/licenses/oracledb/LICENSE.txt",
      resolve(root, "dist/licenses/oracledb/LICENSE.txt"),
    ],
    [
      "extension/dist/licenses/oracledb/NOTICE.txt",
      resolve(root, "dist/licenses/oracledb/NOTICE.txt"),
    ],
  ]);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  return new Promise((resolveResult, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const seen = new Set();
      const fail = (error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const hash = createHash("sha256");
          const chunks = [];
          stream.on("error", fail);
          stream.on("data", (chunk) => {
            hash.update(chunk);
            if (entry.fileName === "extension/package.json") chunks.push(chunk);
          });
          stream.on("end", () => {
            try {
              seen.add(entry.fileName);
              if (entry.fileName === "extension/package.json") {
                const packaged = JSON.parse(
                  Buffer.concat(chunks).toString("utf8"),
                );
                if (
                  packaged.name !== manifest.name ||
                  packaged.version !== manifest.version ||
                  packaged.publisher !== manifest.publisher
                )
                  throw Error("VSIX manifest does not match package.json.");
              }
              const source = required.get(entry.fileName);
              if (source && hash.digest("hex") !== digest(readFileSync(source)))
                throw Error(
                  `VSIX contains a stale runtime bundle: ${entry.fileName}`,
                );
              zip.readEntry();
            } catch (error) {
              fail(error);
            }
          });
        });
      });
      zip.on("end", () => {
        for (const name of [
          "extension/package.json",
          "extension.vsixmanifest",
          ...required.keys(),
        ])
          if (!seen.has(name)) return reject(Error(`VSIX is missing ${name}`));
        resolveResult(digest(readFileSync(path)));
      });
      zip.readEntry();
    });
  });
}
