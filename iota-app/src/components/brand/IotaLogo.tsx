import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const IotaLogo: React.FC<{ className?: string; showWordmark?: boolean }> = ({
  className,
  showWordmark = false,
}) => (
  <div className={cn('flex items-center gap-3', className)} aria-label="Iota">
    <svg
      className="h-9 w-9 shrink-0"
      viewBox="0 0 48 48"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="iota-logo-core" x1="10" x2="38" y1="9" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#47BFFF" />
          <stop offset="0.52" stopColor="#AA3BFF" />
          <stop offset="1" stopColor="#08060D" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="10" fill="#08060D" />
      <path
        d="M12 25.5C16.2 16.7 28.5 12.4 37 17.1"
        stroke="#47BFFF"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M36 22.5C31.8 31.3 19.5 35.6 11 30.9"
        stroke="#AA3BFF"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path d="M24 13V35" stroke="url(#iota-logo-core)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="24" cy="9.5" r="3.5" fill="#47BFFF" />
      <circle cx="38" cy="18" r="3" fill="#F5F1FF" />
      <circle cx="10" cy="31" r="3" fill="#F5F1FF" />
      <circle cx="24" cy="24" r="4.5" fill="#AA3BFF" stroke="#F5F1FF" strokeWidth="2" />
    </svg>
    {showWordmark && (
      <div className="leading-none">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-iota-heading">Iota</div>
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-iota-text/50">Engine</div>
      </div>
    )}
  </div>
);
