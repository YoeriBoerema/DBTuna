# Adding an adapter

Implement QueryPlanAdapter from adapter-sdk, with a narrow canParse discriminator and parse method returning a validated QueryPlan. Register it in AdapterRegistry in the extension entry point. Keep native mappings and traversal in the adapter package. Preserve unknown attributes in node properties and plan metadata.

Build a separate host-only connection collector and credential workflow if live access is required. Include fixture tests for optional metrics, unknown operators, native nesting and malformed input. The React graph requires no database-specific changes.
