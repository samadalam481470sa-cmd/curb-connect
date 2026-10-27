import {
  CurbIcon,
  DocumentIcon,
  HomeIcon,
  MoreIcon,
  RoofIcon,
  type IconProps,
} from '@fieldline/ui';
import type { ReactNode } from 'react';

// Navigation icons missing from @fieldline/ui, drawn on the same convention: 24-unit grid, 1.75
// stroke, currentColor, decorative only (the link text carries the meaning).
function Svg({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const InboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13l2.5-8h11L20 13v6H4z" />
    <path d="M4 13h4.5l1 2h5l1-2H20" />
  </Svg>
);
export const BoardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.5 4v16M14.5 4v10" />
  </Svg>
);
export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M7 16v-4M12 16V7M17 16v-6" />
  </Svg>
);
export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <path d="M15.5 5.8a3 3 0 010 5.4M17.5 14.8c1.6.6 2.7 2 3 4.2" />
  </Svg>
);
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const CloudOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M8.5 8.6A5 5 0 007 18h10" />
    <path d="M11 6.2A5 5 0 0117.6 10H18a3.5 3.5 0 012.3 6.1" />
  </Svg>
);

const NAV_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  home: HomeIcon,
  roof: RoofIcon,
  curb: CurbIcon,
  inbox: InboxIcon,
  board: BoardIcon,
  document: DocumentIcon,
  receipt: ReceiptIcon,
  chart: ChartIcon,
  people: PeopleIcon,
  settings: SettingsIcon,
};

export function NavIcon({ name, size = 20 }: { name?: string; size?: number }) {
  const Icon = (name && NAV_ICONS[name]) || MoreIcon;
  return <Icon size={size} />;
}
