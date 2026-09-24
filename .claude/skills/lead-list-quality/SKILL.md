---
name: lead-list-quality
description: Explain the final lead-list quality standard and how to interpret its computed scorecard.
---

# Lead-list quality

The target is ten qualified companies, each with a name, domain, cited
qualification reasoning, source context, and outreach drafts. Duplicates must be
absent. `needs_review` companies never count as qualified. If strict evidence
does not support ten after permitted refills, return the real count and
`short_of_target` rather than weakening a hard filter.

Review ICP fit, evidence quality, duplicate rate, outreach relevance, data
completeness, and safety compliance. Rejected companies remain a deliverable.

This skill is guidance, not a safety or quality control. The application computes
the scorecard and enforces the target, uniqueness, evidence completeness, draft
presence, and exclusion of `needs_review` in code whether or not the model
chooses to invoke this skill.
