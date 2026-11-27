import { Drawer } from '@fieldline/ui';
import { useState, type ReactNode } from 'react';

export function FinanceActivityPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside
        className="enterprise-panel enterprise-finance-activity"
        aria-label="Activity and exceptions"
      >
        <h2>Activity and exceptions</h2>
        {children}
      </aside>
      <button
        className="enterprise-finance-activity-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Activity and exceptions
      </button>
      <Drawer title="Activity and exceptions" open={open} onClose={() => setOpen(false)}>
        <div className="enterprise-suite enterprise-finance-activity-drawer">{children}</div>
      </Drawer>
    </>
  );
}
