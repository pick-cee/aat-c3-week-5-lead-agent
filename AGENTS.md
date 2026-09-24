# AGENTS.md

Standing context for this repository. The reading order is below and it is not
optional: `PRD.md` is the brief, `DESIGN.md` is the specification and wins over
convenience, and the five guidance docs in `assets/` are requirements rather
than background.

## Read this first, it will save you confusion

Two different agents are involved here, and almost every sentence below depends
on telling them apart.

- **You** are the coding agent. Your instructions are this file.
- **The lead agent** is the thing being built. Its instructions are its system
  prompt, its tools, and its skills.

When this document says "the agent", it always means the lead agent.

There is no `.claude/` directory in this repository yet. **You will create
one**, at `.claude/skills/<name>/SKILL.md`, because the PRD requires the five
guidance docs in `assets/` to become Claude Agent SDK skills. Once it exists it
is **application runtime configuration, not instructions for you**: those files
are loaded by the product's agent at run time. Do not read them as guidance for
how to write code, and do not move or rename them. Your instructions stay in
this file.

## Start here, before writing any code

Read these in order and extract what each one is actually for. The guidance docs
are requirements, not background reading, and the grader checks that they made
it into the build.

1. **`PRD.md`**, the brief. Note especially: the Agent SDK is mandated as the
   runtime, Apify is for company discovery _only_, the final output is **ten**
   qualified leads, the agent must not find personal emails or send anything,
   scraped content is untrusted, and the Apify account is shared and paid.

2. **`DESIGN.md`**, the specification. It wins over convenience, and it wins
   over your own instinct about a cleaner approach. If you think it is wrong,
   say so and stop; do not quietly build the other thing.

3. **`assets/icp-refinement-guide.md`** becomes the `icp-refinement` skill.
   Take the ICP JSON shape verbatim, and the hard-filter versus
   soft-preference distinction, which the whole ten-lead rule depends on.

4. **`assets/lead-qualification-guide.md`** becomes the `lead-qualification`
   skill. Take the three statuses, the output shape, and "qualify from evidence,
   not guesses". The rules in it that can be checked are checked in code
   (`DESIGN.md` §10.1), not left to the model.

5. **`assets/outbound-copywriting-guide.md`** becomes the
   `outbound-copywriting` skill. Take the three-email structure, the
   personalisation examples, and the weak-personalisation list. Its quality
   checklist becomes code (§10.2).

6. **`assets/lead-list-quality-guide.md`** becomes the `lead-list-quality`
   skill, but the scorecard is **computed** (§10.3). The skill exists because
   the PRD requires it; the enforcement is not in the skill.

7. **`assets/outreach-safety-guide.md`** becomes the `outreach-safety` skill,
   and it is the same story. Its "must not" list is enforced by the tool surface
   and the hook (§4), not by the model choosing to invoke a skill.

A skill that the model may or may not invoke is guidance. It is not a control.
Both of the last two skills should say so in their own text.

## What this is

A lead research and outreach agent for Koya Talent. A founder gives a
qualification objective. The system refines it into ICP criteria, has a human
confirm them, discovers companies through Apify, researches each one, qualifies
it against the criteria with evidence, and drafts a three-step cold email
sequence plus a LinkedIn message for each qualified lead.

Nothing is sent. No personal contact data is ever collected.

**The product is the research note, not the list.** A founder can buy a filtered
company list cheaply. What they cannot buy is the specific, checkable reason to
reach out to a particular company this week. Every design decision serves that.

## Stack

Next.js (App Router) on Vercel · Supabase Postgres · Claude Agent SDK ·
Apify (company discovery only) · Firecrawl (scraping). TypeScript throughout.

## Rules that are not negotiable

1. **The agent chooses tools. It does not choose limits.** Every cap lives on
   the run record and is enforced by a `PreToolUse` hook and by the handler.
   An argument from the agent asking for more is logged and ignored, never
   honoured. A prompt is a request; a handler is a fact. Only a person raises a
   cap: when a run cannot afford its next step it pauses at `awaiting_budget`
   and asks the founder (`DESIGN.md` §13), and the raise is bounded, logged and
   made through a route, never through a tool.

