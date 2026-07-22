export function RobotGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6a2 2 0 0 0-2 2v2a3 3 0 0 0-3 3 3 3 0 0 0 3 3v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
      <circle cx="9" cy="11.5" r="1" />
      <circle cx="15" cy="11.5" r="1" />
      <path d="M8 17h8" />
    </svg>
  );
}

export function FleetGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M7.4 8.5h-2A2.4 2.4 0 0 0 3 10.9v4.2a2.4 2.4 0 0 0 2.4 2.4h2" />
      <path d="M6.3 8.5V6.85" />
      <circle cx="6.3" cy="5.85" r=".62" fill="currentColor" stroke="none" />
      <circle cx="4.85" cy="12" r=".66" fill="currentColor" stroke="none" />
      <path d="M4.4 14.75h1.2" />
      <path d="M16.6 8.5h2a2.4 2.4 0 0 1 2.4 2.4v4.2a2.4 2.4 0 0 1-2.4 2.4h-2" />
      <path d="M17.7 8.5V6.85" />
      <circle cx="17.7" cy="5.85" r=".62" fill="currentColor" stroke="none" />
      <circle cx="19.15" cy="12" r=".66" fill="currentColor" stroke="none" />
      <path d="M18.4 14.75h1.2" />
      <rect x="7" y="6.2" width="10" height="13.6" rx="2.6" />
      <path d="M12 6.2V3.75" />
      <circle cx="12" cy="2.7" r=".74" fill="currentColor" stroke="none" />
      <circle cx="10.25" cy="11.15" r=".74" fill="currentColor" stroke="none" />
      <circle cx="13.75" cy="11.15" r=".74" fill="currentColor" stroke="none" />
      <path d="M10.15 15.55h3.7" />
    </svg>
  );
}
