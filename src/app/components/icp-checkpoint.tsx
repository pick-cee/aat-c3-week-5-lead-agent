"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { assumptionTargets, hiringRequirement, sanitizeAssumptionLinks, type AssumptionTarget, type CriterionList, type IcpField, type RefinedIcp } from "@/lib/checks/icp";
import { linkedInCompanySizes, linkedInLocations } from "@/lib/providers/linkedin-filters";
import { money } from "@/lib/ui/labels";

import { AssumptionList, type AssumptionItem } from "./assumption-list";
import { Icon } from "./icons";
import { DeleteRunButton } from "./run-actions";

type Icp = RefinedIcp;

/** Which criterion or field the founder jumped to from an assumption. */
type Focus = { target: AssumptionTarget; assumptionId: number; assumption: string; nonce: number; opened?: boolean };

const LIST_LABEL: Record<CriterionList, string> = { hard_filters: "Must have", soft_preferences: "Nice to have", disqualifiers: "Reject if" };
const FIELD_LABEL: Record<IcpField, string> = {
  target_company_type: "Kind of company", headcount_range: "Size", geography: "Where", industries: "Industries",
  buyer_persona: "Who you want to reach", business_problem: "The problem you solve",
};

function normalise(raw: Record<string, unknown>): Icp {
  const text = (key: string) => (typeof raw[key] === "string" ? String(raw[key]) : "");
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).map(String).filter(Boolean) : []);
  const links = Array.isArray(raw.assumption_links)
    ? (raw.assumption_links as Array<{ assumption?: unknown; related?: unknown }>).map((link) => ({ assumption: String(link.assumption ?? ""), related: Array.isArray(link.related) ? link.related.map(String) : [] }))
    : undefined;
  return {
    target_company_type: text("target_company_type"), industries: list("industries"), geography: list("geography"),
    headcount_range: text("headcount_range"), buyer_persona: text("buyer_persona"), business_problem: text("business_problem"),
    hard_filters: list("hard_filters"), soft_preferences: list("soft_preferences"), disqualifiers: list("disqualifiers"), assumptions: list("assumptions"),
    ...(links ? { assumption_links: links } : {}),
  };
}

function problemsWith(icp: Icp): string[] {
  const problems: string[] = [];
  if (!icp.target_company_type.trim()) problems.push("Say what kind of company to look for.");
  if (icp.geography.length === 0) problems.push("Add at least one location, or add \"Anywhere\".");
  if (!icp.headcount_range.trim()) problems.push("Add a company size, for example 10-100 employees.");
  if (!icp.buyer_persona.trim()) problems.push("Say who the outreach is for.");
  if (!icp.business_problem.trim()) problems.push("Say what problem you solve for them.");
  if (icp.hard_filters.length === 0) problems.push("Keep at least one must-have.");
  return problems;
}

function targetLabel(target: AssumptionTarget): string {
  if (target.kind === "field") return FIELD_LABEL[target.field];
  const short = target.text.length > 64 ? `${target.text.slice(0, 61)}...` : target.text;
  return `${LIST_LABEL[target.list]}: ${short}`;
}

/** The note under a criterion or field the founder arrived at from an assumption. */
function FocusNote({ focus, onBack }: { focus: Focus; onBack: () => void }) {
  return <small className="focus-note">
    <Icon name="alert" size={13} />
    <span>Fixing the assumption: &ldquo;{focus.assumption.length > 110 ? `${focus.assumption.slice(0, 107)}...` : focus.assumption}&rdquo;</span>
    {/* mousedown is prevented so an open editor keeps its value until the click lands */}
    <button type="button" className="link-button" onMouseDown={(event) => event.preventDefault()} onClick={onBack}>Back to assumptions</button>
  </small>;
}

function ChipEditor({ id, label, values, onChange, placeholder, disabled, note }: { id: string; label: string; values: string[]; onChange: (next: string[]) => void; placeholder: string; disabled: boolean; note?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setDraft("");
  };
  return <div className={`field ${note ? "is-focused" : ""}`}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="chip-input">
      {values.map((value) => <span className="chip" key={value}>{value}{!disabled && <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}><Icon name="close" size={12} /></button>}</span>)}
      {!disabled && <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} onBlur={add} placeholder={values.length ? "Add another" : placeholder} />}
    </div>
    {note}
  </div>;
}

