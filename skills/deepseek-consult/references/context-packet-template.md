# DeepSeek Context Packet Template

Use this template for every consultation. Replace the timestamp and sentinel with fresh values.

````markdown
CONTEXT_PACKET_V1

```json
{
  "task_id": "deepseek-consult-YYYYMMDD-HHMMSS",
  "sentinel": "DEEPSEEK_RESULT_YYYYMMDD_HHMMSS",
  "task_type": "architecture_review|business_consult|content_strategy|skill_design|risk_review|research|other",
  "context_strategy": "problem_first_full_context",
  "credential_status": "no_executable_credentials",
  "requested_route": "FAST_THINK_SEARCH|FAST_THINK|EXPERT",
  "context_hash": "<sha256 of markdown body>",
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

Act as a strict reviewer and deep reasoning partner. Find the biggest flaw first, then give the strongest revised path. If web search is enabled, distinguish sourced facts from your own inference and include the important sources. Do not provide generic encouragement. Do not reveal hidden chain-of-thought; provide a concise reasoning brief with assumptions, decision frame, evidence weighting, counterarguments, tradeoffs, and recommendation.

## RETURN_FORMAT

First line must be: DEEPSEEK_RESULT_YYYYMMDD_HHMMSS

Then use:
1. Reasoning brief: assumptions, frame, evidence, counterargument, tradeoffs
2. Direct judgment
3. Biggest flaw
4. Required changes
5. What to ignore
6. Final adoption recommendation
````
