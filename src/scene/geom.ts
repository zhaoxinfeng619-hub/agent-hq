import * as THREE from 'three'

/**
 * 自研几何合并（不引 three/examples 的 BufferGeometryUtils —— 那会触发 Vite 依赖重优化）。
 * 把大量小零件烘焙成一个 BufferGeometry，1 个 draw call 装下一整套家具。
 */

export interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  let total = 0
  const prepared = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()
    g.applyMatrix4(p.matrix)
    total += g.getAttribute('position').count
    return g
  })

  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  let o = 0
  for (const g of prepared) {
    const p = g.getAttribute('position') as THREE.BufferAttribute
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined
    const t = g.getAttribute('uv') as THREE.BufferAttribute | undefined
    pos.set(p.array as Float32Array, o * 3)
    if (n) nor.set(n.array as Float32Array, o * 3)
    if (t) uv.set(t.array as Float32Array, o * 2)
    o += p.count
    g.dispose()
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

/** 按世界尺寸缩放 UV，避免贴图被非等比拉伸 */
export function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) return geo
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  uv.needsUpdate = true
  return geo
}

/** 累积式零件包：按材质分组，最后 mergeParts 成单个 mesh */
export class Kit {
  parts: Part[] = []
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private cache = new Map<string, THREE.BufferGeometry>()

  private geo(key: string, make: () => THREE.BufferGeometry) {
    let g = this.cache.get(key)
    if (!g) {
      g = make()
      this.cache.set(key, g)
    }
    return g
  }

  get count() {
    return this.parts.length
  }

  /** 任意几何 + 变换 */
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, opts?: {
    rx?: number
    ry?: number
    rz?: number
    sx?: number
    sy?: number
    sz?: number
  }) {
    this.e.set(opts?.rx ?? 0, opts?.ry ?? 0, opts?.rz ?? 0)
    this.q.setFromEuler(this.e)
    this.m4.compose(
      this.v.set(x, y, z),
      this.q,
      this.s.set(opts?.sx ?? 1, opts?.sy ?? 1, opts?.sz ?? 1)
    )
    this.parts.push({ geo, matrix: this.m4.clone() })
    return this
  }

  /** 单位立方体缩放（共享几何，UV 固定 0..1，适合纯色件） */
  box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    return this.add(this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, {
      ry,
      rx,
      rz,
      sx: w,
      sy: h,
      sz: d,
    })
  }

  /** 圆柱：r 上/下底半径 */
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const key = `cyl${rt}_${rb}_${h}_${seg}`
    return this.add(this.geo(key, () => new THREE.CylinderGeometry(rt, rb, h, seg)), x, y, z, { rx, ry, rz })
  }

  /** 球 */
  ball(r: number, seg: number, x: number, y: number, z: number, sy = 1) {
    const key = `sph${r}_${seg}`
    return this.add(this.geo(key, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1))), x, y, z, {
      sy,
      sx: 1,
      sz: 1,
    })
  }

  /** 环（水平放置） */
  torus(r: number, t: number, x: number, y: number, z: number, seg = 32) {
    const key = `tor${r}_${t}_${seg}`
    return this.add(this.geo(key, () => new THREE.TorusGeometry(r, t, 6, seg)), x, y, z, { rx: Math.PI / 2 })
  }

  /**
   * 带凸沿的台面：主体 + 顶盖稍微探出一点点。
   * 这点探出会在侧光下形成一条高光边，是"精模感"的关键。
   */
  slab(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, lip = 0.008) {
    this.box(w, h - lip * 2, d, x, y - lip, z, ry)
    this.box(w + lip * 2, lip * 2, d + lip * 2, x, y + h / 2 - lip, z, ry)
    return this
  }

  /** 四条桌腿（方形，略内收） */
  legs(w: number, d: number, h: number, x: number, y: number, z: number, t = 0.024, ry = 0) {
    const dx = w / 2 - t
    const dz = d / 2 - t
    for (const [ox, oz] of [
      [-dx, -dz],
      [dx, -dz],
      [-dx, dz],
      [dx, dz],
    ]) {
      const c = Math.cos(ry)
      const s2 = Math.sin(ry)
      this.box(t, h, t, x + ox * c - oz * s2, y + h / 2, z + ox * s2 + oz * c, ry)
    }
    return this
  }

  build(mat: THREE.Material, opts?: { cast?: boolean; receive?: boolean; name?: string }) {
    const geo = mergeParts(this.parts)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = opts?.cast ?? false
    mesh.receiveShadow = opts?.receive ?? false
    if (opts?.name) mesh.name = opts.name
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.parts = []
    return mesh
  }
}
