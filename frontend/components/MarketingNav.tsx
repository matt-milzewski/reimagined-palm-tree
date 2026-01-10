import Link from 'next/link';
import { useState } from 'react';
import { Button } from './MarketingUI';

const links = [
  { label: 'Product', href: '/#product' },
  { label: 'Sources', href: '/#sources' },
  { label: 'How it works', href: '/#how' },
  { label: 'Use cases', href: '/#use-cases' },
  { label: 'Security', href: '/#security' },
  { label: 'FAQ', href: '/#faq' }
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="marketing-nav">
      <div className="nav-inner">
        <Link href="/" className="logo" onClick={() => setOpen(false)}>
          RAG Readiness Pipeline
        </Link>
        <nav className={open ? 'nav-links open' : 'nav-links'} aria-label="Primary">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link href="/contact" className="nav-link" onClick={() => setOpen(false)}>
            Contact
          </Link>
          <Link href="/login" className="nav-link" onClick={() => setOpen(false)}>
            Log in
          </Link>
        </nav>
        <div className="nav-actions">
          <Button href="/contact" variant="primary">
            Contact us
          </Button>
          <Button href="/login" variant="secondary">
            Log in
          </Button>
          <button
            className={open ? 'nav-toggle open' : 'nav-toggle'}
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
