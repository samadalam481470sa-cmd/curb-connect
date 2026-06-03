import type { Project, ProjectStatus, ServiceType } from "./types";

export const serviceOptions: ServiceType[] = [
  "Standard curb",
  "Cut curb",
  "Washout",
  "Retaining wall",
  "Sidewalk tie-in",
  "ADA ramp",
  "Demo and haul-off",
  "Other"
];

export const statusLabels: Record<ProjectStatus, string> = {
  "not-started": "Not started",
  started: "Started",
  finished: "Finished",
  complete: "Complete"
};

export const statusColumns: ProjectStatus[] = ["not-started", "started", "finished", "complete"];

export const sampleProjects: Project[] = [
  {
    id: "project-elmwood-curbs",
    name: "Elmwood Retail Frontage Curbs",
    contractor: "Northline General Contractors",
    subcontractor: "Precision Curb Crew",
    location: "Elmwood Plaza - Lot B",
    service: "Standard curb",
    status: "started",
    priority: "rush",
    startDate: "2026-06-04",
    dueDate: "2026-06-11",
    contractAmount: 18500,
    paidAmount: 6500,
    paymentStatus: "partial",
    notes: "Pour east drive aisle first. GC needs daily photo updates before 3 PM.",
    messages: [
      {
        id: "message-elmwood-1",
        sender: "Contractor",
        body: "Layout is approved. Please confirm crew size and washout plan before mobilizing.",
        createdAt: "2026-06-02T14:30:00.000Z"
      },
      {
        id: "message-elmwood-2",
        sender: "Subcontractor",
        body: "Four-person crew scheduled. Washout pit will be set on the west end by noon.",
        createdAt: "2026-06-02T16:10:00.000Z"
      }
    ],
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-02T16:10:00.000Z"
  },
  {
    id: "project-maple-cut-curbs",
    name: "Maple Street Cut Curb Package",
    contractor: "Canyon Siteworks",
    subcontractor: "Precision Curb Crew",
    location: "Maple Street subdivision entrances",
    service: "Cut curb",
    status: "not-started",
    priority: "waiting-on-info",
    startDate: "2026-06-13",
    dueDate: "2026-06-17",
    contractAmount: 9200,
    paidAmount: 0,
    paymentStatus: "unpaid",
    notes: "Waiting on revised traffic control plan and city inspector window.",
    messages: [
      {
        id: "message-maple-1",
        sender: "System",
        body: "Project created and marked waiting on information.",
        createdAt: "2026-06-03T09:45:00.000Z"
      }
    ],
    createdAt: "2026-06-03T09:45:00.000Z",
    updatedAt: "2026-06-03T09:45:00.000Z"
  },
  {
    id: "project-oak-retaining-wall",
    name: "Oak Basin Retaining Wall Repair",
    contractor: "Summit Builders",
    subcontractor: "Rock Solid Walls",
    location: "Oak Basin detention pond",
    service: "Retaining wall",
    status: "finished",
    priority: "normal",
    startDate: "2026-05-24",
    dueDate: "2026-05-31",
    completedDate: "2026-05-30",
    contractAmount: 27400,
    paidAmount: 12000,
    paymentStatus: "overdue",
    notes: "Substantial completion photos uploaded. Final pay app pending GC approval.",
    messages: [
      {
        id: "message-oak-1",
        sender: "Subcontractor",
        body: "Wall repair is finished. Please review the final invoice and release retainage.",
        createdAt: "2026-05-30T19:05:00.000Z"
      }
    ],
    createdAt: "2026-05-20T15:20:00.000Z",
    updatedAt: "2026-05-30T19:05:00.000Z"
  },
  {
    id: "project-harbor-washout",
    name: "Harbor Warehouse Washout Stations",
    contractor: "Blue Harbor Construction",
    subcontractor: "Precision Curb Crew",
    location: "Harbor Warehouse - Phase 2",
    service: "Washout",
    status: "complete",
    priority: "normal",
    startDate: "2026-05-10",
    dueDate: "2026-05-15",
    completedDate: "2026-05-14",
    contractAmount: 6100,
    paidAmount: 6100,
    paymentStatus: "paid",
    notes: "Paid in full. Keep record for May billing closeout.",
    messages: [
      {
        id: "message-harbor-1",
        sender: "Contractor",
        body: "Payment has cleared. Marking the washout station scope complete.",
        createdAt: "2026-05-18T13:12:00.000Z"
      }
    ],
    createdAt: "2026-05-08T10:00:00.000Z",
    updatedAt: "2026-05-18T13:12:00.000Z"
  }
];
