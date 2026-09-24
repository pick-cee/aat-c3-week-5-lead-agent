---
name: icp-refinement
description: Refine a founder's qualification objective into an explicit ICP before any company discovery or paid tool use.
---

# ICP refinement

Turn the objective into concrete criteria before searching. Preserve every
specific user constraint. Distinguish hard filters, which must be true for a
lead to qualify, from soft preferences, which improve fit but may be dropped by
a recorded refill. Do not silently turn every preference into a hard filter.

Return this ICP shape verbatim, plus a separate `assumptions` array:

```json
{
  "target_company_type": "",
  "industries": [],
  "geography": [],
  "headcount_range": "",
  "buyer_persona": "",
  "business_problem": "",
  "hard_filters": [],
  "soft_preferences": [],
  "disqualifiers": []
}
```

Clarify target company type, industry, geography, size, buyer persona, likely
business problem, disqualifiers, and preferences. If the objective is vague,
make the smallest useful assumptions and name every one. If a requested hard
filter cannot be expressed by discovery data, flag it rather than pretending it
can be searched. The human confirmation screen is the authority before spend.
