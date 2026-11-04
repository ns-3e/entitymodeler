export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="3" fill="var(--primary)" />
      <rect x="6.5" y="7.5" width="11" height="7.5" fill="var(--on-primary)" />
      <rect x="14.5" y="17.5" width="11" height="7.5" fill="var(--accent)" />
      <path d="M12 15v6.2h2.5" stroke="var(--on-primary)" strokeWidth="1.5" strokeLinecap="square" fill="none" />
    </svg>
  );
}
