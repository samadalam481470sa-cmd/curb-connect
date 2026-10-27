import type { ReactNode, SVGProps } from 'react';

/**
 * PLT-012 icon convention: 24-unit grid, 1.75 stroke, round caps, `currentColor`, always
 * decorative (`aria-hidden`). Meaning is carried by adjacent text or by the owning control's
 * accessible name, never by the icon alone. Drawn for Fieldline; not taken from an icon set.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function Icon({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
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

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.25v.25" />
  </Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.75V8" />
  </Icon>
);
export const ErrorIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" />
    <path d="M12 7.5v5.5M12 16.25v.25" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);
export const SortIcon = ({
  direction,
  ...p
}: IconProps & { direction: 'asc' | 'desc' | 'none' }) => (
  <Icon {...p}>
    {direction !== 'desc' && <path d="M8 10l4-4 4 4" opacity={direction === 'none' ? 0.45 : 1} />}
    {direction !== 'asc' && <path d="M8 14l4 4 4-4" opacity={direction === 'none' ? 0.45 : 1} />}
  </Icon>
);
export const RulerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 16.5l13-13 4 4-13 13z" />
    <path d="M7 13l1.5 1.5M10 10l2 2M13 7l1.5 1.5" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
  </Icon>
);
export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M3.5 16l5-5 4 4 3-3 5 5" />
  </Icon>
);
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Icon>
);
export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Icon>
);
export const RoofIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12L12 4.5 21.5 12" />
    <path d="M5.5 10v9.5h13V10" />
  </Icon>
);
export const CurbIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 9h9v4h10M2.5 16.5h19" />
    <path d="M14 13v3.5M8 9V5.5" strokeDasharray="1.5 2" />
  </Icon>
);
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
  </Icon>
);
export const SpinnerIcon = (p: IconProps) => (
  <Icon {...p} className={['fl-spin', p.className].filter(Boolean).join(' ')}>
    <path d="M12 3a9 9 0 019 9" />
  </Icon>
);
