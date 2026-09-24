"use client";

import { useState } from "react";

import type { AssumptionTarget } from "@/lib/checks/icp";

import { Icon } from "./icons";

export type AssumptionStatus = "open" | "right" | "changed" | "removed";
export type AssumptionItem = { id: number; text: string; original: string; status: AssumptionStatus; addedAs?: CriterionKind };
export type CriterionKind = "hard_filters" | "soft_preferences" | "disqualifiers";

const KIND_LABEL: Record<CriterionKind, string> = { hard_filters: "Must have", soft_preferences: "Nice to have", disqualifiers: "Reject if" };

function EditAssumption({ item, onSave, onCancel }: { item: AssumptionItem; onSave: (text: string, addAs: CriterionKind | null) => void; onCancel: () => void }) {
  const [text, setText] = useState(item.text);
  const [addAs, setAddAs] = useState<CriterionKind | null>(item.addedAs ?? null);
  return <li className="assumption is-editing">
    <label className="sr-only" htmlFor={`assumption-edit-${item.id}`}>What is actually true</label>
    <textarea id={`assumption-edit-${item.id}`} rows={2} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
    <div className="assumption-use">
      <span>Also use it as</span>
      <div className="segmented small" role="radiogroup" aria-label="Also use it as">
        <button type="button" role="radio" aria-checked={addAs === null} onClick={() => setAddAs(null)}>Just a note</button>
        {(Object.keys(KIND_LABEL) as CriterionKind[]).map((kind) => <button key={kind} type="button" role="radio" aria-checked={addAs === kind} onClick={() => setAddAs(kind)}>{KIND_LABEL[kind]}</button>)}
      </div>
    </div>
    <small className="muted">{addAs ? `It will be added to ${KIND_LABEL[addAs]} below, so it changes who Koya finds.` : "A note records what you told Koya but does not change the search. Pick a criterion if it should."}</small>
    <div className="assumption-actions">
      <button type="button" className="button button-primary button-small" disabled={!text.trim()} onClick={() => onSave(text.trim(), addAs)}>Save</button>
      <button type="button" className="button button-ghost button-small" onClick={onCancel}>Cancel</button>
    </div>
  </li>;
}

/**
 * The criteria and fields an assumption affects, each a button that jumps to
 * it and opens it for editing, so a founder never hunts through the columns.
 */
function Affects({ item, targets, labelFor, onJump, disabled }: { item: AssumptionItem; targets: AssumptionTarget[]; labelFor: (target: AssumptionTarget) => string; onJump: (target: AssumptionTarget, item: AssumptionItem) => void; disabled: boolean }) {
  if (targets.length === 0) {
    return item.status === "open" ? <small className="affects muted">Not tied to a criterion. Use Change to add one if it should affect the search.</small> : null;
  }
  return <div className="affects">
    <span>{targets.length === 1 ? "Affects" : "Affects these"}</span>
    {targets.map((target) => <button key={labelFor(target)} type="button" className="affects-chip" disabled={disabled} onClick={() => onJump(target, item)} title="Go to it and edit">{labelFor(target)}<Icon name="arrow" size={12} /></button>)}
  </div>;
}

export function AssumptionList({ items, disabled, onChange, onAddCriterion, targetsFor, labelFor, onJump }: {
  items: AssumptionItem[];
  disabled: boolean;
  onChange: (next: AssumptionItem[]) => void;
  onAddCriterion: (kind: CriterionKind, text: string) => void;
  targetsFor: (text: string) => AssumptionTarget[];
  labelFor: (target: AssumptionTarget) => string;
  onJump: (target: AssumptionTarget, item: AssumptionItem) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const live = items.filter((item) => item.status !== "removed");
  const removed = items.filter((item) => item.status === "removed");
  const open = live.filter((item) => item.status === "open").length;
  if (items.length === 0) return null;
  const update = (id: number, patch: Partial<AssumptionItem>) => onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return <section className={`assumptions ${open === 0 ? "is-done" : ""}`} aria-labelledby="assumptions-title">
    <div className="assumptions-head">
      <Icon name={open === 0 ? "check" : "alert"} size={18} />
      <div>
        <h3 id="assumptions-title">{open === 0 ? "Every assumption checked" : `Koya had to assume ${live.length === 1 ? "one thing" : `${live.length} things`}`}</h3>
        <p>These are guesses Koya made to fill gaps in your brief. On their own they do not change the search; the criteria below do. Mark each one right, remove it, or use the link under it to jump straight to the criterion it affects and edit it there.</p>
      </div>
      <div className="assumptions-progress">
        <span>{live.length - open} of {live.length} checked</span>
        {open > 0 && !disabled && <button type="button" className="button button-secondary button-small" onClick={() => onChange(items.map((item) => (item.status === "open" ? { ...item, status: "right" } : item)))}><Icon name="check" size={14} />All look right</button>}
      </div>
    </div>
    <ul>
      {live.map((item) => {
        if (editing === item.id) {
          return <EditAssumption key={item.id} item={item} onCancel={() => setEditing(null)} onSave={(text, addAs) => {
            if (addAs && addAs !== item.addedAs) onAddCriterion(addAs, text);
            update(item.id, { text, status: text === item.original && !addAs ? "right" : "changed", addedAs: addAs ?? item.addedAs });
            setEditing(null);
          }} />;
        }
        if (item.status === "open") {
          return <li key={item.id} id={`assumption-${item.id}`} className="assumption is-open">
            <div className="assumption-body"><p>{item.text}</p><Affects item={item} targets={targetsFor(item.text)} labelFor={labelFor} onJump={onJump} disabled={disabled} /></div>
            {!disabled && <div className="assumption-actions">
              <button type="button" className="button button-secondary button-small" onClick={() => update(item.id, { status: "right" })}><Icon name="check" size={14} />Right</button>
              <button type="button" className="button button-ghost button-small" onClick={() => setEditing(item.id)} title="Reword it, or turn it into a new criterion"><Icon name="edit" size={14} />Change</button>
              <button type="button" className="button button-ghost button-small" onClick={() => update(item.id, { status: "removed" })}><Icon name="close" size={14} />Remove</button>
            </div>}
          </li>;
        }
        return <li key={item.id} id={`assumption-${item.id}`} className={`assumption is-${item.status}`}>
          <Icon name={item.status === "right" ? "check" : "edit"} size={15} className="assumption-mark" />
          <div className="assumption-body">
            <p>{item.text}{item.status === "changed" && <small>Changed by you{item.addedAs ? ` · added to ${KIND_LABEL[item.addedAs]}` : ""}</small>}</p>
            <Affects item={item} targets={targetsFor(item.text)} labelFor={labelFor} onJump={onJump} disabled={disabled} />
          </div>
          {!disabled && <div className="assumption-actions">
            {item.status === "changed" && <button type="button" className="link-button" onClick={() => setEditing(item.id)}>Edit</button>}
            <button type="button" className="link-button" onClick={() => update(item.id, { status: "open", text: item.original, addedAs: undefined })}>Undo</button>
          </div>}
        </li>;
      })}
    </ul>
    {removed.length > 0 && <details className="assumptions-removed">
      <summary>Removed ({removed.length})</summary>
      <ul>{removed.map((item) => <li key={item.id}><span>{item.original}</span>{!disabled && <button type="button" className="link-button" onClick={() => update(item.id, { status: "open", text: item.original })}>Restore</button>}</li>)}</ul>
    </details>}
  </section>;
}
