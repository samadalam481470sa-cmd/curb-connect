'use client';

import { memo } from 'react';
import type { HouseLayout, Room } from './layout';

const M = 6; // margin in feet around the plan for dimension lines

function RoomRect({
  room,
  active,
  onSelect,
}: {
  room: Room;
  active: boolean;
  onSelect?: (id: string) => void;
}) {
  const small = Math.min(room.w, room.h);
  const fs = Math.max(0.8, Math.min(1.5, small / 6));
  const area = Math.round(room.w * room.h);
  return (
    <g>
      <rect
        className={`cc-room cc-room--${room.kind}`}
        data-active={active}
        x={room.x}
        y={room.y}
        width={room.w}
        height={room.h}
        rx={0.15}
        onClick={onSelect ? () => onSelect(room.id) : undefined}
        style={onSelect ? { cursor: 'pointer' } : undefined}
      >
        <title>{`${room.name}: ${room.w} × ${room.h} ft (${area} sq ft)`}</title>
      </rect>
      {small >= 5 && (
        <>
          <text
            className="cc-room-label"
            x={room.x + room.w / 2}
            y={room.y + room.h / 2 - fs * 0.15}
            fontSize={fs}
            textAnchor="middle"
          >
            {room.name}
          </text>
          <text
            className="cc-room-dim"
            x={room.x + room.w / 2}
            y={room.y + room.h / 2 + fs * 1.05}
            fontSize={fs * 0.72}
            textAnchor="middle"
          >
            {room.w}′ × {room.h}′ · {area} ft²
          </text>
        </>
      )}
    </g>
  );
}

/** Schematic blueprint of one floor, drawn in feet. Memoized: redraws only when inputs change. */
export const FloorPlan = memo(function FloorPlan({
  layout,
  floorIndex,
  activeRoomId,
  onSelect,
}: {
  layout: HouseLayout;
  floorIndex: number;
  activeRoomId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const floor = layout.floors[floorIndex] ?? layout.floors[0]!;
  const { lengthFt: L, widthFt: W } = layout.footprint;
  const garage = floor.level === 1 ? layout.garage : null;
  const totalW = L + (garage?.w ?? 0);
  const vbW = totalW + M * 2;
  const vbH = W + M * 2;
  return (
    <div className="cc-blueprint">
      <svg
        viewBox={`${-M} ${-M} ${vbW} ${vbH}`}
        role="img"
        aria-label={`Floor ${floor.level} plan, ${L} by ${W} feet, ${floor.rooms.length} spaces`}
      >
        <rect
          x={0}
          y={0}
          width={L}
          height={W}
          fill="none"
          stroke="#67e8f9"
          strokeWidth={0.45}
          className="cc-draw"
          pathLength={400}
        />
        {floor.rooms.map((room) => (
          <RoomRect
            key={room.id}
            room={room}
            active={room.id === activeRoomId}
            onSelect={onSelect}
          />
        ))}
        {garage && (
          <RoomRect room={garage} active={garage.id === activeRoomId} onSelect={onSelect} />
        )}
        {/* overall dimensions */}
        <line className="cc-dimline" x1={0} y1={-2.5} x2={L} y2={-2.5} />
        <line className="cc-dimline" x1={0} y1={-3.3} x2={0} y2={-1.7} />
        <line className="cc-dimline" x1={L} y1={-3.3} x2={L} y2={-1.7} />
        <text className="cc-dimtext" x={L / 2} y={-3.2} fontSize={1.3} textAnchor="middle">
          {L}′-0″
        </text>
        <line className="cc-dimline" x1={-2.5} y1={0} x2={-2.5} y2={W} />
        <line className="cc-dimline" x1={-3.3} y1={0} x2={-1.7} y2={0} />
        <line className="cc-dimline" x1={-3.3} y1={W} x2={-1.7} y2={W} />
        <text
          className="cc-dimtext"
          x={-3.4}
          y={W / 2}
          fontSize={1.3}
          textAnchor="middle"
          transform={`rotate(-90 ${-3.4} ${W / 2})`}
        >
          {W}′-0″
        </text>
        {/* north arrow */}
        <g transform={`translate(${totalW + 3.2} ${-2.6})`}>
          <path d="M0 -1.6 L0.8 0.8 L0 0.3 L-0.8 0.8 Z" fill="#a78bfa" />
          <text className="cc-dimtext" y={2.2} fontSize={1} textAnchor="middle">
            N
          </text>
        </g>
      </svg>
      <div className="cc-blueprint__scan" aria-hidden="true" />
      <div className="cc-blueprint__hud" aria-hidden="true">
        <span className="cc-chip">FLOOR {floor.level}</span>
        <span className="cc-chip cc-chip--purple">{Math.round(L * W)} FT²</span>
        <span className="cc-chip">SCALE 1 UNIT = 1 FT</span>
      </div>
    </div>
  );
});
