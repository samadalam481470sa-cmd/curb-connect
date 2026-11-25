import { PANELS, panelHref, type EnterpriseArea } from './modules';

export function EnterpriseModuleNav({ area }: { area: EnterpriseArea }) {
  return (
    <nav className="enterprise-nav" aria-label="Enterprise Suite modules">
      {PANELS.map((panel) => (
        <a
          key={panel.id}
          href={panelHref(panel)}
          aria-current={panel.id === area ? 'page' : undefined}
          className={panel.id === area ? 'enterprise-nav__active' : ''}
        >
          {panel.label}
        </a>
      ))}
    </nav>
  );
}