function CriterionRow({ text, disabled, onSave, onRemove, move, focus, onBack, onOpened }: {
  text: string; disabled: boolean; onSave: (next: string) => void; onRemove: () => void;
  move?: { label: string; onMove: () => void }; focus: Focus | null; onBack: () => void; onOpened: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const row = useRef<HTMLLIElement>(null);
  const pending = focus !== null && !focus.opened;
  useEffect(() => {
    if (!pending) return;
    // Arriving from an assumption opens the criterion ready to edit, once.
    // A saved rename remounts this row; the opened flag stops it reopening.
    setDraft(text);
    setEditing(true);
    row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    onOpened();
  }, [pending, text, onOpened]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== text) onSave(next);
    else setDraft(text);
    setEditing(false);
  };
  const note = focus ? <FocusNote focus={focus} onBack={() => { commit(); onBack(); }} /> : null;
  if (editing) {
    return <li ref={row} className={`criterion is-editing ${focus ? "is-focused" : ""}`}>
      {/* Multi-line so a long criterion is visible whole while it is edited. */}
      <textarea autoFocus rows={Math.min(6, Math.ceil(draft.length / 34) + 1)} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(); } if (event.key === "Escape") { setDraft(text); setEditing(false); } }} aria-label="Edit criterion" />
      <small className="muted edit-hint">Enter to save · Esc to cancel</small>
      {note}
    </li>;
  }
  return <li ref={row} className={`criterion ${focus ? "is-focused" : ""}`}>
    <span className="criterion-text">{text}</span>
    {!disabled && <span className="criterion-actions">
      <button type="button" className="icon-button small" onClick={() => { setDraft(text); setEditing(true); }} aria-label={`Edit: ${text}`} title="Edit"><Icon name="edit" size={14} /></button>
      {move && <button type="button" className="icon-button small" onClick={move.onMove} aria-label={`${move.label}: ${text}`} title={move.label}><Icon name="swap" size={14} /></button>}
      <button type="button" className="icon-button small" onClick={onRemove} aria-label={`Remove: ${text}`} title="Remove"><Icon name="close" size={14} /></button>
    </span>}
    {note}
  </li>;
}

function CriteriaColumn({ list, subtitle, tone, items, disabled, placeholder, onChange, onRename, move, focus, onBack, onOpened }: {
  list: CriterionList; subtitle: string; tone: "hard" | "soft" | "reject"; items: string[]; disabled: boolean; placeholder: string;
  onChange: (next: string[]) => void; onRename: (from: string, to: string) => void;
  move?: { label: string; onMove: (item: string) => void }; focus: Focus | null; onBack: () => void; onOpened: () => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = draft.trim();
    if (next && !items.includes(next)) onChange([...items, next]);
    setDraft("");
  };
  const focusedText = focus?.target.kind === "criterion" && focus.target.list === list ? focus.target.text : null;
  return <section className={`criteria-column criteria-${tone}`}>
    <header><h3>{LIST_LABEL[list]}<span className="count">{items.length}</span></h3><p>{subtitle}</p></header>
    <ul>
      {items.length === 0 && <li className="criterion empty">None yet</li>}
      {items.map((item, index) => <CriterionRow key={`${item}-${index}`} text={item} disabled={disabled}
        onSave={(next) => onRename(item, next)}
        onRemove={() => onChange(items.filter((_, position) => position !== index))}
        move={move ? { label: move.label, onMove: () => move.onMove(item) } : undefined}
        focus={focusedText === item ? focus : null} onBack={onBack} onOpened={onOpened} />)}
    </ul>
    {!disabled && <div className="criterion-add"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder} aria-label={placeholder} /><button type="button" className="button button-ghost button-small" onClick={add} disabled={!draft.trim()}><Icon name="plus" size={14} />Add</button></div>}
  </section>;
}

