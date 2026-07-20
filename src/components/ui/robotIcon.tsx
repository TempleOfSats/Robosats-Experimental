import type { SVGProps } from "react";

export function RobotIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6a2 2 0 0 0-2 2v2a3 3 0 0 0-3 3 3 3 0 0 0 3 3v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
      <circle cx="9" cy="11.5" r="1" />
      <circle cx="15" cy="11.5" r="1" />
      <path d="M8 17h8" />
    </svg>
  );
}
