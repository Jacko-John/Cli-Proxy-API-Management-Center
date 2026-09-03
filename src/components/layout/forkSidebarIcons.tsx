import type { SVGProps } from 'react';
import type { IconProps } from '@/components/ui/icons';

const sidebarSvgProps: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.72,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 10,
  'aria-hidden': 'true',
  focusable: 'false',
};

export function IconSidebarCredentialCenter({ size = 20, ...props }: IconProps) {
  return (
    <svg {...sidebarSvgProps} width={size} height={size} {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <circle cx="16" cy="14" r="2" fill="currentColor" fillOpacity="0.12" />
      <path d="M16 12v4" />
      <path d="M14 14h4" />
    </svg>
  );
}

export function IconSidebarMonitoring({ size = 20, ...props }: IconProps) {
  return (
    <svg {...sidebarSvgProps} width={size} height={size} {...props}>
      <path d="M4 20h16" />
      <rect x="5" y="12.5" width="3.2" height="7.5" rx="0.6" />
      <rect
        x="10.4"
        y="8"
        width="3.2"
        height="12"
        rx="0.6"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <rect x="15.8" y="5" width="3.2" height="15" rx="0.6" />
      <path d="M5 9.5l4-2.7 3.4 2.2 5.6-4.5" />
    </svg>
  );
}
