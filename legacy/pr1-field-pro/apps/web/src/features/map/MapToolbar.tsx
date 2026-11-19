'use client';

import type { ReactNode } from 'react';
import type { DrawTool } from './types';

export interface MapToolbarProps {
  readonly tool: DrawTool;
  readonly onToolChange: (tool: DrawTool) => void;
  readonly tools?: readonly DrawTool[];
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onDelete?: () => void;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly canDelete?: boolean;
  readonly onSuggestOutline?: () => void;
  readonly extra?: ReactNode;
}

const LABELS: Record<DrawTool, string> = {
  pan: 'Pan',
  polygon: 'Draw facet',
  rectangle: 'Rectangle',
  place: 'Place opening',
  select: 'Select',
};

export function MapToolbar({
  tool,
  onToolChange,
  tools = ['pan', 'polygon', 'select'],
  onUndo,
  onRedo,
  onDelete,
  canUndo,
  canRedo,
  canDelete,
  onSuggestOutline,
  extra,
}: MapToolbarProps) {
  return (
    <div className="web-map-toolbar" role="toolbar" aria-label="Map drawing tools">
      {tools.map((t) => (
        <button
          key={t}
          type="button"
          className={tool === t ? 'web-map-tool web-map-tool--active' : 'web-map-tool'}
          aria-pressed={tool === t}
          onClick={() => onToolChange(t)}
        >
          {LABELS[t]}
        </button>
      ))}
      <span className="web-map-toolbar__sep" aria-hidden="true" />
      {onUndo && (
        <button type="button" className="web-map-tool" disabled={!canUndo} onClick={onUndo}>
          Undo
        </button>
      )}
      {onRedo && (
        <button type="button" className="web-map-tool" disabled={!canRedo} onClick={onRedo}>
          Redo
        </button>
      )}
      {onDelete && (
        <button type="button" className="web-map-tool" disabled={!canDelete} onClick={onDelete}>
          Delete
        </button>
      )}
      {onSuggestOutline && (
        <button type="button" className="web-map-tool" onClick={onSuggestOutline}>
          Scan roof
        </button>
      )}
      {extra}
    </div>
  );
}