export function IcpCheckpoint({ runId, objective, initial, limits, notificationEmail, excludedCount }: {
  runId: string;
  objective: string;
  initial: Record<string, unknown>;
  limits: Record<string, number>;
  notificationEmail: string | null;
  excludedCount: number;
}) {
  const router = useRouter();
  const [icp, setIcp] = useState<Icp>(() => normalise(initial));
  // Review progress on each assumption is page state; the criteria carry the
  // decision. Removed assumptions leave the stored ICP, and the agent's
  // original version is kept in the activity log when the criteria are saved.
  const [assumptions, setAssumptions] = useState<AssumptionItem[]>(() => normalise(initial).assumptions.map((text, id) => ({ id, text, original: text, status: "open" })));
  const current = useMemo<Icp>(() => {
    const next: Icp = { ...icp, assumptions: assumptions.filter((item) => item.status !== "removed").map((item) => item.text) };
    return icp.assumption_links ? { ...next, assumption_links: sanitizeAssumptionLinks(next) } : next;
  }, [icp, assumptions]);
  const [saved, setSaved] = useState<Icp>(() => {
    const start = normalise(initial);
    return start.assumption_links ? { ...start, assumption_links: sanitizeAssumptionLinks(start) } : start;
  });
  const [focus, setFocus] = useState<Focus | null>(null);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);
  const problems = problemsWith(current);
  const unchecked = assumptions.filter((item) => item.status === "open").length;
  const disabled = busy !== null;
  const locations = useMemo(() => linkedInLocations(icp.geography), [icp.geography]);
  const sizes = useMemo(() => linkedInCompanySizes(icp.headcount_range), [icp.headcount_range]);
  const hiring = useMemo(() => hiringRequirement(icp.hard_filters), [icp.hard_filters]);

  const markChanged = (assumptionId: number) =>
    setAssumptions((items) => items.map((item) => (item.id === assumptionId && (item.status === "open" || item.status === "right") ? { ...item, status: "changed" } : item)));

  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => {
    setIcp((state) => ({ ...state, [key]: value }));
    setNotice("");
    if (focus?.target.kind === "field" && focus.target.field === key) markChanged(focus.assumptionId);
  };

  /** Rewords a criterion and keeps every assumption link and the focus pointing at it. */
  const renameCriterion = (list: CriterionList, from: string, to: string) => {
    setIcp((state) => ({
      ...state,
      [list]: state[list].map((item) => (item === from ? to : item)),
      ...(state.assumption_links ? { assumption_links: state.assumption_links.map((link) => ({ ...link, related: link.related.map((reference) => (reference === from ? to : reference)) })) } : {}),
    }));
    if (focus?.target.kind === "criterion" && focus.target.list === list && focus.target.text === from) {
      setFocus({ ...focus, target: { ...focus.target, text: to } });
      markChanged(focus.assumptionId);
    }
    setNotice("");
  };

  const onAssumptionsChange = (next: AssumptionItem[]) => {
    const before = new Map(assumptions.map((item) => [item.id, item.text]));
    const renamed = next.filter((item) => before.has(item.id) && before.get(item.id) !== item.text);
    if (renamed.length && icp.assumption_links) {
      setIcp((state) => ({
        ...state,
        assumption_links: (state.assumption_links ?? []).map((link) => {
          const hit = renamed.find((item) => before.get(item.id) === link.assumption);
          return hit ? { ...link, assumption: hit.text } : link;
        }),
      }));
    }
    setAssumptions(next);
    setNotice("");
  };

  const jump = (target: AssumptionTarget, item: AssumptionItem) => {
    setFocus({ target, assumptionId: item.id, assumption: item.text, nonce: Date.now() });
  };

  const opened = useCallback(() => setFocus((state) => (state && !state.opened ? { ...state, opened: true } : state)), []);

  const back = () => {
    const id = focus?.assumptionId;
    setFocus(null);
    if (id !== undefined) document.getElementById(`assumption-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useEffect(() => {
    if (focus?.target.kind !== "field" || focus.opened) return;
    const input = document.getElementById(`icp-field-${focus.target.field}`) as HTMLInputElement | null;
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
    input?.focus({ preventScroll: true });
    opened();
  }, [focus, opened]);

  const fieldNote = (field: IcpField) => (focus?.target.kind === "field" && focus.target.field === field ? <FocusNote focus={focus} onBack={back} /> : undefined);

  async function persist(): Promise<boolean> {
    const response = await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(data.error ?? "The criteria could not be saved."); return false; }
    setSaved(current);
    return true;
  }

  async function save() {
    setBusy("save"); setError(""); setNotice("");
    try { if (await persist()) setNotice("Changes saved. Nothing has been spent."); }
    catch { setError("The connection dropped. Your changes were not saved."); }
    setBusy(null);
  }

  async function approve() {
    if (problems.length) { setError(problems[0]); return; }
    setBusy("approve"); setError(""); setNotice("");
    try {
      if (dirty && !(await persist())) { setBusy(null); return; }
      const response = await fetch(`/api/runs/${runId}/confirm`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "The run could not start."); setBusy(null); return; }
      router.refresh();
    } catch {
      setError("The connection dropped. Refresh to see whether research started before trying again.");
      setBusy(null);
    }
  }

  const textField = (field: "target_company_type" | "headcount_range" | "buyer_persona", placeholder?: string) =>
    <div className={`field ${fieldNote(field) ? "is-focused" : ""}`}>
      <label className="field-label" htmlFor={`icp-field-${field}`}>{FIELD_LABEL[field]}</label>
      <input id={`icp-field-${field}`} value={icp[field]} disabled={disabled} placeholder={placeholder} onChange={(event) => set(field, event.target.value)} />
      {fieldNote(field)}
    </div>;

  return <section className="checkpoint" aria-labelledby="checkpoint-title">
    <header className="checkpoint-head">
      <p className="eyebrow">Your approval · nothing spent yet</p>
      <h2 id="checkpoint-title">Is this who you want Koya to find?</h2>
      <p>Koya turned your brief into the criteria below. <b>Must-haves are never loosened to reach the target</b>, so keep only what is truly required and move the rest to nice-to-have.</p>
      <blockquote className="brief-quote"><span>You asked for</span>{objective}</blockquote>
    </header>

    <AssumptionList items={assumptions} disabled={disabled} onChange={onAssumptionsChange}
      targetsFor={(text) => assumptionTargets(current, text)} labelFor={targetLabel} onJump={jump}
      onAddCriterion={(kind, text) => setIcp((state) => (state[kind].includes(text) ? state : { ...state, [kind]: [...state[kind], text] }))} />

    <div className="card target-card">
      <h3 className="card-title">The companies</h3>
      <div className="target-grid">
        {textField("target_company_type")}
        {textField("headcount_range", "e.g. 10-100 employees")}
        <ChipEditor id="icp-field-geography" label={FIELD_LABEL.geography} values={icp.geography} onChange={(next) => set("geography", next)} placeholder="e.g. United Kingdom" disabled={disabled} note={fieldNote("geography")} />
        <ChipEditor id="icp-field-industries" label={FIELD_LABEL.industries} values={icp.industries} onChange={(next) => set("industries", next)} placeholder="e.g. Software" disabled={disabled} note={fieldNote("industries")} />
      </div>
      <h3 className="card-title">The pitch</h3>
      <div className="target-grid">
        {textField("buyer_persona")}
        <div className={`field ${fieldNote("business_problem") ? "is-focused" : ""}`}>
          <label className="field-label" htmlFor="icp-field-business_problem">{FIELD_LABEL.business_problem}</label>
          <textarea id="icp-field-business_problem" rows={2} value={icp.business_problem} disabled={disabled} onChange={(event) => set("business_problem", event.target.value)} />
          {fieldNote("business_problem")}
        </div>
      </div>
    </div>

    <div className="criteria-board">
      <CriteriaColumn list="hard_filters" subtitle="Every one must be proven from evidence. Unproven means you review it." tone="hard" items={icp.hard_filters} disabled={disabled}
        placeholder="Add a must-have" onChange={(next) => set("hard_filters", next)} onRename={(from, to) => renameCriterion("hard_filters", from, to)} focus={focus} onBack={back} onOpened={opened}
        move={{ label: "Make nice-to-have", onMove: (item) => setIcp((state) => ({ ...state, hard_filters: state.hard_filters.filter((value) => value !== item), soft_preferences: [...state.soft_preferences, item] })) }} />
      <CriteriaColumn list="soft_preferences" subtitle="Improves ranking. May be dropped, and recorded, if Koya needs to widen the search." tone="soft" items={icp.soft_preferences} disabled={disabled}
        placeholder="Add a nice-to-have" onChange={(next) => set("soft_preferences", next)} onRename={(from, to) => renameCriterion("soft_preferences", from, to)} focus={focus} onBack={back} onOpened={opened}
        move={{ label: "Make must-have", onMove: (item) => setIcp((state) => ({ ...state, soft_preferences: state.soft_preferences.filter((value) => value !== item), hard_filters: [...state.hard_filters, item] })) }} />
      <CriteriaColumn list="disqualifiers" subtitle="Any one of these rules a company out." tone="reject" items={icp.disqualifiers} disabled={disabled}
        placeholder="Add a reason to reject" onChange={(next) => set("disqualifiers", next)} onRename={(from, to) => renameCriterion("disqualifiers", from, to)} focus={focus} onBack={back} onOpened={opened} />
    </div>

    <div className="approve-panel">
      <div className="approve-facts">
        <div><h3>How Koya will search</h3>
          <ul className="fact-list">
            {hiring
              ? <>
                <li><Icon name="building" size={15} />LinkedIn job ads from the last month, because a must-have is &quot;{hiring}&quot;: every company found is hiring, and its ads are the evidence</li>
                <li><Icon name="search" size={15} />Job location: {locations[0] ?? <em>anywhere</em>}</li>
                <li><Icon name="list" size={15} />Size and headquarters are checked from each company&apos;s LinkedIn record; companies that clearly miss them are filtered out before any research</li>
              </>
              : <>
                <li><Icon name="building" size={15} />LinkedIn company records, up to {limits.max_candidates ?? 30} companies per search</li>
                <li><Icon name="search" size={15} />Location filter: {locations.length ? locations.join(", ") : <em>none, so companies anywhere are considered</em>}</li>
                <li><Icon name="list" size={15} />Size filter: {sizes.length ? `${sizes.join(", ")} employees` : <em>none. Koya could not read a size from &quot;{icp.headcount_range || "blank"}&quot;, so size is checked company by company</em>}</li>
              </>}
            {excludedCount > 0 && <li><Icon name="repeat" size={15} />Skips {excludedCount} compan{excludedCount === 1 ? "y" : "ies"} an earlier run already decided on</li>}
          </ul>
        </div>
        <div><h3>What approving allows</h3>
          <ul className="fact-list">
            <li><Icon name="shield" size={15} />Up to <b>{money(limits.apify_budget_usd ?? 0.5)}</b> of company search (real Apify spend)</li>
            <li><Icon name="sparkle" size={15} />Up to <b>{money(limits.agent_budget_usd ?? 2)}</b> of AI research (an estimate, not a bill)</li>
            <li><Icon name="mail" size={15} />{notificationEmail ? <>An email to {notificationEmail} when it finishes or stops</> : "No email for this run (add one at the top of the page)"}</li>
            <li><Icon name="check" size={15} />Nothing is ever sent to the companies</li>
          </ul>
        </div>
      </div>
      {unchecked > 0 && <p className="approve-note"><Icon name="info" size={15} />{unchecked} assumption{unchecked === 1 ? " is" : "s are"} not checked yet. You can still approve; approving accepts them as they are.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && !error && <p className="form-success" role="status">{notice}</p>}
      <div className="approve-actions">
        <DeleteRunButton runId={runId} label="Discard" redirectTo="/dashboard" />
        <span className="spacer" />
        {dirty && <button type="button" className="button button-secondary" disabled={busy !== null} onClick={save}>{busy === "save" ? "Saving..." : "Save changes"}</button>}
        <button type="button" className="button button-primary button-large" disabled={busy !== null} onClick={approve}>{busy === "approve" ? "Starting research..." : "Approve and start research"}<Icon name="arrow" size={17} /></button>
      </div>
    </div>
  </section>;
}
