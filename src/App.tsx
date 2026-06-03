import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { resetProjects, loadProjects, saveProjects } from "./storage";
import { serviceOptions, statusColumns, statusLabels } from "./sampleData";
import { formatCurrency, getOpenBalance, getProjectStats, inferPaymentStatus, makeId } from "./projectUtils";
import type { Priority, Project, ProjectMessage, ProjectStatus, ServiceType } from "./types";

type RoleMode = "contractor" | "subcontractor";

interface ProjectFormState {
  name: string;
  contractor: string;
  subcontractor: string;
  location: string;
  service: ServiceType;
  status: ProjectStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
  contractAmount: string;
  notes: string;
}

const emptyProjectForm: ProjectFormState = {
  name: "",
  contractor: "",
  subcontractor: "",
  location: "",
  service: "Standard curb",
  status: "not-started",
  priority: "normal",
  startDate: "",
  dueDate: "",
  contractAmount: "",
  notes: ""
};

const priorityLabels: Record<Priority, string> = {
  normal: "Normal",
  rush: "Rush",
  "waiting-on-info": "Waiting on info"
};

function parseMoney(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value?: string): string {
  if (!value) {
    return "Not set";
  }

  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSystemMessage(body: string): ProjectMessage {
  return {
    id: makeId("message"),
    sender: "System",
    body,
    createdAt: new Date().toISOString()
  };
}

function App() {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [roleMode, setRoleMode] = useState<RoleMode>("contractor");
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [formError, setFormError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [serviceFilter, setServiceFilter] = useState<ServiceType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const stats = useMemo(() => getProjectStats(projects), [projects]);

  const filteredProjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [project.name, project.contractor, project.subcontractor, project.location, project.notes]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesService = serviceFilter === "all" || project.service === serviceFilter;
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;

      return matchesSearch && matchesService && matchesStatus;
    });
  }, [projects, searchTerm, serviceFilter, statusFilter]);

  const upcomingProjects = useMemo(
    () => [...projects].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4),
    [projects]
  );

  function handleProjectFieldChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = event.target;
    setProjectForm((current) => ({ ...current, [name]: value }));
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!projectForm.name.trim() || !projectForm.contractor.trim() || !projectForm.subcontractor.trim()) {
      setFormError("Project name, contractor, and subcontractor are required.");
      return;
    }

    const timestamp = new Date().toISOString();
    const contractAmount = parseMoney(projectForm.contractAmount);
    const initialMessage = projectForm.notes.trim()
      ? [
          {
            id: makeId("message"),
            sender: roleMode === "contractor" ? "Contractor" : "Subcontractor",
            body: `Project notes: ${projectForm.notes.trim()}`,
            createdAt: timestamp
          } satisfies ProjectMessage
        ]
      : [buildSystemMessage("Project created and ready for coordination.")];

    const project: Project = {
      id: makeId("project"),
      name: projectForm.name.trim(),
      contractor: projectForm.contractor.trim(),
      subcontractor: projectForm.subcontractor.trim(),
      location: projectForm.location.trim() || "Location not set",
      service: projectForm.service,
      status: projectForm.status,
      priority: projectForm.priority,
      startDate: projectForm.startDate,
      dueDate: projectForm.dueDate,
      completedDate: projectForm.status === "finished" || projectForm.status === "complete" ? todayIsoDate() : undefined,
      contractAmount,
      paidAmount: 0,
      paymentStatus: inferPaymentStatus(contractAmount, 0, projectForm.dueDate),
      notes: projectForm.notes.trim(),
      messages: initialMessage,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    setProjects((current) => [project, ...current]);
    setProjectForm(emptyProjectForm);
    setFormError("");
  }

  function updateProjectStatus(projectId: string, status: ProjectStatus) {
    const timestamp = new Date().toISOString();
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        return {
          ...project,
          status,
          completedDate:
            status === "finished" || status === "complete" ? project.completedDate ?? todayIsoDate() : undefined,
          updatedAt: timestamp,
          messages: [buildSystemMessage(`Status changed to ${statusLabels[status]}.`), ...project.messages]
        };
      })
    );
  }

  function recordPayment(projectId: string) {
    const amount = parseMoney(paymentDrafts[projectId] ?? "");

    if (amount <= 0) {
      return;
    }

    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        const paidAmount = project.paidAmount + amount;
        const timestamp = new Date().toISOString();
        const paymentStatus = inferPaymentStatus(project.contractAmount, paidAmount, project.dueDate);
        const shouldCloseProject = paymentStatus === "paid" && project.status === "finished";

        return {
          ...project,
          paidAmount,
          paymentStatus,
          status: shouldCloseProject ? "complete" : project.status,
          completedDate: shouldCloseProject ? project.completedDate ?? todayIsoDate() : project.completedDate,
          updatedAt: timestamp,
          messages: [
            {
              id: makeId("message"),
              sender: "System",
              body: `Payment logged: ${formatCurrency(amount)}. Open balance is ${formatCurrency(
                Math.max(project.contractAmount - paidAmount, 0)
              )}.`,
              createdAt: timestamp
            },
            ...project.messages
          ]
        };
      })
    );
    setPaymentDrafts((current) => ({ ...current, [projectId]: "" }));
  }

  function addMessage(projectId: string) {
    const draft = (messageDrafts[projectId] ?? "").trim();

    if (!draft) {
      return;
    }

    const timestamp = new Date().toISOString();
    const message: ProjectMessage = {
      id: makeId("message"),
      sender: roleMode === "contractor" ? "Contractor" : "Subcontractor",
      body: draft,
      createdAt: timestamp
    };

    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              updatedAt: timestamp,
              messages: [message, ...project.messages]
            }
          : project
      )
    );
    setMessageDrafts((current) => ({ ...current, [projectId]: "" }));
  }

  function handleResetDemoData() {
    setProjects(resetProjects());
    setSearchTerm("");
    setServiceFilter("all");
    setStatusFilter("all");
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Contractor and subcontractor command center</p>
          <h1>Curb Connect</h1>
          <p className="hero-copy">
            Track curb, washout, cut curb, retaining wall, and site concrete work from not started to
            paid complete. Keep project messages, due dates, and payment records in one place.
          </p>
          <div className="hero-actions" aria-label="Choose app role">
            <button
              className={roleMode === "contractor" ? "active" : ""}
              type="button"
              onClick={() => setRoleMode("contractor")}
            >
              Contractor view
            </button>
            <button
              className={roleMode === "subcontractor" ? "active" : ""}
              type="button"
              onClick={() => setRoleMode("subcontractor")}
            >
              Subcontractor view
            </button>
          </div>
        </div>
        <aside className="hero-panel">
          <span>Open balance</span>
          <strong>{formatCurrency(stats.openBalance)}</strong>
          <small>{stats.finished + stats.started + stats.notStarted} active jobs need coordination.</small>
        </aside>
      </section>

      <section className="stats-grid" aria-label="Project summary">
        <article>
          <span>Total projects</span>
          <strong>{stats.totalProjects}</strong>
          <small>{formatCurrency(stats.contractTotal)} under contract</small>
        </article>
        <article>
          <span>Not started</span>
          <strong>{stats.notStarted}</strong>
          <small>Waiting on schedule, scope, or approvals</small>
        </article>
        <article>
          <span>Started</span>
          <strong>{stats.started}</strong>
          <small>Crews are active or mobilized</small>
        </article>
        <article>
          <span>Finished</span>
          <strong>{stats.finished}</strong>
          <small>Ready for review, invoice, or closeout</small>
        </article>
        <article>
          <span>Paid complete</span>
          <strong>{stats.complete}</strong>
          <small>{formatCurrency(stats.paidTotal)} collected</small>
        </article>
      </section>

      <section className="workspace-grid">
        <form className="project-form card" onSubmit={handleCreateProject}>
          <div className="section-heading">
            <p className="eyebrow">New work order</p>
            <h2>Add a project</h2>
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}

          <label>
            Project name
            <input
              name="name"
              value={projectForm.name}
              onChange={handleProjectFieldChange}
              placeholder="Example: Lot 12 cut curb package"
            />
          </label>

          <div className="two-column">
            <label>
              Contractor
              <input
                name="contractor"
                value={projectForm.contractor}
                onChange={handleProjectFieldChange}
                placeholder="General contractor"
              />
            </label>
            <label>
              Subcontractor
              <input
                name="subcontractor"
                value={projectForm.subcontractor}
                onChange={handleProjectFieldChange}
                placeholder="Concrete/curb crew"
              />
            </label>
          </div>

          <label>
            Location
            <input
              name="location"
              value={projectForm.location}
              onChange={handleProjectFieldChange}
              placeholder="Site, phase, or address"
            />
          </label>

          <div className="two-column">
            <label>
              Scope option
              <select name="service" value={projectForm.service} onChange={handleProjectFieldChange}>
                {serviceOptions.map((service) => (
                  <option key={service} value={service}>
                    {service}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" value={projectForm.status} onChange={handleProjectFieldChange}>
                {statusColumns.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="three-column">
            <label>
              Priority
              <select name="priority" value={projectForm.priority} onChange={handleProjectFieldChange}>
                {(Object.keys(priorityLabels) as Priority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabels[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input name="startDate" type="date" value={projectForm.startDate} onChange={handleProjectFieldChange} />
            </label>
            <label>
              Due
              <input name="dueDate" type="date" value={projectForm.dueDate} onChange={handleProjectFieldChange} />
            </label>
          </div>

          <label>
            Contract amount
            <input
              name="contractAmount"
              type="number"
              min="0"
              step="100"
              value={projectForm.contractAmount}
              onChange={handleProjectFieldChange}
              placeholder="0"
            />
          </label>

          <label>
            Scope notes or first message
            <textarea
              name="notes"
              value={projectForm.notes}
              onChange={handleProjectFieldChange}
              placeholder="Add washout needs, curb footage, forms, inspector notes, retainage, or payment terms."
              rows={4}
            />
          </label>

          <button className="primary-button" type="submit">
            Create project record
          </button>
        </form>

        <section className="card schedule-card">
          <div className="section-heading">
            <p className="eyebrow">Upcoming and due</p>
            <h2>Priority board</h2>
          </div>
          <div className="timeline-list">
            {upcomingProjects.map((project) => (
              <article key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.service} at {project.location}</span>
                </div>
                <span className={`priority-pill ${project.priority}`}>{priorityLabels[project.priority]}</span>
                <small>Due {formatDate(project.dueDate)}</small>
              </article>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={handleResetDemoData}>
            Reset demo records
          </button>
        </section>
      </section>

      <section className="card filters-card">
        <div>
          <p className="eyebrow">Records</p>
          <h2>Find project communication and payment history</h2>
        </div>
        <div className="filters">
          <input
            aria-label="Search projects"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by job, company, site, or notes"
          />
          <select
            aria-label="Filter by service"
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value as ServiceType | "all")}
          >
            <option value="all">All scope options</option>
            {serviceOptions.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ProjectStatus | "all")}
          >
            <option value="all">All statuses</option>
            {statusColumns.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="kanban" aria-label="Project status board">
        {statusColumns.map((status) => {
          const columnProjects = filteredProjects.filter((project) => project.status === status);

          return (
            <article className="kanban-column" key={status}>
              <div className="column-header">
                <h3>{statusLabels[status]}</h3>
                <span>{columnProjects.length}</span>
              </div>

              <div className="project-stack">
                {columnProjects.length === 0 ? (
                  <p className="empty-state">No records match these filters.</p>
                ) : (
                  columnProjects.map((project) => (
                    <article className="project-card" key={project.id}>
                      <div className="project-card-header">
                        <div>
                          <span className="scope-pill">{project.service}</span>
                          <h4>{project.name}</h4>
                          <p>{project.location}</p>
                        </div>
                        <span className={`payment-pill ${project.paymentStatus}`}>{project.paymentStatus}</span>
                      </div>

                      <dl className="project-meta">
                        <div>
                          <dt>Contractor</dt>
                          <dd>{project.contractor}</dd>
                        </div>
                        <div>
                          <dt>Subcontractor</dt>
                          <dd>{project.subcontractor}</dd>
                        </div>
                        <div>
                          <dt>Start</dt>
                          <dd>{formatDate(project.startDate)}</dd>
                        </div>
                        <div>
                          <dt>Due</dt>
                          <dd>{formatDate(project.dueDate)}</dd>
                        </div>
                      </dl>

                      <div className="money-row">
                        <div>
                          <span>Contract</span>
                          <strong>{formatCurrency(project.contractAmount)}</strong>
                        </div>
                        <div>
                          <span>Paid</span>
                          <strong>{formatCurrency(project.paidAmount)}</strong>
                        </div>
                        <div>
                          <span>Balance</span>
                          <strong>{formatCurrency(getOpenBalance(project))}</strong>
                        </div>
                      </div>

                      <div className="card-controls">
                        <label>
                          Move status
                          <select
                            value={project.status}
                            onChange={(event) => updateProjectStatus(project.id, event.target.value as ProjectStatus)}
                          >
                            {statusColumns.map((nextStatus) => (
                              <option key={nextStatus} value={nextStatus}>
                                {statusLabels[nextStatus]}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          Log payment
                          <div className="inline-action">
                            <input
                              aria-label={`Payment amount for ${project.name}`}
                              type="number"
                              min="0"
                              step="100"
                              value={paymentDrafts[project.id] ?? ""}
                              onChange={(event) =>
                                setPaymentDrafts((current) => ({ ...current, [project.id]: event.target.value }))
                              }
                              placeholder="Amount"
                            />
                            <button type="button" onClick={() => recordPayment(project.id)}>
                              Save
                            </button>
                          </div>
                        </label>
                      </div>

                      <div className="messages">
                        <div className="messages-header">
                          <strong>Communication log</strong>
                          <span>{project.messages.length} entries</span>
                        </div>
                        <div className="message-list">
                          {project.messages.slice(0, 3).map((message) => (
                            <article key={message.id} className="message">
                              <div>
                                <strong>{message.sender}</strong>
                                <span>{formatDateTime(message.createdAt)}</span>
                              </div>
                              <p>{message.body}</p>
                            </article>
                          ))}
                        </div>
                        <label>
                          Add update as {roleMode === "contractor" ? "contractor" : "subcontractor"}
                          <textarea
                            value={messageDrafts[project.id] ?? ""}
                            onChange={(event) =>
                              setMessageDrafts((current) => ({ ...current, [project.id]: event.target.value }))
                            }
                            placeholder="Ask for schedule, mark a blocker, confirm completion, or add invoice details."
                            rows={3}
                          />
                        </label>
                        <button className="secondary-button" type="button" onClick={() => addMessage(project.id)}>
                          Add communication
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

export default App;