2. **No tool exists that could break the scope rules.** There is no
   email-finding tool, no email validation tool, no send tool. `Bash`,
   `WebFetch`, `WebSearch`, `Write`, `Edit` and `NotebookEdit` are removed by
   bare name in `disallowedTools`, which takes them out of the model's context.
   An agent with a general HTTP tool makes every other control in this file
   decorative. Do not add one, for any reason, including debugging.

3. **Contact-shaped fields are stripped at ingest, by allowlist.** Only company
   name, domain, headcount, industry, location, description and funding survive
   from a discovery result. A personal email that is never stored cannot be
   exported, cannot leak into a draft, and cannot appear in a screenshot.

4. **Every claim cites stored evidence.** Fit reasons, concerns and every
   personalised line in every email carry the excerpt ids they rest on. A
   payload whose citation does not resolve to that candidate's own excerpts is
   rejected with `isError: true` so the agent can correct it. A reason with no
   evidence is not storable. Excerpts are only ever cut by the server from text
   it fetched itself: `E1` is the stored discovery record, later labels are
   chunks of company-website pages, appended per candidate and never
   renumbered. No tool accepts "excerpt" text from the agent.

5. **Ten is the target, and it is reached by widening the funnel, never by
   lowering the bar.** Over-fetch candidates, qualify strictly, refill up to
   `limits.max_refills` (two by default) excluding seen domains. A refill may
   drop a soft preference and must record that it did. A refill may never relax
   a hard filter. Still short, the run pauses and asks the founder for more
   searches; if they finish instead, it ends `short_of_target` with the real
   count. **No company is ever marked qualified to reach a number.**

6. **Unknown is not a pass.** A hard filter with no evidence is `unknown`, and
   so is a `pass` or `fail` verdict that cites no excerpt. Any unproven filter
   forces `needs_review` on a qualified claim; a rejection stands only when a
   failed filter is cited. The reason for every downgrade is stored and shown.
   A `needs_review` lead never counts toward the ten unless a founder approves
   it after reading the evidence; that approval is stored as the founder's
   decision (`checks.human_decision`), never rewritten as the model's verdict.
   A source that failed to fetch and a source that came back empty are
   different stored values with different reasons.

7. **Scraped text is data, never instruction.** We cannot stop a model reading
   an instruction in a page we asked it to read. We can make sure there is
   nothing it can do about it: no action to hijack, limits out of reach, and
   claims that must cite evidence. The injection scan is detection and is
   labelled as such; it flags, it never silently drops a page.

8. **The only gate is before the spend.** A human confirms the ICP before any
   paid call runs. After that the run is autonomous, which is why everything
   above has to hold without supervision.

9. **Apify is real money on a shared account.** Every call passes an explicit
   result cap taken from the run record. Nothing runs uncapped, ever. Check an
   actor's pricing model before using it: pay-per-result and pay-per-event are
   fine, rental charges a flat monthly fee the moment it is enabled and must
   never be started.
   The selected actor is `harvestapi/linkedin-company-search` (pay-per-event,
   no LinkedIn login, company pages only; evidence and prices in `DESIGN.md`
   §13). It replaced a company-list actor that returned zero companies and
   `apify/google-search-scraper`, which returns web pages rather than
   companies. Pass `maxItems` (input and API level) as the stored candidate
   ceiling reduced to what the remaining Apify budget can pay for, and
   `maxTotalChargeUsd` as the remaining budget itself, never a floor above it.
   Location and size filters come from the confirmed ICP in the handler; the
   agent chooses LinkedIn industries (exact names from the stored taxonomy) and
   at most a short keyword. Search by industry, not by keyword phrase: keywords
   match company names, and the phrases that found 0 and 8 companies found
   59,592 as industries. A company whose record puts its headquarters outside
   every requested location is set aside with that reason before any research
   is spent on it. One paid search per discovery step is enforced
   in `reserve_tool_call`. Claim the step's job slot with one conditional update,
   store the actor run id per discovery/refill step so a timeout resumes instead
   of starting a duplicate paid run, and page forward when a refill repeats the
   same filters. Read cost only after charged events cover every returned
   company; until then it is `cost_complete = false`. A zero-result search is
   visible and enters the bounded refill path; no actor is described as
   guaranteeing results for every possible ICP.

