"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Icon, type IconName } from "./icons";

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/dashboard", label: "Overview", icon: "home" },
  { href: "/history", label: "Research runs", icon: "list" },
  { href: "/settings", label: "Notifications", icon: "bell" },
  { href: "/recycle-bin", label: "Recycle bin", icon: "trash" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/history") return pathname === href || (pathname.startsWith("/runs/") && pathname !== "/runs/new");
  return pathname === href;
}

function Brand({ href = "/" }: { href?: string }) {
  return <Link href={href} className="brand"><span className="brand-mark">K</span><span className="brand-name">Koya Talent<small>Lead research</small></span></Link>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  if (pathname === "/") {
    return <>
      <header className="site-header">
        <Brand />
        <nav className="site-nav" aria-label="Site"><a href="#how-it-works">How it works</a></nav>
        <Link className="button button-primary" href="/dashboard">Open workspace <Icon name="arrow" size={16} /></Link>
      </header>
      {children}
    </>;
  }

  return <div className="workspace">
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="mobile-bar">
      <Brand href="/dashboard" />
      <button className="icon-button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"} /></button>
    </header>
    {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
    <aside id="sidebar" className={`sidebar ${open ? "is-open" : ""}`}>
      <Brand href="/dashboard" />
      <Link href="/runs/new" className="button button-lime sidebar-cta" aria-current={pathname === "/runs/new" ? "page" : undefined}><Icon name="plus" size={17} /> New research</Link>
      <nav aria-label="Workspace">
        {NAV.map((item) => <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}><Icon name={item.icon} size={18} />{item.label}</Link>)}
      </nav>
      <div className="sidebar-note">
        <Icon name="shield" size={18} />
        <p><b>Nothing is ever sent.</b> Koya researches and drafts. You decide what leaves the building.</p>
      </div>
    </aside>
    <main id="main" className="workspace-main">{children}</main>
  </div>;
}
