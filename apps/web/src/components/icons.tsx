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

export const BuildIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 20h18" />
    <path d="M5 20V10l7-5 7 5v10" />
    <path d="M9 20v-6h6v6" />
    <path d="M12 5V2.5M15.5 3.5l-1 1" />
  </Svg>
);
export const PriceTagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z" />
    <circle cx="8" cy="8.5" r="1.4" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);

/** Grass and landscaping icon shared by the Home launch tile and navigation. */
export const LawnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21v-9M12 15L7 9M12 16l5-7M7 21c-3-3-3-7-2-10M17 21c3-3 3-7 2-10" />
    <path d="M4 21h16M8 7c-1-1-1-2-1-3M16 7c1-1 1-2 1-3" />
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
  build: BuildIcon,
  lawn: LawnIcon,
};

export function NavIcon({ name, size = 20 }: { name?: string; size?: number }) {
  const Icon = (name && NAV_ICONS[name]) || MoreIcon;
  return <Icon size={size} />;
}
