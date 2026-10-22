export function doomHtml(resources: {
  cspSource: string;
  root: string;
  script: string;
  style: string;
  nonce: string;
}): string {
  const { cspSource, root, script, style, nonce } = resources;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; connect-src ${cspSource}; style-src ${cspSource}; object-src 'none';"><link rel="stylesheet" href="${style}"><title>DOOM</title></head><body><header><h1>DOOM</h1><button id="back" type="button">Back to plans</button></header><main><canvas id="canvas" width="640" height="400" tabindex="0" aria-label="DOOM game"></canvas><p id="status" role="status">Loading...</p></main><footer>Arrows: move / turn &nbsp; Ctrl: fire &nbsp; Space: use &nbsp; Shift: run &nbsp; Enter / Esc: menu<br>Chocolate Doom / Freedoom</footer><script nonce="${nonce}" data-root="${root}" src="${script}"></script></body></html>`;
}