10. **The SDK's `total_cost_usd` is an estimate, and must be labelled as one.**
    It is a client-side figure from a bundled price table, explicitly not
    billing data. Display it as an estimate. Apify spend is separate and real,
    and the two are never added into one unlabelled number.

11. **No pipeline stage runs inside create or confirm.** The Next.js Node
    server starts a lease-safe scheduler that advances one run by one bounded
    step. The open run workspace, in any browser or on any device, provides the
    same one-step backstop, and the shared-secret `/api/runner` remains for
    self-hosting. Vercel Hobby may freeze the main-server timer between requests,
    so the UI backstop is required and the scheduler is never described as a
    guaranteed cron replacement. The workspace loop schedules its own next tick;
    it must not depend on a React effect re-running after `router.refresh()`,
    which is how it once stalled after one step. An agent loop cannot be
    checkpointed mid-thought, so stages are small: one company researched per
    invocation, one lead drafted per invocation. A step runs up to four
    research invocations (three drafts) in parallel, each claimed atomically
    with `for update skip locked`, and the lease (300s) covers the slowest; one
    company at a time took 44 minutes for twelve. The server reads each
    company's homepage before its invocation, through the same limits and audit
    as the agent's tool, so turns are spent on judgement rather than fetching.
    Any running dev server also runs the scheduler, and it will execute any run
    you put in a runnable status, spending real money. Start servers used for
    testing with `KOYA_DISABLE_MAIN_SERVER_SCHEDULER=1`, and hold a lease on any
    test run you create.

12. **Reserve, then act, then confirm.** The runner claims a run with a single
    conditional lease update. Never read-then-write. Idempotency lives in unique
    constraints: `candidates (run_id, domain_canonical)` and
    `runs.submit_token`, not in application logic that checks first.

13. **Every tool call is logged, including refused ones.** A call the hook
    refused over a limit is the most interesting row in the table, because it is
    the evidence that the limit is real. Log the tool, the purpose, an input
    summary, a result summary, status, error and cost.

14. **Failures are visible, specific and owned.** Every failure names the stage,
    gives a plain-language reason and a structured detail, and writes a row. A
    candidate that fails research is marked and the run continues. One bad
    website never costs a run, and one bad draft never costs a run either. The
    founder can recover alone: retry a failed step (offered only where it could
    succeed), stop a run, or start again from its criteria. Stop is sticky:
    every runner transition is conditional on the run not being `cancelled`.

15. **Secrets are server-side only.** Anthropic, Apify, Firecrawl and the
    Supabase service role never reach the browser. The Apify token is the team
    token and is never logged, never returned in a tool result, never echoed in
    an error message. `.env*` is gitignored before the first commit; a secret in
    git history is a leaked secret.

16. **Postgres grants EXECUTE to PUBLIC by default.** A `grant` is not a
    boundary until the default is revoked. Every migration that creates a
    function revokes the public default, and a standing check fails the build if
    anything is executable by `public` or `anon`.

## Interface principle

Understandable in five seconds, readable after that. A founder should know the
state of a run without reading a paragraph. Needs-review leads sort above
everything, because that is where five minutes of human attention is worth most.

**The rejected list is a feature.** Show it, keep it, export it. A founder
re-running the same ICP next month should never pay to reject the same
companies twice.

**Evidence is one click away.** A fit reason opens the excerpt it rests on. If a
founder has to re-do the research to trust the list, the product did nothing.

**Cost is shown, and shown honestly.** Run total and cost per qualified lead,
with the agent estimate labelled as an estimate.

