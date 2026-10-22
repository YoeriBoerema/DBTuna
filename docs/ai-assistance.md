# AI assistance

[Documentation](README.md) · [Security](security.md)

AI assistance is optional and requires your own OpenAI API key and an account model that supports structured outputs through the Responses API. API access and usage charges are separate from installing DBTuna.

## Configure

Open **DBTuna: AI Assistance** from the Command Palette, the SQL editor's context submenu or the plan header. Its settings are:

- **Set API Key**: save the key in VS Code SecretStorage.
- **Select Model**: load account text-model candidates or enter a model ID manually.
- **Remove API Key**: delete the stored key.

A listed model is not a guarantee that it supports the required endpoint and output format. The selected model ID is saved in extension state; the key stays in host-side secret storage.

## Request advice

Select an operator, scroll to AI Assistance at the bottom of its details, add optional context and click **Get AI advice**. If an imported plan lacks SQL text, supply the query in its text box. On the Actual tab, the displayed actual plan is used.

The response contains:

1. A whole-query score from 1 to 100 and a short reason. A low score indicates apparent severe inefficiencies; 100 means no easy improvement is evident from the supplied evidence.
2. Up to three short suggestions, focused on the selected operator within the complete plan.
3. The complete proposed query when suggestions exist. For index/statistics-only advice without a safe rewrite, the original query is returned unchanged.

The score is an AI assessment, not a benchmark or completion guarantee. Review suggestions and SQL before using them. DBTuna does not apply changes or execute proposed SQL.

## Submitted data

The explicit button press sends the displayed SQL, engine/version, normalized plan, selected operator and your context to OpenAI. SQL literals, object names and native operator attributes are included. Credentials, connection labels, original batch setup SQL and duplicate native XML are excluded.

No advice is requested automatically. Workspace trust is required. Changing operators, replacing/closing the plan, or using Cancel stops a pending request. Advice is ephemeral and is not included in exports or saved view snapshots.

## Response handling

The host validates structured advice with a shared schema, then sends the data to the UI for plain-text formatting. Incomplete responses and invalid suggestions/SQL combinations are rejected. AI text is never interpreted as HTML, and no tools are enabled.

Requests use `store: false`, a 90-second advice timeout, a 512 KiB input limit, a 2 MiB response limit and up to 8,192 output tokens. Model listing has a separate 15-second timeout. `store: false` is not a promise of zero provider retention. Provider error bodies are not displayed because they may echo submitted data.

Transport and UI behavior are covered by mocks and browser tests. No live OpenAI request was made during the current verification pass.
