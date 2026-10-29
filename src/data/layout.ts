/** 楼层几何：世界坐标以楼层中心为原点，X 向右、Z 向前（朝相机） */
export const CELL_W = 3.24
export const CELL_D = 3.08
export const GAP = 0.62
export const COLS = 4
export const ROWS = 4

export const FLOOR_W = COLS * CELL_W + (COLS - 1) * GAP
export const FLOOR_D = ROWS * CELL_D + (ROWS - 1) * GAP
export const ORIGIN_X = -FLOOR_W / 2
export const ORIGIN_Z = -FLOOR_D / 2

export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

export function roomRect(row: number, col: number, colSpan = 1): Rect {
  const w = colSpan * CELL_W + (colSpan - 1) * GAP
  return {
    x: ORIGIN_X + col * (CELL_W + GAP) + w / 2,
    z: ORIGIN_Z + row * (CELL_D + GAP) + CELL_D / 2,
    w,
    d: CELL_D,
  }
}

/** 房间内的工位排布：返回相对房间中心的 x/z 与朝向 */
export function deskPositions(count: number, w: number, d: number) {
  const cols = count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : 4
  const rows = Math.ceil(count / cols)
  const sx = Math.min(0.98, (w - 0.78) / Math.max(1, cols))
  const sz = Math.min(0.88, (d - 0.7) / Math.max(1, rows))
  const out: { x: number; z: number; row: number; col: number }[] = []
  for (let i = 0; i < count; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    out.push({
      x: (c - (cols - 1) / 2) * sx,
      z: (r - (rows - 1) / 2) * sz + 0.16,
      row: r,
      col: c,
    })
  }
  return out
}

/** 中央中庭（占据第二行后两格） */
export const ATRIUM = roomRect(1, 2, 2)

/** 前排左：总监办公室（跨两格） */
export const DIRECTOR = roomRect(3, 0, 2)

/** 前排右：会议室（跨两格） */
export const MEETING = roomRect(3, 2, 2)

/** 会议长桌尺寸 */
export const MEETING_TABLE = { w: 3.5, d: 0.95 }

/**
 * 会议席位：交错排布在长桌两侧，索引即 seatIndex。
 * face = 1 表示人朝 +z 坐（在桌子近侧），-1 表示朝 -z（远侧）
 */
export function meetingSeats(): { x: number; z: number; face: number }[] {
  const out: { x: number; z: number; face: number }[] = []
  const xs = [-1.4, -0.47, 0.47, 1.4]
  for (const dx of xs) {
    out.push({ x: MEETING.x + dx, z: MEETING.z - 0.68, face: 1 })
    out.push({ x: MEETING.x + dx, z: MEETING.z + 0.68, face: -1 })
  }
  return out
}
