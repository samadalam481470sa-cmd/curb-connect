// Saved feasibility projects: the list a builder flips between. Self-contained: it fetches
// nothing itself — the parent passes the projects and owns the API calls (list, save, load,
// delete). Profit is an estimate from the saved inputs; the summary was computed by the
// client at save time (see the contracts note on 'client-computed').
import type { SavedLandFeasibilityProject } from '@fieldline/contracts';

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n) >= 1e6 ? `${(Math.abs(n) / 1e6).toFixed(2)}M` : Math.round(Math.abs(n)).toLocaleString()}`;

export function SavedFeasibilityProjects({
  projects,
  onLoad,
  onDelete,
  onSave,
  busy = false,
}: {
  projects: SavedLandFeasibilityProject[];
  /** Load a saved project into the feasibility form. */
  onLoad: (project: SavedLandFeasibilityProject) => void;
  /** Delete a saved project by id. */
  onDelete: (id: string) => void;
  /** Save the current run as a new project (the parent names it and posts it). */
  onSave: () => void;
  busy?: boolean;
}) {
  return (
    <div className="wb-card">
      <h3>Saved feasibility projects</h3>
      <p className="wb-muted">
        Save this run to come back to it later instead of re-entering the parcel. Profit is an
        estimate from the saved inputs.
      </p>
      <div className="wb-actions">
        <button type="button" className="hs-pill" onClick={onSave} disabled={busy}>
          Save current
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="wb-muted">No saved feasibility projects yet</p>
      ) : (
        <div className="wb-table-wrap">
          <table className="wb-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Acres</th>
                <th>Lots</th>
                <th>Profit (estimate)</th>
                <th>
                  <span className="wb-muted">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.summary.acres.toFixed(2)}</td>
                  <td>{p.summary.lotCount}</td>
                  <td>{money(p.summary.profit)}</td>
                  <td>
                    <div className="wb-actions">
                      <button
                        type="button"
                        className="hs-pill"
                        onClick={() => onLoad(p)}
                        disabled={busy}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="hs-pill"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => onDelete(p.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
