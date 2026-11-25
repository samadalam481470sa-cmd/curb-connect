import { PANELS, type EnterpriseArea } from './modules';

export function EnterpriseModuleNav({ area }: { area: EnterpriseArea }) {
  return (
    <nav className="enterprise-nav" aria-label="Enterprise Suite modules">
      {PANELS.map((panel) => (
        <a
          key={panel.id}
          href={panel.id === 'overview' ? '/enterprise' : `/enterprise/${panel.id}`}
          aria-current={panel.id === area ? 'page' : undefined}
          className={panel.id === area ? 'enterprise-nav__active' : ''}
        >
          {panel.label}
        </a>
      ))}
    </nav>
  );
}