**A founder never needs to call the engineer.** Plain words only: stage and
status identifiers never appear on founder screens; `src/lib/ui/labels.ts` is
the one vocabulary. Every problem state carries the action that resolves it.
One primary action per screen and no destination linked twice (the landing
page once had "Dashboard" and "Open workspace" doing the same thing). Every
control works on every run from any browser or device; never bind a run to the
browser that created it (an earlier per-run cookie did, and founders could not
delete or continue their own runs from a second device). Spend is protected by
the approval gate and the per-run caps, not by which browser clicks. Delete is
always soft, with a recycle bin. Notification settings live in the database
and can be tested from the settings page; they are defaults, and each run has
its own recipient because the person starting research is not always the
person on the workspace address. Nothing a founder must read is covered by a
sticky panel. Every review item offers a way to say it is wrong, not only that
it is right, and a correction must be able to reach the criteria, since only
the criteria change the search. When one item is about another (an assumption
about a criterion), link them and let a click land on the exact place, open for
editing; never make a founder search a list for it. Never show a raw SDK or
provider error: a stage that hit its own limit reads as a plain reason, and a
run that cannot afford its next step shows a modal with what ran out, what was
found so far and what each option allows, never a dead end. A `needs_review`
lead offers approve and reject right beside the evidence that could not settle
it. The page-by-page contract is `DESIGN.md` §11.

## Agent SDK notes that will bite

- Custom tools go on an in-process server via `createSdkMcpServer`, registered
  through `mcpServers`, and named `mcp__{server}__{tool}` in `allowedTools`.
- **Hooks run before deny rules, ask rules, permission mode and allow rules**,
  and a hook deny holds even in `bypassPermissions`. That is why the limit
  counting lives in a `PreToolUse` hook: it is the only layer that sees every
  call. An `allowedTools` entry auto-approves and skips `canUseTool` entirely.
- A bare name in `disallowedTools` removes the tool from context. A scoped rule
  leaves it visible and lets the agent waste a turn on it. Use bare names.
- `permissionMode: "dontAsk"` denies anything that would prompt, and never calls
  `canUseTool`. That is what we want: there is no human mid-run.
- Skills load from the filesystem and need `settingSources` to include
  `'project'`. Setting `skills` adds the `Skill` tool to `allowedTools`
  automatically, but if you also pass an explicit `tools` list, `Skill` has to be
  in it.
- Set `maxTurns` **and** `maxBudgetUsd` on every stage. They are the runtime's
  own hard stops and they do not depend on the agent cooperating.
- Return `isError: true` from a handler to compose the message the agent reads.
  A thrown exception reaches it as a raw string with no context, and the loop
  continues either way.
- `readOnlyHint: true` lets read-only tools run in parallel. Keep the annotation
  honest to what the handler does. Every lead-agent tool writes an audit row,
  so all six use `readOnlyHint: false`; `get_run_context` is read-only only with
  respect to run data.

## Conventions

- Server actions or route handlers for anything touching a key. No client-side
  calls to Anthropic, Apify, Firecrawl or Supabase service role, ever.
- Domains are canonicalised before storage: lowercase, strip `www.`, strip path
  and query. The duplicate check is a database constraint, not a later pass.
- Every state transition writes a log row.
- Counters use an atomic upsert, never read-modify-write, and fail closed when
  the counter cannot be read.
- Prefer explicit failure over a plausible default.
- Thresholds, limits and prices are named constants in one file with a
  `PRICES_VERIFIED_ON` date, never literals scattered through the code.
- No em dashes in generated content. Forbidden in the prompt and removed
  mechanically at save, because asking a model not to use them does not reliably
  work. Log the count that got through so "the prompt is working" is a number.
- Comments explain _why_, not _what_.
- Print the data before reasoning about it. When a parse or a match behaves
  impossibly, dump the raw bytes.
- `assets/` belongs to the client and is never edited. The skills in
  `.claude/skills/` stay faithful to those guides. Instructions that depend on
  how this app works (what `E1` is, how to format geography for the LinkedIn
  filter) go in the stage prompts in `src/lib/runner/advance-run.ts`, not in
  the skills.
- Every behaviour change is written into this file and `DESIGN.md` in the same
  piece of work, with its reason. They are the single source of truth, and
  `DESIGN.md` §17 logs what changed and why.
- Server pages cannot import plain functions or constants from a
  `"use client"` file. Shared helpers live in `src/lib/`.
- Anything under `src/app/` named `icon`, `apple-icon`, `opengraph-image`,
  `twitter-image`, `sitemap`, `robots` or `manifest` is a Next.js metadata
  route, even inside `components/`. The icon component is `icons.tsx` for that
  reason.

## Before you hand back a change

`npm run typecheck`, the test suite, and a production build, all clean. Say what
changed and what you did not do. Never claim a measured improvement without a
measurement.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
