export {};
type Runtime = {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  noExitRuntime: boolean;
  wasmBinary: Uint8Array;
  preRun: () => void;
  onRuntimeInitialized: () => void;
  onAbort: () => void;
  print: (text: string) => void;
  printErr: (text: string) => void;
  FS?: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  SDL2?: { audioContext?: AudioContext };
};
declare function acquireVsCodeApi(): {
  postMessage(message: { type: "EXIT_DOOM" }): void;
};
const host = acquireVsCodeApi();
const script = document.currentScript as HTMLScriptElement;
const root = script.dataset.root!;
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const statusElement = document.getElementById("status")!;
const abort = new AbortController();
const runtimeWindow = window as unknown as {
  Module: Runtime;
  callMain(args: string[]): void;
};
let started = false;
const failure = () => {
  statusElement.textContent = "Unable to start. Return to plans and try again.";
  statusElement.hidden = false;
};
document.getElementById("back")!.addEventListener("click", () => {
  abort.abort();
  host.postMessage({ type: "EXIT_DOOM" });
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerdown", () => {
  canvas.focus();
  void runtimeWindow.Module?.SDL2?.audioContext?.resume();
});
window.addEventListener("pagehide", () => abort.abort(), { once: true });
document.addEventListener("visibilitychange", () => {
  const context = runtimeWindow.Module?.SDL2?.audioContext;
  if (document.hidden) void context?.suspend();
  else if (started) void context?.resume();
});
async function bytes(name: string): Promise<Uint8Array> {
  const response = await fetch(root + "/" + name, { signal: abort.signal });
  if (!response.ok) throw Error("Asset unavailable");
  return new Uint8Array(await response.arrayBuffer());
}
async function launch() {
  const [wasm, wad, config] = await Promise.all([
    bytes("websockets-doom.wasm"),
    bytes("freedoom1.wad"),
    bytes("default.cfg"),
  ]);
  if (abort.signal.aborted) return;
  runtimeWindow.Module = {
    canvas,
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary: wasm,
    print: () => {},
    printErr: () => {},
    onAbort: failure,
    preRun() {
      const fs = runtimeWindow.Module.FS!;
      fs.mkdir("/savefiles");
      fs.writeFile("/freedoom1.wad", wad);
      fs.writeFile("/default.cfg", config);
    },
    onRuntimeInitialized() {
      if (abort.signal.aborted || started) return;
      started = true;
      window.setTimeout(() => {
        if (abort.signal.aborted) return;
        try {
          runtimeWindow.callMain([
            "-iwad",
            "/freedoom1.wad",
            "-config",
            "/default.cfg",
            "-savedir",
            "/savefiles",
            "-window",
            "-width",
            "640",
            "-height",
            "400",
            "-nomusic",
            "-skill",
            "2",
            "-warp",
            "1",
            "1",
          ]);
          statusElement.hidden = true;
          canvas.focus();
        } catch {
          failure();
        }
      }, 0);
    },
  };
  const engine = document.createElement("script");
  engine.nonce = script.nonce;
  engine.src = root + "/websockets-doom.js";
  engine.onerror = failure;
  document.body.append(engine);
}
void launch().catch(() => {
  if (!abort.signal.aborted) failure();
});
