# Suggestions & Ideas Backlog

Purpose: Capture emerging improvement ideas, refinements, and technical debt notes that are NOT yet committed as formal features (or are refinements of existing ones). Periodically review and promote selected items into the main backlog & `FEATURE_LOG.md`.

## Active Suggestions
(Empty initially – add below using the format)

## Format Template
```
### YYYY-MM-DD: Short Title
Context:
Problem / Opportunity:
Suggestion:
Potential Impact:
Effort Estimate: (S / M / L)
Dependencies:
Status: (new | evaluating | promoted | rejected)
```

## Example Entry
```
### 2025-09-16: Normalize Notification Payloads
Context: Increasing number of notification-producing features.
Problem / Opportunity: Payload structure is inconsistent (varied keys per source).
Suggestion: Introduce `notification_schema_version` and typed JSON schema enforcement helper.
Potential Impact: Easier frontend rendering, future migration ease.
Effort Estimate: M
Dependencies: Feature ID 31 (Notification expansion design)
Status: new
```

## Change Log
- 2025-09-16: Created SUGGESTIONS.md scaffold.
