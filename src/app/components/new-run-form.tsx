"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./icons";

const EXAMPLES = [
  "UK B2B SaaS companies with 50 to 500 people that are hiring sales or revenue roles, where extra specialist talent would ease a scaling problem.",
  "US digital marketing agencies with 10 to 50 employees that run client campaigns manually and could use AI automation support.",
  "Commercial cleaning companies in London with 20 to 200 staff that coordinate crews and schedules across many client sites.",
];

// Loose on purpose: these only nudge the founder, the ICP step does the real work.
const CHECKS = [
  { key: "where", label: "Where", hint: "a country or city", test: /\b(uk|u\.k\.|united kingdom|britain|england|london|manchester|us|usa|united states|america|canada|europe|eu|germany|france|spain|netherlands|ireland|australia|india|nigeria|lagos|kenya|south africa|dubai|uae|singapore|remote|based in|headquartered)\b/i },
  { key: "what", label: "What kind of company", hint: "industry or business model", test: /\b(saas|software|b2b|b2c|agenc(y|ies)|startups?|marketplaces?|e-?commerce|fintech|healthtech|clinics?|firms?|cleaning|manufactur\w*|retail\w*|consultanc(y|ies)|platforms?|logistics|restaurants?|studios?|companies|businesses)\b/i },
  { key: "size", label: "How big", hint: "e.g. 10 to 100 people", test: /(\d[\d,]*\s*(?:-|–|to)\s*\d[\d,]*\s*(?:people|employees|staff|person))|(\b\d[\d,]*\+?\s*(?:people|employees|staff))|\b(small|mid-?size[d]?|medium-?sized|enterprise|seed|series [a-d])\b/i },
  { key: "why", label: "Why now", hint: "optional: hiring, funding, growth", test: /\b(hiring|raised|funding|funded|launch\w*|expand\w*|growing|growth|scaling|new market|recently|opening)\b/i },
] as const;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewRunForm({ defaultEmail }: { defaultEmail: string | null }) {
  const router = useRouter();
  const token = useRef<string>("");
  const [objective, setObjective] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const covered = CHECKS.map((check) => ({ ...check, done: check.test.test(objective) }));
  const tooShort = objective.trim().length < 20;
  const emailInvalid = email.trim() !== "" && !EMAIL_SHAPE.test(email.trim());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooShort) { setError("Describe the companies you want in at least 20 characters."); return; }
    if (emailInvalid) { setError("That email address does not look right. Fix it or leave it empty."); return; }
    setBusy(true);
    setError("");
    token.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, submitToken: token.current, notificationEmail: email.trim() }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) { setError(data.error ?? "The run could not be created. Nothing was spent."); setBusy(false); return; }
      router.push(`/runs/${data.id}`);
    } catch {
      setError("The connection dropped. Nothing was spent; try again.");
      setBusy(false);
    }
  }

  return <form className="brief-form card" onSubmit={submit}>
    <label htmlFor="objective" className="field-label">Who should Koya find for you?</label>
    <p className="field-help">Write it the way you would brief a researcher. Koya turns it into criteria you approve before any company search runs.</p>
    <textarea id="objective" name="objective" value={objective} onChange={(event) => setObjective(event.target.value)} rows={5} maxLength={2000} required placeholder="Example: UK B2B SaaS companies with 50 to 500 people that are hiring sales roles..." />
    <ul className="brief-checks" aria-label="What your brief covers">
      {covered.map((check) => <li key={check.key} className={check.done ? "is-done" : ""}><span className="check-mark">{check.done ? <Icon name="check" size={13} /> : null}</span><b>{check.label}</b><small>{check.hint}</small></li>)}
    </ul>
    <div className="examples">
      <span>Or start from an example:</span>
      {EXAMPLES.map((example) => <button key={example} type="button" className="example-chip" onClick={() => setObjective(example)}>{example.split(" with ")[0]}</button>)}
    </div>
    <div className="notify-row">
      <label className="field" htmlFor="run-email">
        <span className="field-label"><Icon name="bell" size={15} /> Email updates for this run to</span>
        <input id="run-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" aria-invalid={emailInvalid} />
      </label>
      <small className={emailInvalid ? "form-hint-error" : "muted"}>
        {emailInvalid
          ? "That does not look like an email address yet."
          : defaultEmail
            ? <>Prefilled with your workspace default. Change it to send this run&apos;s updates to someone else; the default stays as it is. Leave empty for no email.</>
            : <>Koya emails this address when the run finishes or stops. Leave empty for no email, or set a default for every run in <Link href="/settings">Notifications</Link>.</>}
      </small>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions">
      <p className="muted small">Drafting criteria costs a few cents of AI. No company search runs until you approve.</p>
      <button className="button button-primary" disabled={busy}>{busy ? "Starting..." : "Draft my criteria"} <Icon name="arrow" size={16} /></button>
    </div>
  </form>;
}
