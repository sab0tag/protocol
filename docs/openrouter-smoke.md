# OpenRouter smoke check (operator-only)

No patient data, medications, restrictions, account identifiers or private content are sent.
The command sends exactly one synthetic classification request and prints only token counts,
model name and provider-reported cost. It does **not** enable OpenRouter in Protocol production.

1. Set `OPENROUTER_API_KEY` in the server's protected environment (never commit it).
2. Set `OPENROUTER_SMOKE_MODEL` to an explicitly selected model supporting JSON schema responses.
3. From `server/`, run `npm run ai:smoke:openrouter`.
4. Inspect the result and the OpenRouter billing dashboard. No automatic fallback or retry.

Do not use a model whose provider or retention policy has not been reviewed.
The current menu and assistant prompts can contain medical restrictions and therefore are **not**
eligible for an automatic switch to OpenRouter. A future production integration needs
per-task data classification, explicit consent where appropriate, persisted budgets,
and cost reconciliation before enablement.
