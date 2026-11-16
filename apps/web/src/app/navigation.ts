import { Activity, LayoutDashboard, type LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar navigation. Only routes that are actually implemented are listed;
 * business modules are added here as each phase delivers them.
 */
export const navigation: NavSection[] = [
  {
    label: 'Platform',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard },
      { label: 'System status', to: '/system/status', icon: Activity },
    ],
  },
];
