import Link from "next/link";

import { Icon } from "@/app/components/icons";

export default function Home() {
  return <main className="landing">
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow">Lead research for founders</p>
        <h1>Find the companies.<br /><em>Know why now.</em></h1>
        <p className="lede">Ten qualified leads, each with the evidence from its own website and three outreach emails drafted for you to review. Not another thousand-row spreadsheet.</p>
        <div className="landing-actions">
          <Link className="button button-primary button-large" href="/runs/new">Start a research run <Icon name="arrow" size={17} /></Link>
        </div>
        <ul className="landing-proof">
          <li><b>1 approval</b><span>before anything is spent</span></li>
          <li><b>1 click</b><span>from any claim to its source</span></li>
          <li><b>0 messages</b><span>ever sent on your behalf</span></li>
        </ul>
      </div>
      <div className="preview card" aria-hidden="true">
        <div className="preview-row"><span className="lead-monogram">N</span><div><b>Neural Operations</b><small>London, United Kingdom · 51-200 employees</small></div><span className="pill pill-ok"><span className="pill-dot" />Qualified</span></div>
        <p className="why-now"><span>Why now</span>Hiring three account executives for a new UK sales team.</p>
        <div className="preview-must"><span className="verdict-icon"><Icon name="check" size={12} /></span>Headquartered in the United Kingdom<small>E1</small></div>
        <div className="preview-must"><span className="verdict-icon"><Icon name="check" size={12} /></span>50 to 500 employees<small>E1</small></div>
        <blockquote className="preview-quote"><span className="excerpt-label">E3</span>&ldquo;We are expanding our commercial team across the UK this quarter...&rdquo;</blockquote>
        <div className="progress-bar"><span style={{ width: "70%" }} /></div>
        <small className="muted">7 of 10 qualified · researching the next company</small>
      </div>
    </section>

    <section className="landing-section" id="how-it-works">
      <h2>Every lead has to earn its place.</h2>
      <p className="lede">The research agent can explore. It cannot loosen your criteria, invent evidence, collect personal contact details, or send anything.</p>
      <ol className="feature-grid">
        <li><span>1</span><h3>Describe who you want</h3><p>Plain English. Koya turns it into must-haves and nice-to-haves, shows what it assumed, and waits for your approval before any company search is paid for.</p></li>
        <li><span>2</span><h3>It researches each company</h3><p>Real company records from LinkedIn, then each company&apos;s own website. Every reason is tied to the exact sentence it came from.</p></li>
        <li><span>3</span><h3>You review and export</h3><p>Qualified leads with drafted outreach, the ones that need your judgement, and the rejections with reasons, so you never pay to reject them twice.</p></li>
      </ol>
    </section>
  </main>;
}
