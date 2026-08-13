# Gemini 3.6 Flash Context Packet Template

Use this template when preparing a consultation packet. Replace the timestamp and sentinel with fresh values for every request.

````markdown
CONTEXT_PACKET_V1

```json
{
  "task_id": "gemini36-flash-consult-YYYYMMDD-HHMMSS",
  "sentinel": "GEMINI36_FLASH_RESULT_YYYYMMDD_HHMMSS",
  "task_type": "architecture_review|business_consult|content_strategy|skill_design|risk_review|other",
  "context_strategy": "problem_first_full_context",
  "credential_status": "no_executable_credentials",
  "context_hash": "<sha256 of markdown body>",
  "requested_mode": "3.6 Flash + extended thinking",
  "required_output": [
    "reasoning_brief",
    "direct_judgment",
    "biggest_flaw",
    "specific_revisions",
    "adoption_decision"
  ]
}
```

## TASK

## BACKGROUND

## USER_INTENT

## LOCAL_JUDGMENT

## EVIDENCE

## ATTACHMENTS

## ATTEMPTS_SO_FAR

## OPTIONS

## RISKS

## ASK

Act as a strict reviewer and deep reasoning partner. Find the biggest flaw first, then give the strongest revised path. Do not provide generic encouragement. Do not reveal hidden chain-of-thought; instead provide a concise reasoning brief with assumptions, decision frame, evidence weighting, counterarguments, and tradeoffs.

## RETURN_FORMAT

First line must be: GEMINI36_FLASH_RESULT_YYYYMMDD_HHMMSS

Then use:
1. Reasoning brief: assumptions, frame, evidence, counterargument, tradeoffs
2. Direct judgment
3. Biggest flaw
4. Required changes
5. What to ignore
6. Final adoption recommendation
````
