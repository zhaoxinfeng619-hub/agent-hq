import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { DEPTS, world } from '../data/world'
import {
  ATRIUM,
  DIRECTOR,
  FLOOR_D,
  FLOOR_W,
  GAP,
  MEETING,
  MEETING_TABLE,
  deskPositions,
  meetingSeats,
  roomRect,
  type Rect,
} from '../data/layout'
import { Kit, mergeParts, scaleUV } from './geom'
import {
  artTexture,
  bandTexture,
  bigScreenTexture,
  booksTexture,
  carpetTexture,
  conferenceTexture,
  darkWoodTexture,
  gridTexture,
  laminateTexture,
  makeEnvironment,
  monitorTexture,
  noiseTexture,
  radialTexture,
  rugTexture,
  spriteTexture,
  whiteboardTexture,
} from './textures'

export interface SceneHooks {
  onHoverAgent?: (agentId: string | null, x: number, y: number) => void
  onSelectAgent?: (agentId: string | null) => void
  onSelectRoom?: (deptId: string | null) => void
}

interface RoomView {
  deptId: string
  color: THREE.Color
  rect: Rect
  glowMat: THREE.MeshBasicMaterial
  stripMat: THREE.MeshBasicMaterial
  floorMat: THREE.MeshStandardMaterial
  glowTarget: number
  softColor: THREE.Color
}

const WHITE = new THREE.Color(0xffffff)
const RED = new THREE.Color(0xff4d63)
const SOFT_GREY = new THREE.Color(0x5c6470)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 会议室 / 总监室左右两侧共用的通廊 */
const CORRIDOR_X = 0

type Vec2 = { x: number; z: number }

export class HQScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false

  private rooms: RoomView[] = []
  private roomById = new Map<string, RoomView>()
  private roomFloors: THREE.Mesh[] = []

  private deskMesh!: THREE.InstancedMesh
  private baseMesh!: THREE.InstancedMesh
  private screenMesh!: THREE.InstancedMesh
  private chairMesh!: THREE.InstancedMesh
  private chairBackMesh!: THREE.InstancedMesh
  private bodyMesh!: THREE.InstancedMesh
  private headMesh!: THREE.InstancedMesh
  private accMesh!: THREE.InstancedMesh
  private pedMesh!: THREE.InstancedMesh

  private glowPoints!: THREE.Points
  private glowColors!: Float32Array
  private ring!: THREE.Group
  private ringMat!: THREE.MeshBasicMaterial
  private marker!: THREE.Group
  private markerRing!: THREE.Mesh
  private dust!: THREE.Points
  private meetLight: THREE.PointLight | null = null
  private keyLight: THREE.DirectionalLight | null = null
  private meetLampMat: THREE.MeshBasicMaterial | null = null

  /** 工位（坐下时的坐标） */
  private agentSlots: { x: number; z: number; rect: Rect; color: THREE.Color; kind: 'desk' | 'boss' }[] = []
  private agentIndexById = new Map<string, number>()
  private instanceToAgent: string[] = []

  /** 人在世界里的当前位置 + 行走路径 */
  private walkPos: Vec2[] = []
  private routes: Vec2[][] = []
  private routeHead: number[] = []
  private lastMeeting: boolean[] = []
  private lastStatus: string[] = []
  private seats = meetingSeats()

  /* 相机 */
  private baseRadius = 35
  private fitFactor = 1
  private cam = { theta: 0.78, phi: 0.86, radius: 35 }
  private camTo = { theta: 0.78, phi: 0.86, radius: 35 }
  private target = new THREE.Vector3(0, 0.45, 0)
  private targetTo = new THREE.Vector3(0, 0.3, 0)
  private dragging = false
  private moved = false
  private lastPointer = { x: 0, y: 0 }
  private pointer = { x: 0, y: 0 }
  private hoverAgent: string | null = null
  private focusDept: string | null = null
  private roamOn = true
  private roamPhase: 'idle' | 'tour' = 'idle'
  private roamTimer = 16
  private userCooldown = 0

  /* 性能 */
  private dprCap = 1.5
  private quality: 0 | 1 | 2 = 2
  private useBloom = true
  private frameAcc = 0
  private frameCnt = 0
  avgMs = 0
  private perfWarmup = 2
  private lockQuality = false

  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private dummy = new THREE.Object3D()
  private tmpColor = new THREE.Color()

  constructor(private container: HTMLElement, private hooks: SceneHooks) {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap))
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x05070c, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.info.autoReset = false
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 240)
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.0058)

    // 调试：?q=0|1|2 锁画质（截图/验收用，避免自动降档影响观感）
    const qs = new URLSearchParams(location.search).get('q')
    if (qs !== null) {
      this.quality = clamp(parseInt(qs, 10) || 0, 0, 2) as 0 | 1 | 2
      this.lockQuality = true
    } else {
      const shadowOff = new URLSearchParams(location.search).has('noshadow')
      this.applyQuality()
      if (shadowOff && this.keyLight) this.keyLight.castShadow = false
    }

    this.computeFit()
    this.cam.radius = this.baseRadius * this.fitFactor
    this.camTo.radius = this.cam.radius

    this.buildLights()
    this.buildFloor()
    this.buildRooms()
    this.buildAtrium()
    this.buildDirectorSuite()
    this.buildMeetingRoom()
    this.buildAgents()
    this.buildMarker()
    this.buildRing()
    this.buildDust()
    this.buildPost(w, h)

    this.bindEvents()
    this.applyDebugCamera()
    this.applyCamera(true)
    this.tick()
  }

  /** 调试：?cam=theta,phi,radius,tx,ty,tz 直接落到指定机位（无头截图用，绕过缓动） */
  private applyDebugCamera() {
    const raw = new URLSearchParams(location.search).get('cam')
    if (!raw) return
    const v = raw.split(',').map((s) => parseFloat(s))
    if (v.length < 3 || v.some((n) => !Number.isFinite(n))) return
    this.camTo = { theta: v[0], phi: v[1], radius: v[2] }
    this.cam = { ...this.camTo }
    if (v.length >= 6) {
      this.target.set(v[3], v[4], v[5])
      this.targetTo.copy(this.target)
    }
  }

  /* ------------------------------------------------------------- 构建 */

  private buildLights() {
    // 程序化环境探针：给金属/木作提供真实的反射来源，是"精模感"的一半
    this.scene.environment = makeEnvironment(this.renderer)
    this.scene.environmentIntensity = 0.4

    this.scene.add(new THREE.AmbientLight(0x8296bb, 0.34))
    this.scene.add(new THREE.HemisphereLight(0xa8c0e8, 0x0a0e15, 0.44))

    const key = new THREE.DirectionalLight(0xfff0dc, 2.05)
    key.position.set(-16, 20, 12)
    key.castShadow = true
    const sc = key.shadow.camera
    sc.left = -13
    sc.right = 13
    sc.top = 13
    sc.bottom = -13
    sc.near = 2
    sc.far = 76
    sc.updateProjectionMatrix()
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0007
    key.shadow.normalBias = 0.02
    key.shadow.radius = 2.4
    this.scene.add(key)
    this.keyLight = key

    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.58)
    fill.position.set(15, 10, -9)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0xff9a5a, 0.3)
    rim.position.set(6, 4, 16)
    this.scene.add(rim)
  }

  /* ------------------------------------------------------------- 底座 */

  private buildFloor() {
    const W = FLOOR_W + 2.2
    const D = FLOOR_D + 2.2

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x111722,
      roughness: 0.34,
      metalness: 0.66,
      envMapIntensity: 1.15,
    })
    const k1 = new Kit()
    k1.slab(W, 0.46, D, 0, -0.23, 0, 0, 0.01)
    k1.box(W - 0.34, 0.16, D - 0.34, 0, -0.52, 0)
    k1.box(W + 0.08, 0.026, D + 0.08, 0, -0.06, 0)
    this.scene.add(k1.build(bodyMat, { receive: true, cast: true }))

    // 顶沿一圈抛光金属
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x35455f,
      roughness: 0.2,
      metalness: 0.96,
      envMapIntensity: 1.6,
    })
    const k2 = new Kit()
    k2.box(W + 0.06, 0.022, D + 0.06, 0, -0.011, 0)
    k2.box(W + 0.02, 0.01, D + 0.02, 0, -0.048, 0)
    this.scene.add(k2.build(rimMat))

    // 侧面散热格栅（发光细缝）
    const ventMat = new THREE.MeshBasicMaterial({ color: 0x1d587f, transparent: true, opacity: 0.62 })
    const k3 = new Kit()
    for (let i = 0; i < 28; i++) {
      const x = -W / 2 + 0.55 + (i * (W - 1.1)) / 27
      k3.box(0.16, 0.013, 0.01, x, -0.3, D / 2 + 0.004)
      k3.box(0.16, 0.013, 0.01, x, -0.3, -D / 2 - 0.004)
    }
    for (let i = 0; i < 24; i++) {
      const z = -D / 2 + 0.55 + (i * (D - 1.1)) / 23
      k3.box(0.01, 0.013, 0.16, W / 2 + 0.004, -0.3, z)
      k3.box(0.01, 0.013, 0.16, -W / 2 - 0.004, -0.3, z)
    }
    this.scene.add(k3.build(ventMat))

    // 底光
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_W + 14, FLOOR_D + 14),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(78,122,208,0.3)', 'rgba(78,122,208,0)'),
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -0.52
    this.scene.add(halo)

    // 地面网格
    const grid = gridTexture()
    grid.repeat.set((FLOOR_W + 2.2) / 1.24, (FLOOR_D + 2.2) / 1.24)
    const gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.1, D - 0.1),
      new THREE.MeshBasicMaterial({
        map: grid,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    gridPlane.rotation.x = -Math.PI / 2
    gridPlane.position.y = 0.004
    this.scene.add(gridPlane)
  }

  /* ------------------------------------------------------------- 房间壳体 */

  private instanceBoxes(
    list: { w: number; h: number; d: number; x: number; y: number; z: number }[],
    mat: THREE.Material,
    colors?: THREE.Color[],
    opts?: { cast?: boolean; gradient?: boolean }
  ) {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    if (opts?.gradient) {
      // 单位立方体上烘一道垂直渐变：下暗上亮，近似环境遮蔽，墙面立刻有厚度
      const pos = geo.getAttribute('position') as THREE.BufferAttribute
      const col = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        const k = 0.74 + (pos.getY(i) + 0.5) * 0.3
        col[i * 3] = k
        col[i * 3 + 1] = k
        col[i * 3 + 2] = k
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    const m = new THREE.InstancedMesh(geo, mat, list.length)
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    m.frustumCulled = false
    m.castShadow = opts?.cast ?? false
    m.receiveShadow = true
    const d = this.dummy
    d.rotation.set(0, 0, 0)
    list.forEach((b, i) => {
      d.position.set(b.x, b.y, b.z)
      d.scale.set(b.w, b.h, b.d)
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
      if (colors) m.setColorAt(i, colors[i])
    })
    d.scale.set(1, 1, 1)
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    this.scene.add(m)
    return m
  }

  /** 任意尺寸的发光面片（窗光 / 灯带），共用 1 个 draw call */
  private instanceQuads(
    list: { w: number; h: number; x: number; y: number; z: number; color: THREE.Color }[],
    mat: THREE.Material
  ) {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length)
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    m.frustumCulled = false
    const d = this.dummy
    d.rotation.set(0, 0, 0)
    list.forEach((q, i) => {
      d.position.set(q.x, q.y, q.z)
      d.scale.set(q.w, q.h, 1)
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
      m.setColorAt(i, q.color)
    })
    d.scale.set(1, 1, 1)
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    this.scene.add(m)
    return m
  }

  private buildRooms() {
    const glowTex = radialTexture()
    const carpet = carpetTexture()
    const noise = noiseTexture()

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x5b6a83,
      roughness: 0.52,
      metalness: 0.42,
      envMapIntensity: 0.9,
      vertexColors: true,
    })
    const wallMatLow = new THREE.MeshStandardMaterial({
      color: 0x44506a,
      roughness: 0.56,
      metalness: 0.38,
      envMapIntensity: 0.8,
      vertexColors: true,
    })
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.34, metalness: 0.72 })
    const mullionMat = new THREE.MeshStandardMaterial({
      color: 0x51637f,
      roughness: 0.28,
      metalness: 0.88,
      envMapIntensity: 1.3,
    })
    const winMat = new THREE.MeshBasicMaterial({
      map: bandTexture(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const barMat = new THREE.MeshBasicMaterial({
      map: bandTexture(),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    type B = { w: number; h: number; d: number; x: number; y: number; z: number }
    const hiList: B[] = []
    const capColors: THREE.Color[] = []
    const loList: B[] = []
    const capList: B[] = []
    const trimList: B[] = []
    const mullList: B[] = []
    const winList: { w: number; h: number; x: number; y: number; z: number; color: THREE.Color }[] = []
    const barList: typeof winList = []
    const credList: { x: number; z: number }[] = []
    const plantList: { x: number; z: number }[] = []
    const binList: { x: number; z: number }[] = []

    const box = (arr: B[], w: number, h: number, d: number, x: number, y: number, z: number) => {
      arr.push({ w, h, d, x, y, z })
    }

    for (const dept of DEPTS) {
      const rect = roomRect(dept.row, dept.col, dept.colSpan)
      const color = new THREE.Color(dept.color)
      const g = new THREE.Group()

      // 地毯：贴图 + 粗糙度噪声，颜色仍由部门色驱动自发光
      const floorGeo = new THREE.BoxGeometry(rect.w - 0.14, 0.08, rect.d - 0.14)
      scaleUV(floorGeo, (rect.w - 0.14) / 1.3, (rect.d - 0.14) / 1.3)
      const soft = color.clone().lerp(SOFT_GREY, 0.62)
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0x606a77,
        map: carpet,
        roughnessMap: noise,
        bumpMap: carpet,
        bumpScale: 0.012,
        roughness: 0.97,
        metalness: 0.02,
        emissive: soft.clone(),
        emissiveIntensity: 0.028,
        envMapIntensity: 0.18,
      })
      const floor = new THREE.Mesh(floorGeo, floorMat)
      floor.position.set(rect.x, 0.04, rect.z)
      floor.receiveShadow = true
      floor.userData.deptId = dept.id
      g.add(floor)
      this.roomFloors.push(floor)

      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: color.clone(),
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(rect.w * 0.78, rect.d * 0.78), glowMat)
      glow.rotation.x = -Math.PI / 2
      glow.position.set(rect.x, 0.1, rect.z)
      g.add(glow)

      const hw = 0.5
      const hl = 0.15
      const t = 0.1
      const back = rect.z - rect.d / 2
      const front = rect.z + rect.d / 2
      const left = rect.x - rect.w / 2
      const right = rect.x + rect.w / 2

      // 后墙高、前墙矮
      box(hiList, rect.w, hw, t, rect.x, hw / 2, back)
      box(loList, rect.w, hl, t, rect.x, hl / 2, front)
      if (dept.kind !== 'director') box(hiList, t, hw, rect.d, left, hw / 2, rect.z)
      if (dept.kind !== 'meeting') box(loList, t, hl, rect.d, right, hl / 2, rect.z)

      // 墙顶亮边（用部门色，读起来是一个整体而不是蓝白网格）
      const capCol = color.clone().lerp(WHITE, 0.34)
      const cap = (w2: number, h2: number, d2: number, x2: number, y2: number, z2: number) => {
        box(capList, w2, h2, d2, x2, y2, z2)
        capColors.push(capCol)
      }
      cap(rect.w, 0.016, 0.05, rect.x, hw + 0.004, back)
      cap(rect.w, 0.014, 0.046, rect.x, hl + 0.004, front)
      if (dept.kind !== 'director') cap(0.05, 0.016, rect.d, left, hw + 0.004, rect.z)
      if (dept.kind !== 'meeting') cap(0.046, 0.014, rect.d, right, hl + 0.004, rect.z)

      // 地毯压条：把地面和墙的接缝收干净
      box(trimList, rect.w - 0.1, 0.018, 0.05, rect.x, 0.086, back + 0.06)
      box(trimList, rect.w - 0.1, 0.018, 0.05, rect.x, 0.086, front - 0.06)
      box(trimList, 0.05, 0.018, rect.d - 0.1, left + 0.06, 0.086, rect.z)
      box(trimList, 0.05, 0.018, rect.d - 0.1, right - 0.06, 0.086, rect.z)

      // 后墙踢脚线 + 一道横向分缝
      box(trimList, rect.w - 0.12, 0.045, 0.028, rect.x, 0.11, back + t / 2 + 0.016)
      box(trimList, rect.w - 0.16, 0.016, 0.022, rect.x, 0.38, back + t / 2 + 0.012)

      // 后墙竖向分缝（金属肋）
      const ribs = Math.max(2, Math.round(rect.w / 0.92))
      for (let i = 1; i < ribs; i++) {
        const x = left + (i * rect.w) / ribs
        box(mullList, 0.036, hw - 0.06, 0.03, x, (hw - 0.06) / 2 + 0.02, back + t / 2 + 0.012)
      }

      // 后墙窗光带
      winList.push({
        w: rect.w * 0.84,
        h: 0.3,
        x: rect.x,
        y: 0.33,
        z: back + t / 2 + 0.02,
        color: color.clone().lerp(WHITE, 0.42),
      })

      // 房间顶部灯管（悬浮，压出层次）
      barList.push({
        w: rect.w * 0.46,
        h: 0.055,
        x: rect.x,
        y: hw + 0.16,
        z: rect.z - rect.d * 0.16,
        color: color.clone().lerp(WHITE, 0.3),
      })

      // 普通部门塞三件家具，房间不至于空荡
      if (dept.kind === 'dept') {
        credList.push({ x: rect.x - rect.w * 0.2, z: back + 0.26 })
        plantList.push({ x: right - 0.36, z: back + 0.36 })
        binList.push({ x: left + 0.3, z: front - 0.32 })
      }

      this.scene.add(g)
      const view: RoomView = {
        deptId: dept.id,
        color,
        rect,
        glowMat,
        stripMat: winMat,
        floorMat,
        glowTarget: 0.2,
        softColor: soft,
      }
      this.rooms.push(view)
      this.roomById.set(dept.id, view)
    }

    this.instanceBoxes(hiList, wallMat, undefined, { cast: true, gradient: true })
    this.instanceBoxes(loList, wallMatLow, undefined, { cast: true, gradient: true })
    this.instanceBoxes(capList, capMat, capColors)
    this.instanceBoxes(trimList, trimMat)
    this.instanceBoxes(mullList, mullionMat, undefined, { cast: true })
    this.instanceQuads(winList, winMat)
    this.instanceQuads(barList, barMat)

    // 矮柜
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0x39445a,
      roughness: 0.48,
      metalness: 0.34,
      envMapIntensity: 0.85,
    })
    const cabGeo = (() => {
      const k = new Kit()
      k.slab(1.12, 0.3, 0.36, 0, 0.15, 0, 0, 0.006)
      for (const dx of [-0.37, 0, 0.37]) {
        k.box(0.34, 0.22, 0.012, dx, 0.15, 0.185)
        k.box(0.12, 0.008, 0.02, dx, 0.25, 0.196)
      }
      k.box(1.08, 0.012, 0.3, 0, 0.305, 0)
      return mergeParts(k.parts)
    })()
    const cabMesh = new THREE.InstancedMesh(cabGeo, cabMat, credList.length)
    cabMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    cabMesh.frustumCulled = false
    cabMesh.castShadow = true
    cabMesh.receiveShadow = true
    credList.forEach((c, i) => {
      this.dummy.position.set(c.x, 0.08, c.z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      cabMesh.setMatrixAt(i, this.dummy.matrix)
    })
    this.scene.add(cabMesh)

    // 绿植（盆 + 叶）
    const potGeo = (() => {
      const k = new Kit()
      k.cyl(0.12, 0.09, 0.19, 12, 0, 0.095, 0)
      k.cyl(0.115, 0.115, 0.014, 12, 0, 0.19, 0)
      return mergeParts(k.parts)
    })()
    const leafGeo = (() => {
      const k = new Kit()
      k.cyl(0.014, 0.011, 0.24, 6, 0, 0.32, 0)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3
        k.ball(0.095, 9, Math.cos(a) * 0.1, 0.44 + (i % 2) * 0.11, Math.sin(a) * 0.1, 1.15)
      }
      k.ball(0.085, 9, 0, 0.66, 0, 1.2)
      return mergeParts(k.parts)
    })()
    const potMat = new THREE.MeshStandardMaterial({ color: 0x22282f, roughness: 0.62, metalness: 0.18 })
    const leafMatR = new THREE.MeshStandardMaterial({ color: 0x387355, roughness: 0.82, metalness: 0.02 })
    for (const [geo, mat] of [
      [potGeo, potMat],
      [leafGeo, leafMatR],
    ] as [THREE.BufferGeometry, THREE.Material][]) {
      const m = new THREE.InstancedMesh(geo, mat, plantList.length)
      m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      m.frustumCulled = false
      m.castShadow = true
      plantList.forEach((pl, i) => {
        this.dummy.position.set(pl.x, 0.08, pl.z)
        this.dummy.rotation.set(0, (i * 1.7) % 6.28, 0)
        this.dummy.scale.set(1, 1, 1)
        this.dummy.updateMatrix()
        m.setMatrixAt(i, this.dummy.matrix)
      })
      this.scene.add(m)
    }

    // 垃圾桶
    const binGeo = new THREE.CylinderGeometry(0.085, 0.07, 0.19, 12, 1, true)
    const binMesh = new THREE.InstancedMesh(
      binGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a313b, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide }),
      binList.length
    )
    binMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    binMesh.frustumCulled = false
    binMesh.castShadow = true
    binList.forEach((b, i) => {
      this.dummy.position.set(b.x, 0.1, b.z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      binMesh.setMatrixAt(i, this.dummy.matrix)
    })
    this.scene.add(binMesh)

    // 灯管两端的吊杆，让悬浮灯管有着落
    const rodKit = new Kit()
    for (const b of barList) {
      rodKit.box(0.012, 0.3, 0.012, b.x - b.w / 2 + 0.08, b.y + 0.16, b.z)
      rodKit.box(0.012, 0.3, 0.012, b.x + b.w / 2 - 0.08, b.y + 0.16, b.z)
    }
    this.scene.add(rodKit.build(mullionMat))
  }

  /* ------------------------------------------------------------- 中庭 */

  private buildAtrium() {
    const g = new THREE.Group()
    const { x: cx, z: cz } = ATRIUM

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x6f5d45,
      map: darkWoodTexture(),
      roughness: 0.56,
      metalness: 0.1,
      envMapIntensity: 0.5,
    })
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x232a35,
      roughness: 0.34,
      metalness: 0.82,
      envMapIntensity: 1.1,
    })
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0x8ea3bd,
      roughness: 0.18,
      metalness: 0.96,
      envMapIntensity: 1.3,
    })
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.95, metalness: 0.02 })
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x4a5364, roughness: 0.97, metalness: 0.02 })
    const potMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.72, metalness: 0.2 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6249, roughness: 0.86, metalness: 0.02 })

    // 地毯
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 2.2),
      new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.98, metalness: 0.02, color: 0x6a6a6a })
    )
    rug.rotation.x = -Math.PI / 2
    rug.position.set(cx - 0.2, 0.09, cz - 0.1)
    rug.receiveShadow = true
    g.add(rug)

    // 沙发（三人，靠远侧墙）
    const sx = cx - 0.2
    const sz = cz - 0.86
    const sofa = new Kit()
    sofa.box(2.46, 0.2, 0.66, sx, 0.19, sz)
    sofa.box(2.46, 0.36, 0.16, sx, 0.45, sz - 0.25)
    sofa.box(0.16, 0.3, 0.66, sx - 1.31, 0.38, sz)
    sofa.box(0.16, 0.3, 0.66, sx + 1.31, 0.38, sz)
    for (const dx of [-0.8, 0, 0.8]) sofa.box(0.74, 0.1, 0.5, sx + dx, 0.33, sz + 0.04)
    for (const [ox, oz] of [
      [-1.15, -0.26],
      [1.15, -0.26],
      [-1.15, 0.26],
      [1.15, 0.26],
    ]) {
      sofa.box(0.05, 0.09, 0.05, sx + ox, 0.045, sz + oz)
    }
    this.scene.add(sofa.build(sofaMat, { cast: true, receive: true }))

    const cushions = new Kit()
    for (const [dx, ry] of [
      [-0.62, 0.2],
      [0.62, -0.24],
    ]) {
      cushions.box(0.3, 0.28, 0.1, sx + dx, 0.5, sz - 0.14, ry, -0.18)
    }
    this.scene.add(cushions.build(cushionMat))

    // 圆茶几
    const tk = new Kit()
    tk.cyl(0.52, 0.52, 0.05, 36, sx, 0.36, cz + 0.02)
    tk.cyl(0.46, 0.52, 0.025, 36, sx, 0.325, cz + 0.02)
    this.scene.add(tk.build(woodMat, { cast: true, receive: true }))

    const tbase = new Kit()
    tbase.cyl(0.09, 0.12, 0.26, 14, sx, 0.18, cz + 0.02)
    tbase.cyl(0.28, 0.28, 0.02, 24, sx, 0.03, cz + 0.02)
    this.scene.add(tbase.build(metalMat, { cast: true }))

    const tItems = new Kit()
    tItems.cyl(0.17, 0.17, 0.012, 20, sx + 0.1, 0.39, cz - 0.04)
    tItems.cyl(0.038, 0.034, 0.06, 12, sx + 0.1, 0.42, cz - 0.04)
    tItems.cyl(0.05, 0.05, 0.03, 14, sx - 0.16, 0.4, cz + 0.06)
    tItems.box(0.18, 0.016, 0.13, sx - 0.02, 0.394, cz + 0.2, 0.2)
    this.scene.add(tItems.build(chromeMat))

    // 两张单人椅（面对沙发）
    const chairs = new Kit()
    for (const dx of [-1.42, 1.05]) {
      const px = sx + dx
      const pz = cz + 0.86
      chairs.box(0.62, 0.18, 0.6, px, 0.21, pz)
      chairs.box(0.62, 0.34, 0.14, px, 0.45, pz + 0.24)
      chairs.box(0.14, 0.26, 0.6, px - 0.38, 0.38, pz)
      chairs.box(0.14, 0.26, 0.6, px + 0.38, 0.38, pz)
    }
    this.scene.add(chairs.build(sofaMat, { cast: true, receive: true }))

    const chairCush = new Kit()
    for (const dx of [-1.42, 1.05]) {
      chairCush.box(0.42, 0.09, 0.4, sx + dx, 0.34, cz + 0.84)
    }
    this.scene.add(chairCush.build(cushionMat))

    const chairFeet = new Kit()
    for (const dx of [-1.42, 1.05]) {
      for (const [ox, oz] of [
        [-0.22, -0.22],
        [0.22, -0.22],
        [-0.22, 0.22],
        [0.22, 0.22],
      ]) {
        chairFeet.box(0.045, 0.12, 0.045, sx + dx + ox, 0.06, cz + 0.86 + oz)
      }
    }
    this.scene.add(chairFeet.build(metalMat))

    // 边几 + 落地灯
    const side = new Kit()
    side.cyl(0.24, 0.24, 0.03, 22, sx + 1.72, 0.34, cz + 0.3)
    side.cyl(0.03, 0.03, 0.32, 8, sx + 1.72, 0.17, cz + 0.3)
    side.cyl(0.16, 0.16, 0.014, 20, sx + 1.72, 0.02, cz + 0.3)
    this.scene.add(side.build(chromeMat, { cast: true }))

    const lampX = cx + 2.35
    const lampZ = cz + 0.92
    const lampPos = new Kit()
    lampPos.cyl(0.17, 0.17, 0.02, 18, lampX, 0.03, lampZ)
    lampPos.cyl(0.015, 0.015, 1.1, 8, lampX, 0.58, lampZ)
    lampPos.cyl(0.16, 0.2, 0.055, 16, lampX, 1.12, lampZ)
    this.scene.add(lampPos.build(metalMat, { cast: true }))

    const lampGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.15, 0.02, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd8a8 })
    )
    lampGlow.position.set(lampX, 1.08, lampZ)
    g.add(lampGlow)

    // 书架
    const bx = cx + 2.9
    const bz = cz - 1.18
    const shelf = new Kit()
    shelf.slab(1.3, 0.44, 0.28, bx, 0.22, bz, 0, 0.006)
    for (let i = 0; i < 2; i++) shelf.box(1.22, 0.016, 0.24, bx, 0.17 + i * 0.2, bz)
    shelf.box(0.026, 0.4, 0.24, bx - 0.62, 0.21, bz)
    shelf.box(0.026, 0.4, 0.24, bx + 0.62, 0.21, bz)
    this.scene.add(shelf.build(metalMat, { cast: true }))

    const books = new THREE.Mesh(
      new THREE.PlaneGeometry(1.16, 0.16),
      new THREE.MeshStandardMaterial({ map: booksTexture(), roughness: 0.9 })
    )
    for (let i = 0; i < 2; i++) {
      const b = books.clone()
      b.position.set(bx, 0.26 + i * 0.2, bz + 0.13)
      g.add(b)
    }

    // 角落绿植
    const plantSpots: [number, number, number][] = [
      [cx - 3.05, cz + 1.1, 1.05],
      [cx + 3.15, cz + 0.4, 0.9],
      [cx - 3.1, cz - 1.1, 0.85],
    ]
    const pk = new Kit()
    for (const [px, pz, sc] of plantSpots) {
      pk.cyl(0.2 * sc, 0.15 * sc, 0.3 * sc, 12, px, 0.15 * sc, pz)
      pk.cyl(0.19 * sc, 0.19 * sc, 0.018, 12, px, 0.3 * sc, pz)
      pk.cyl(0.02, 0.016, 0.4 * sc, 6, px, 0.5 * sc, pz)
    }
    this.scene.add(pk.build(potMat, { cast: true }))

    const leafKit = new Kit()
    for (const [px, pz, sc] of plantSpots) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3
        leafKit.ball(0.13 * sc, 10, px + Math.cos(a) * 0.14 * sc, (0.6 + (i % 2) * 0.13) * sc, pz + Math.sin(a) * 0.14 * sc, 1.1)
      }
      leafKit.ball(0.115 * sc, 10, px, 0.86 * sc, pz, 1.15)
    }
    this.scene.add(leafKit.build(leafMat, { cast: true }))

    // 地面暖光
    const warm = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.6),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(255,180,110,0.85)', 'rgba(255,120,40,0)'),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    warm.rotation.x = -Math.PI / 2
    warm.position.set(cx - 0.2, 0.5, cz)
    g.add(warm)

    const l1 = new THREE.PointLight(0xffa869, 6, 7, 2)
    l1.position.set(cx - 0.2, 1.05, cz)
    g.add(l1)

    this.scene.add(g)
  }

  /** 总监办公室：大班台 + 老板椅 + 弧形指挥屏 + 书墙 + 会客区 */
  private buildDirectorSuite() {
    const g = new THREE.Group()
    const { x, z } = DIRECTOR
    const deskZ = z + 0.02

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x6a5238,
      map: darkWoodTexture(),
      roughness: 0.52,
      metalness: 0.14,
      envMapIntensity: 0.6,
    })
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1f29,
      roughness: 0.34,
      metalness: 0.78,
      envMapIntensity: 1.15,
    })
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0x9aadc4,
      roughness: 0.14,
      metalness: 0.98,
      envMapIntensity: 1.6,
    })
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.78, metalness: 0.04 })
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0x333d4f, roughness: 0.94, metalness: 0.02 })

    // 地毯
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 1.95),
      new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.98, metalness: 0.02, color: 0x8a8a8a })
    )
    rug.rotation.x = -Math.PI / 2
    rug.position.set(x, 0.088, z + 0.16)
    rug.receiveShadow = true
    g.add(rug)

    // 大班台
    const dk = new Kit()
    dk.slab(1.86, 0.07, 0.68, x, 0.42, deskZ, 0, 0.006)
    // 前挡板（皮革包裹）
    dk.box(1.78, 0.34, 0.05, x, 0.24, deskZ + 0.3)
    // 侧板
    dk.box(0.05, 0.36, 0.6, x - 0.87, 0.2, deskZ)
    dk.box(0.05, 0.36, 0.6, x + 0.87, 0.2, deskZ)
    this.scene.add(dk.build(woodMat, { cast: true, receive: true }))

    const leather = new Kit()
    leather.box(1.7, 0.012, 0.56, x, 0.462, deskZ)
    leather.box(1.78, 0.3, 0.012, x, 0.24, deskZ + 0.33)
    this.scene.add(leather.build(leatherMat))

    // 桌面物件：台灯、电话、笔筒、文件
    const items = new Kit()
    items.cyl(0.055, 0.045, 0.012, 14, x - 0.66, 0.472, deskZ - 0.16)
    items.cyl(0.008, 0.008, 0.22, 6, x - 0.66, 0.58, deskZ - 0.16)
    items.cyl(0.05, 0.075, 0.03, 14, x - 0.66, 0.7, deskZ - 0.16, 0.2)
    // 电话
    items.box(0.16, 0.035, 0.1, x + 0.56, 0.475, deskZ - 0.1)
    items.box(0.16, 0.02, 0.03, x + 0.56, 0.495, deskZ - 0.14)
    // 笔筒
    items.cyl(0.026, 0.026, 0.08, 10, x + 0.28, 0.5, deskZ - 0.17)
    // 文件叠
    items.box(0.2, 0.012, 0.26, x + 0.18, 0.47, deskZ + 0.1, 0.18)
    items.box(0.2, 0.012, 0.26, x + 0.19, 0.483, deskZ + 0.1, 0.1)
    // 铭牌
    items.box(0.16, 0.05, 0.02, x - 0.16, 0.5, deskZ + 0.26)
    this.scene.add(items.build(chromeMat))

    // 老板椅
    const ch = new Kit()
    ch.slab(0.34, 0.08, 0.34, x, 0.44, z + 0.62, 0, 0.005)
    ch.box(0.34, 0.42, 0.075, x, 0.66, z + 0.8, 0, -0.1)
    ch.box(0.26, 0.16, 0.07, x, 0.92, z + 0.82, 0, -0.16)
    ch.box(0.055, 0.05, 0.3, x - 0.19, 0.55, z + 0.66)
    ch.box(0.055, 0.05, 0.3, x + 0.19, 0.55, z + 0.66)
    this.scene.add(ch.build(leatherMat, { cast: true }))

    const chMetal = new Kit()
    chMetal.cyl(0.022, 0.022, 0.2, 8, x, 0.3, z + 0.62)
    chMetal.cyl(0.13, 0.13, 0.02, 14, x, 0.02, z + 0.62)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      chMetal.box(0.03, 0.02, 0.14, x + Math.cos(a) * 0.07, 0.02, z + 0.62 + Math.sin(a) * 0.07, -a)
    }
    this.scene.add(chMetal.build(chromeMat, { cast: true }))

    // 弧形指挥屏（三块，带边框和支臂）
    const bigTex = bigScreenTexture()
    const frame = new Kit()
    for (const [dx, ry] of [
      [-0.46, 0.46],
      [0, 0],
      [0.46, -0.46],
    ]) {
      const px = x + dx
      const pz = z - 1.16 + Math.abs(dx) * 0.2
      frame.box(0.42, 0.26, 0.022, px, 0.3, pz, ry)
      frame.box(0.022, 0.016, 0.026, px, 0.44, pz + 0.02, ry)
    }
    frame.box(1.4, 0.024, 0.035, x, 0.13, z - 1.16)
    frame.box(0.03, 0.2, 0.03, x, 0.06, z - 1.17)
    this.scene.add(frame.build(darkMat, { cast: true }))

    const screenMat = new THREE.MeshBasicMaterial({ map: bigTex, color: 0xe8c69a })
    for (const [dx, ry] of [
      [-0.46, 0.46],
      [0, 0],
      [0.46, -0.46],
    ]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.22), screenMat)
      s.position.set(x + dx, 0.3, z - 1.16 + Math.abs(dx) * 0.2)
      s.rotation.y = ry
      g.add(s)
    }

    // 桌上小终端
    const term = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), screenMat)
    term.position.set(x - 0.4, 0.5, deskZ - 0.16)
    term.rotation.x = -0.2
    term.rotation.y = 0.14
    g.add(term)

    // 会客区：两椅 + 茶几
    const guest = new Kit()
    for (const dx of [-0.62, 0.62]) {
      guest.slab(0.36, 0.075, 0.36, x + dx, 0.34, z + 1.12, 0, 0.005)
      guest.box(0.36, 0.3, 0.07, x + dx, 0.5, z + 1.3, 0, -0.08)
      guest.box(0.05, 0.045, 0.32, x + dx - 0.2, 0.42, z + 1.14)
      guest.box(0.05, 0.045, 0.32, x + dx + 0.2, 0.42, z + 1.14)
    }
    this.scene.add(guest.build(fabricMat, { cast: true }))

    const guestFeet = new Kit()
    for (const dx of [-0.62, 0.62]) {
      for (const [ox, oz] of [
        [-0.15, -0.15],
        [0.15, -0.15],
        [-0.15, 0.15],
        [0.15, 0.15],
      ]) {
        guestFeet.box(0.024, 0.3, 0.024, x + dx + ox, 0.17, z + 1.12 + oz)
      }
    }
    this.scene.add(guestFeet.build(chromeMat))

    const tea = new Kit()
    tea.cyl(0.28, 0.28, 0.03, 22, x, 0.36, z + 0.78)
    tea.cyl(0.03, 0.03, 0.33, 8, x, 0.19, z + 0.78)
    tea.cyl(0.2, 0.2, 0.012, 20, x, 0.02, z + 0.78)
    this.scene.add(tea.build(darkMat, { cast: true }))

    const teaItems = new Kit()
    teaItems.cyl(0.06, 0.06, 0.008, 14, x - 0.1, 0.38, z + 0.74)
    teaItems.ball(0.045, 10, x + 0.09, 0.4, z + 0.82, 0.9)
    this.scene.add(teaItems.build(chromeMat))

    // 书墙（后墙左侧）
    const bx = x - 2.55
    const bz = z - 1.22
    const shelf = new Kit()
    shelf.slab(1.4, 0.46, 0.3, bx, 0.23, bz, 0, 0.006)
    shelf.box(0.035, 0.42, 0.26, bx - 0.66, 0.22, bz)
    shelf.box(0.035, 0.42, 0.26, bx + 0.66, 0.22, bz)
    shelf.box(0.035, 0.42, 0.26, bx, 0.22, bz)
    for (let i = 0; i < 2; i++) shelf.box(1.28, 0.018, 0.26, bx, 0.19 + i * 0.2, bz)
    this.scene.add(shelf.build(darkMat, { cast: true }))

    const bookMat = new THREE.MeshStandardMaterial({ map: booksTexture(), roughness: 0.92 })
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.17), bookMat)
        b.position.set(bx - 0.32 + k * 0.64, 0.28 + i * 0.2, bz + 0.135)
        g.add(b)
      }
    }

    // 挂画
    const artMat = new THREE.MeshStandardMaterial({ map: artTexture(), roughness: 0.85 })
    const artFrame = new Kit()
    artFrame.box(0.56, 0.36, 0.035, x + 1.5, 0.3, z - 1.38)
    artFrame.box(0.36, 0.26, 0.035, x + 2.16, 0.26, z - 1.38)
    this.scene.add(artFrame.build(chromeMat))
    for (const [px, py, pw, ph] of [
      [x + 1.5, 0.3, 0.5, 0.3],
      [x + 2.16, 0.26, 0.3, 0.2],
    ]) {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), artMat)
      a.position.set(px, py, z - 1.36)
      g.add(a)
    }

    // 侧柜 + 台灯
    const cab = new Kit()
    cab.slab(0.86, 0.46, 0.4, x - 2.62, 0.23, z + 0.5, 0, 0.006)
    cab.box(0.78, 0.02, 0.34, x - 2.62, 0.30, z + 0.5)
    this.scene.add(cab.build(woodMat, { cast: true, receive: true }))

    const lampBase = new Kit()
    lampBase.cyl(0.07, 0.09, 0.02, 14, x - 2.62, 0.47, z + 0.42)
    lampBase.cyl(0.012, 0.012, 0.26, 6, x - 2.62, 0.6, z + 0.42)
    lampBase.cyl(0.09, 0.06, 0.11, 12, x - 2.62, 0.77, z + 0.42)
    this.scene.add(lampBase.build(chromeMat))
    const lampBulb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.05, 0.02, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd39a })
    )
    lampBulb.position.set(x - 2.62, 0.71, z + 0.42)
    g.add(lampBulb)

    // 绿植
    const plantPot = new Kit()
    const plantLeaf = new Kit()
    for (const [px, pz] of [
      [x + 2.9, z + 0.9],
      [x - 3.0, z - 0.9],
    ]) {
      plantPot.cyl(0.16, 0.12, 0.24, 12, px, 0.12, pz)
      plantPot.cyl(0.15, 0.15, 0.018, 12, px, 0.24, pz)
      plantPot.cyl(0.018, 0.015, 0.34, 6, px, 0.4, pz)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4
        plantLeaf.ball(0.115, 10, px + Math.cos(a) * 0.12, 0.55 + (i % 2) * 0.12, pz + Math.sin(a) * 0.12, 1.1)
      }
      plantLeaf.ball(0.1, 10, px, 0.78, pz, 1.15)
    }
    this.scene.add(plantPot.build(darkMat, { cast: true }))
    this.scene.add(
      plantLeaf.build(new THREE.MeshStandardMaterial({ color: 0x2c5c43, roughness: 0.86 }), { cast: true })
    )

    const lamp = new THREE.PointLight(0xffc24b, 3.6, 5.5, 2)
    lamp.position.set(x, 1.1, z + 0.1)
    g.add(lamp)

    this.scene.add(g)
  }

  /** 会议室：长桌 + 8 椅 + 双吊灯 + 大屏 + 白板 */
  private buildMeetingRoom() {
    const g = new THREE.Group()
    const { x, z } = MEETING
    const tw = MEETING_TABLE.w
    const td = MEETING_TABLE.d

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x6f7d92,
      map: conferenceTexture(),
      roughness: 0.58,
      metalness: 0.1,
      envMapIntensity: 0.45,
    })
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a212c,
      roughness: 0.36,
      metalness: 0.74,
      envMapIntensity: 1.1,
    })
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0x95a8bf,
      roughness: 0.15,
      metalness: 0.98,
      envMapIntensity: 1.5,
    })
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0x34435a, roughness: 0.92, metalness: 0.03 })

    // 地毯
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(tw + 1.3, td + 1.5),
      new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.98, metalness: 0.02, color: 0x505c68 })
    )
    rug.rotation.x = -Math.PI / 2
    rug.position.set(x, 0.088, z)
    rug.receiveShadow = true
    g.add(rug)

    // 长桌（带凹槽收边）
    const tk = new Kit()
    tk.slab(tw, 0.075, td, x, 0.44, z, 0, 0.006)
    tk.box(tw - 0.3, 0.04, td - 0.22, x, 0.39, z)
    this.scene.add(tk.build(woodMat, { cast: true, receive: true }))

    // 桌腿：两条 T 型横梁
    const legK = new Kit()
    for (const dx of [-1.16, 1.16]) {
      legK.box(0.09, 0.34, 0.62, x + dx, 0.2, z)
      legK.box(0.5, 0.05, 0.62, x + dx, 0.035, z)
      legK.box(0.16, 0.03, 0.3, x + dx, 0.38, z)
    }
    legK.box(tw - 2.3, 0.05, 0.07, x, 0.3, z)
    this.scene.add(legK.build(darkMat, { cast: true }))

    // 桌面细节：线盒、话筒、便签、水瓶
    const micK = new Kit()
    for (const s of this.seats) {
      micK.cyl(0.02, 0.02, 0.004, 8, s.x, 0.48, z - s.face * 0.3)
      micK.cyl(0.006, 0.006, 0.1, 6, s.x, 0.53, z - s.face * 0.3)
      micK.ball(0.014, 8, s.x, 0.58, z - s.face * 0.3)
    }
    this.scene.add(micK.build(chromeMat))

    const paperK = new Kit()
    for (const s of this.seats) {
      paperK.box(0.1, 0.005, 0.14, s.x, 0.481, z - s.face * (td / 2 - 0.11), 0.06 * s.face)
    }
    this.scene.add(paperK.build(new THREE.MeshStandardMaterial({ color: 0xb9c4d0, roughness: 0.95 })))

    const bottleK = new Kit()
    for (const s of this.seats) {
      bottleK.cyl(0.022, 0.024, 0.11, 10, s.x + 0.17, 0.53, z - s.face * (td / 2 - 0.16))
      bottleK.cyl(0.012, 0.016, 0.02, 8, s.x + 0.17, 0.595, z - s.face * (td / 2 - 0.16))
    }
    this.scene.add(
      bottleK.build(new THREE.MeshStandardMaterial({ color: 0x9fd8e6, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.8 }))
    )

    // 8 把会议椅
    const chairK = new Kit()
    const chairMetalK = new Kit()
    for (const s of this.seats) {
      const ry = s.face === 1 ? 0 : Math.PI
      const bx = s.x
      const bz = s.z + s.face * 0.04
      chairK.slab(0.3, 0.075, 0.3, bx, 0.4, bz, ry, 0.005)
      chairK.box(0.3, 0.26, 0.06, bx, 0.55, bz - s.face * 0.17, ry, 0.09)
      chairK.box(0.05, 0.04, 0.28, bx - 0.18, 0.48, bz, ry)
      chairK.box(0.05, 0.04, 0.28, bx + 0.18, 0.48, bz, ry)
      for (const [ox, oz] of [
        [-0.12, -0.12],
        [0.12, -0.12],
        [-0.12, 0.12],
        [0.12, 0.12],
      ]) {
        chairMetalK.box(0.022, 0.37, 0.022, bx + ox, 0.19, bz + oz, ry)
      }
      chairMetalK.box(0.05, 0.035, 0.24, bx - 0.18, 0.45, bz, ry)
      chairMetalK.box(0.05, 0.035, 0.24, bx + 0.18, 0.45, bz, ry)
    }
    this.scene.add(chairK.build(fabricMat, { cast: true }))
    this.scene.add(chairMetalK.build(chromeMat, { cast: true }))

    // 吊灯：两条灯轨 + 亚克力扩散板
    const ceilK = new Kit()
    for (const dz of [-0.26, 0.26]) {
      ceilK.box(tw * 0.66, 0.055, 0.1, x, 1.06, z + dz)
      ceilK.box(tw * 0.66, 0.02, 0.12, x, 1.09, z + dz)
      for (const dx of [-1.1, 0, 1.1]) {
        ceilK.box(0.016, 0.34, 0.016, x + dx, 1.24, z + dz)
      }
      ceilK.box(tw * 0.7, 0.03, 0.05, x, 1.42, z + dz)
    }
    this.scene.add(ceilK.build(darkMat))

    this.meetLampMat = new THREE.MeshBasicMaterial({ color: 0x2f6d7c, transparent: true, opacity: 0.8 })
    for (const dz of [-0.26, 0.26]) {
      const diff = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.64, 0.014, 0.085), this.meetLampMat)
      diff.position.set(x, 1.028, z + dz)
      g.add(diff)
    }

    this.meetLight = new THREE.PointLight(0x5ad1e8, 6, 6, 2)
    this.meetLight.position.set(x, 0.95, z)
    g.add(this.meetLight)

    // 墙面大屏（控制在墙高以内，否则会像悬空广告牌）
    const screenMat = new THREE.MeshBasicMaterial({ map: bigScreenTexture(), color: 0xa8d4e6 })
    const sframe = new Kit()
    sframe.box(1.34, 0.4, 0.05, x + 0.28, 0.29, z - 1.44)
    sframe.box(0.3, 0.05, 0.06, x + 0.28, 0.5, z - 1.43)
    sframe.box(0.06, 0.05, 0.07, x + 0.28, 0.53, z - 1.42)
    this.scene.add(sframe.build(darkMat))

    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.32), screenMat)
    scr.position.set(x + 0.28, 0.29, z - 1.412)
    g.add(scr)

    // 白板
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(1.02, 0.28),
      new THREE.MeshStandardMaterial({ map: whiteboardTexture(), roughness: 0.5, metalness: 0.05 })
    )
    board.position.set(x - 1.28, 0.29, z - 1.44)
    g.add(board)
    const bframe = new Kit()
    bframe.box(1.1, 0.34, 0.03, x - 1.28, 0.29, z - 1.455)
    bframe.box(1.04, 0.018, 0.05, x - 1.28, 0.12, z - 1.44)
    this.scene.add(bframe.build(chromeMat))

    // 侧边茶水柜 + 咖啡机 + 杯盘
    const cred = new Kit()
    cred.slab(1.05, 0.5, 0.36, x + 2.62, 0.25, z - 1.18, 0, 0.006)
    cred.box(0.96, 0.02, 0.3, x + 2.62, 0.32, z - 1.18)
    this.scene.add(cred.build(woodMat, { cast: true, receive: true }))

    const coffee = new Kit()
    coffee.box(0.22, 0.3, 0.24, x + 2.4, 0.65, z - 1.18)
    coffee.box(0.2, 0.14, 0.03, x + 2.4, 0.58, z - 1.05)
    coffee.box(0.16, 0.02, 0.12, x + 2.4, 0.53, z - 1.1)
    coffee.cyl(0.035, 0.03, 0.07, 10, x + 2.75, 0.53, z - 1.14)
    coffee.cyl(0.035, 0.03, 0.07, 10, x + 2.85, 0.53, z - 1.2)
    this.scene.add(coffee.build(darkMat, { cast: true }))

    this.scene.add(g)
  }

  private buildAgents() {
    const total = world.agents.length
    const deskTop = (() => {
      const k = new Kit()
      k.slab(0.62, 0.05, 0.42, 0, 0.4, 0, 0, 0.004)
      return mergeParts(k.parts)
    })()
    const deskBase = (() => {
      const k = new Kit()
      for (const dx of [-0.29, 0.29]) {
        k.box(0.028, 0.375, 0.38, dx, 0.1875, 0)
        k.box(0.05, 0.018, 0.4, dx, 0.009, 0)
      }
      k.box(0.56, 0.235, 0.018, 0, 0.245, -0.19)
      k.box(0.58, 0.05, 0.026, 0, 0.35, -0.175)
      k.box(0.32, 0.026, 0.11, 0, 0.33, 0.02)
      k.box(0.5, 0.024, 0.026, 0, 0.13, 0.0)
      return mergeParts(k.parts)
    })()
    const screenGeo = new THREE.BoxGeometry(0.22, 0.14, 0.024)
    const chairGeo = new THREE.BoxGeometry(0.26, 0.06, 0.26)
    const chairBackGeo = new THREE.BoxGeometry(0.26, 0.2, 0.05)
    const bodyGeo = new THREE.CapsuleGeometry(0.068, 0.155, 3, 8)
    const headGeo = new THREE.SphereGeometry(0.066, 12, 9)

    // 桌面配件：键盘/鼠标/屏框/支架/杯子/纸，合成 1 个几何逐工位实例化
    const accKit = new Kit()
    accKit.box(0.2, 0.012, 0.062, 0, 0.437, 0.055)
    accKit.box(0.028, 0.012, 0.042, 0.128, 0.437, 0.058)
    accKit.box(0.238, 0.158, 0.014, 0, 0.515, -0.152, 0, -0.12)
    accKit.box(0.05, 0.075, 0.04, 0, 0.452, -0.186)
    accKit.box(0.15, 0.012, 0.1, 0, 0.421, -0.19)
    accKit.cyl(0.022, 0.019, 0.058, 10, -0.19, 0.446, 0.02)
    accKit.box(0.085, 0.004, 0.115, 0.16, 0.427, -0.06, 0.32)
    accKit.box(0.03, 0.014, 0.03, 0.19, 0.43, -0.14)
    const accGeo = mergeParts(accKit.parts)

    // 椅子底座 + 扶手
    const pedKit = new Kit()
    pedKit.cyl(0.015, 0.015, 0.16, 8, 0, 0.09, 0)
    pedKit.cyl(0.105, 0.105, 0.014, 12, 0, 0.012, 0)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      pedKit.box(0.022, 0.014, 0.11, Math.cos(a) * 0.055, 0.016, Math.sin(a) * 0.055, -a)
    }
    pedKit.box(0.026, 0.02, 0.2, -0.136, 0.27, 0.03)
    pedKit.box(0.026, 0.02, 0.2, 0.136, 0.27, 0.03)
    pedKit.box(0.02, 0.08, 0.02, -0.136, 0.23, 0.03)
    pedKit.box(0.02, 0.08, 0.02, 0.136, 0.23, 0.03)
    const pedGeo = mergeParts(pedKit.parts)

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x98a8be,
      map: laminateTexture(),
      roughness: 0.5,
      metalness: 0.12,
      envMapIntensity: 0.7,
    })
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x232c3c, roughness: 0.38, metalness: 0.68, envMapIntensity: 1.1 })
    const screenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: monitorTexture() })
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x39455c, roughness: 0.9, metalness: 0.03 })
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a3240, roughness: 0.34, metalness: 0.82, envMapIntensity: 1.2 })
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.04 })
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.68 })

    this.deskMesh = new THREE.InstancedMesh(deskTop, woodMat, total)
    this.baseMesh = new THREE.InstancedMesh(deskBase, baseMat, total)
    this.screenMesh = new THREE.InstancedMesh(screenGeo, screenMat, total)
    this.chairMesh = new THREE.InstancedMesh(chairGeo, chairMat, total)
    this.chairBackMesh = new THREE.InstancedMesh(chairBackGeo, chairMat, total)
    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, total)
    this.headMesh = new THREE.InstancedMesh(headGeo, headMat, total)
    this.accMesh = new THREE.InstancedMesh(accGeo, metalMat, total)
    this.pedMesh = new THREE.InstancedMesh(pedGeo, metalMat, total)

    const statics = [
      this.deskMesh,
      this.baseMesh,
      this.screenMesh,
      this.chairMesh,
      this.chairBackMesh,
      this.accMesh,
      this.pedMesh,
    ]
    for (const m of statics) {
      m.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
    }
    for (const m of [this.bodyMesh, this.headMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.frustumCulled = false
      m.castShadow = true
      this.scene.add(m)
    }

    const byDept = new Map<string, typeof world.agents>()
    for (const a of world.agents) {
      if (!byDept.has(a.deptId)) byDept.set(a.deptId, [])
      byDept.get(a.deptId)!.push(a)
    }

    // 静态家具矩阵只写一次
    let i = 0
    for (const dept of DEPTS) {
      const rect = roomRect(dept.row, dept.col, dept.colSpan)
      const list = byDept.get(dept.id) ?? []
      const slots = deskPositions(list.length, rect.w, rect.d)
      list.forEach((a, k) => {
        const boss = dept.kind === 'director'
        const px = boss ? rect.x : rect.x + slots[k].x
        const pz = boss ? rect.z + 0.52 : rect.z + slots[k].z
        this.agentSlots.push({ x: px, z: pz, rect, color: new THREE.Color(dept.color), kind: boss ? 'boss' : 'desk' })
        this.agentIndexById.set(a.id, i)
        this.instanceToAgent[i] = a.id

        const d = this.dummy
        d.rotation.set(0, 0, 0)
        if (boss) {
          d.scale.set(0, 0, 0)
          d.position.set(0, -10, 0)
          d.updateMatrix()
          for (const m of statics) m.setMatrixAt(i, d.matrix)
        } else {
          d.scale.set(1, 1, 1)
          d.position.set(px, 0, pz - 0.26)
          d.updateMatrix()
          this.deskMesh.setMatrixAt(i, d.matrix)
          this.baseMesh.setMatrixAt(i, d.matrix)

          d.position.set(px, 0.515, pz - 0.41)
          d.rotation.set(-0.12, 0, 0)
          d.updateMatrix()
          this.screenMesh.setMatrixAt(i, d.matrix)
          d.rotation.set(0, 0, 0)

          d.position.set(px, 0.2, pz + 0.18)
          d.updateMatrix()
          this.chairMesh.setMatrixAt(i, d.matrix)

          d.position.set(px, 0.31, pz + 0.3)
          d.updateMatrix()
          this.chairBackMesh.setMatrixAt(i, d.matrix)

          // 配件与底座：局部坐标，整体平移即可
          d.position.set(px, 0, pz - 0.26)
          d.updateMatrix()
          this.accMesh.setMatrixAt(i, d.matrix)

          d.position.set(px, 0, pz + 0.18)
          d.updateMatrix()
          this.pedMesh.setMatrixAt(i, d.matrix)
        }
        i++
      })
    }

    // 初始颜色
    for (let k = 0; k < total; k++) {
      const a = world.agents[k]
      const dept = DEPTS.find((d) => d.id === a.deptId)!
      this.screenMesh.setColorAt(k, this.tmpColor.set(0x222b3a))
      this.bodyMesh.setColorAt(k, this.tmpColor.set(dept.color).multiplyScalar(0.86).lerp(WHITE, 0.04))
    }
    if (this.screenMesh.instanceColor) this.screenMesh.instanceColor.needsUpdate = true
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true

    // 接地阴影
    const shadowGeo = new THREE.PlaneGeometry(0.82, 0.82)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    })
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, total)
    shadows.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    shadows.frustumCulled = false
    for (let k = 0; k < total; k++) {
      this.dummy.position.set(this.agentSlots[k].x, 0.115, this.agentSlots[k].z + 0.02)
      this.dummy.rotation.set(-Math.PI / 2, 0, 0)
      this.dummy.scale.set(1, 1, 1)
      this.dummy.updateMatrix()
      shadows.setMatrixAt(k, this.dummy.matrix)
    }
    this.dummy.rotation.set(0, 0, 0)
    this.scene.add(shadows)

    // 呼吸光点
    this.glowColors = new Float32Array(total * 3)
    const positions = new Float32Array(total * 3)
    for (let k = 0; k < total; k++) {
      positions[k * 3] = this.agentSlots[k].x
      positions[k * 3 + 1] = 0.52
      positions[k * 3 + 2] = this.agentSlots[k].z
    }
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    gg.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3))
    this.glowPoints = new THREE.Points(
      gg,
      new THREE.PointsMaterial({
        map: spriteTexture(),
        size: 0.52,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        opacity: 0.55,
      })
    )
    this.glowPoints.frustumCulled = false
    this.scene.add(this.glowPoints)

    // 行走状态
    this.walkPos = this.agentSlots.map((s) => ({ x: s.x, z: s.z }))
    this.routes = this.agentSlots.map(() => [])
    this.routeHead = this.agentSlots.map(() => 0)
    this.lastMeeting = this.agentSlots.map(() => false)
    this.lastStatus = world.agents.map((a) => a.status)
  }

  private buildMarker() {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.014, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.62
    g.add(ring)
    this.markerRing = ring

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff9a45, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    beam.position.y = 0.75
    g.add(beam)
    g.visible = false
    this.marker = g
    this.scene.add(g)
  }

  private buildRing() {
    this.ring = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8a3c,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 1), mat)
      m.position.y = 0.14
      this.ring.add(m)
    }
    this.ring.visible = false
    this.scene.add(this.ring)
    this.ringMat = mat
  }

  private buildDust() {
    const n = 320
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * (FLOOR_W + 8)
      pos[i * 3 + 1] = Math.random() * 6
      pos[i * 3 + 2] = (Math.random() - 0.5) * (FLOOR_D + 8)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0x9fc4ff,
        size: 0.035,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    this.dust = p
    this.scene.add(p)
  }

  private buildPost(w: number, h: number) {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    // 半分辨率 bloom：视觉几乎无差，成本降到 1/4
    const bloom = new UnrealBloomPass(new THREE.Vector2(w * 0.7, h * 0.7), 0.62, 0.72, 0.72)
    composer.addPass(bloom)
    composer.setSize(w, h)
    composer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap))
    bloom.setSize(w * 0.7, h * 0.7)
    this.composer = composer
    this.bloom = bloom
  }

  /* ------------------------------------------------------------- 事件 */

  private bindEvents() {
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('pointerleave', this.onLeave)
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true
    this.moved = false
    this.lastPointer = { x: e.clientX, y: e.clientY }
    this.userCooldown = 4
  }

  private onMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer = { x: e.clientX, y: e.clientY }
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)

    if (this.dragging) {
      const dx = e.clientX - this.lastPointer.x
      const dy = e.clientY - this.lastPointer.y
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true
      this.camTo.theta = clamp(this.camTo.theta - dx * 0.005, 0.32, 1.26)
      this.camTo.phi = clamp(this.camTo.phi - dy * 0.004, 0.55, 1.15)
      this.lastPointer = { x: e.clientX, y: e.clientY }
      this.userCooldown = 6
      return
    }
    this.pick(e.clientX, e.clientY)
  }

  private onUp = () => {
    if (this.dragging && !this.moved) this.click()
    this.dragging = false
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.camTo.radius = clamp(this.camTo.radius + e.deltaY * 0.016, 9, 44)
    this.userCooldown = 8
  }

  private onLeave = () => {
    if (this.hoverAgent) {
      this.hoverAgent = null
      this.hooks.onHoverAgent?.(null, 0, 0)
    }
  }

  private pick(cx: number, cy: number) {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hitDesk = this.raycaster.intersectObject(this.deskMesh, false)[0]
    if (hitDesk && hitDesk.instanceId !== undefined) {
      const id = this.instanceToAgent[hitDesk.instanceId]
      if (id !== this.hoverAgent) {
        this.hoverAgent = id
        this.hooks.onHoverAgent?.(id, cx, cy)
      }
      return
    }
    if (this.hoverAgent) {
      this.hoverAgent = null
      this.hooks.onHoverAgent?.(null, 0, 0)
    }
  }

  private click() {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hitDesk = this.raycaster.intersectObject(this.deskMesh, false)[0]
    if (hitDesk && hitDesk.instanceId !== undefined) {
      this.hooks.onSelectAgent?.(this.instanceToAgent[hitDesk.instanceId])
      return
    }
    const hitRoom = this.raycaster.intersectObjects(this.roomFloors, false)[0]
    if (hitRoom) {
      this.hooks.onSelectRoom?.(hitRoom.object.userData.deptId as string)
    } else {
      this.hooks.onSelectRoom?.(null)
    }
  }

  /* ------------------------------------------------------------- 对外 API */

  setFocusDept(id: string | null) {
    this.focusDept = id
    const room = id ? this.roomById.get(id) : null
    if (room) {
      this.targetTo.set(room.rect.x, 0.25, room.rect.z)
      this.camTo.radius = clamp(Math.max(room.rect.w, room.rect.d) * 2.7, 9.5, 13)
      this.roamPhase = 'idle'
      this.roamTimer = 0
    } else {
      this.targetTo.set(0, 0.45, 0)
      this.camTo.radius = this.baseRadius * this.fitFactor
    }
    this.userCooldown = 6
  }

  focusAgent(agentId: string) {
    const i = this.agentIndexById.get(agentId)
    if (i === undefined) return
    const s = this.agentSlots[i]
    const th = this.cam.theta
    const off = 1.9
    const p = this.walkPos[i]
    this.targetTo.set(p.x + Math.cos(th) * off, 0.3, p.z - Math.sin(th) * off)
    this.camTo.radius = 10.6
    this.userCooldown = 8
    this.marker.position.set(p.x, 0, p.z + 0.06)
    this.marker.visible = true
  }

  clearAgentMarker() {
    this.marker.visible = false
  }

  setRoam(on: boolean) {
    this.roamOn = on
    this.roamTimer = 0
    this.roamPhase = 'idle'
  }

  resetView() {
    this.targetTo.set(0, 0.45, 0)
    this.camTo = { theta: 0.78, phi: 0.86, radius: this.baseRadius * this.fitFactor }
    this.userCooldown = 6
  }

  private computeFit() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.fitFactor = clamp(Math.pow(Math.max(1080 / h, 1720 / w), 0.9), 1, 1.5)
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.computeFit()
    if (!this.focusDept && this.userCooldown <= 0) {
      this.camTo.radius = this.baseRadius * this.fitFactor
    }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer?.setSize(w, h)
    this.bloom?.setSize(w * 0.7, h * 0.7)
  }

  projectRoom(deptId: string) {
    const room = this.roomById.get(deptId)
    if (!room) return null
    const v = new THREE.Vector3(room.rect.x, 1.12, room.rect.z)
    v.project(this.camera)
    if (v.z > 1) return null
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, depth: v.z }
  }

  /* ------------------------------------------------------------- 帧循环 */

  private applyCamera(immediate = false) {
    const k = immediate ? 1 : 0.06
    this.cam.theta = lerp(this.cam.theta, this.camTo.theta, k)
    this.cam.phi = lerp(this.cam.phi, this.camTo.phi, k)
    this.cam.radius = lerp(this.cam.radius, this.camTo.radius, k)
    this.target.lerp(this.targetTo, immediate ? 1 : 0.07)

    const s = Math.sin(this.cam.phi) * this.cam.radius
    this.camera.position.set(
      this.target.x + s * Math.sin(this.cam.theta),
      this.target.y + Math.cos(this.cam.phi) * this.cam.radius,
      this.target.z + s * Math.cos(this.cam.theta)
    )
    this.camera.lookAt(this.target)
  }

  private roam(dt: number) {
    if (!this.roamOn || this.focusDept || this.userCooldown > 0) return
    this.roamTimer -= dt
    if (this.roamTimer > 0) return
    if (this.roamPhase === 'idle') {
      const loads = world.deptLoad().slice().sort((a, b) => b.running - a.running)
      const pickId = loads[Math.floor(Math.random() * Math.min(4, loads.length))]?.id
      const room = pickId ? this.roomById.get(pickId) : null
      if (room) {
        this.targetTo.set(room.rect.x, 0.3, room.rect.z)
        this.camTo.radius = 11 + Math.random() * 2
        this.camTo.theta = 0.78 + (Math.random() - 0.5) * 0.22
        this.roamPhase = 'tour'
        this.roamTimer = 7.5
      }
    } else {
      this.targetTo.set(0, 0.45, 0)
      this.camTo.radius = this.baseRadius * this.fitFactor
      this.roamPhase = 'idle'
      this.roamTimer = 5.5 + Math.random() * 3
    }
  }

  /* 走廊路径：出房间 → 走廊 → 通廊 → 目标 */
  private corridorZ(rect: Rect) {
    const front = rect.z + rect.d / 2 + GAP / 2
    return front > FLOOR_D / 2 ? rect.z - rect.d / 2 - GAP / 2 : front
  }

  private buildRoute(i: number, toMeeting: boolean) {
    const slot = this.agentSlots[i]
    const cur = this.walkPos[i]
    const cz = this.corridorZ(slot.rect)
    const r: Vec2[] = []

    if (toMeeting) {
      const seat = this.seats[Math.max(0, world.agents[i].seatIndex ?? 0)]
      r.push({ x: cur.x, z: cz })
      r.push({ x: CORRIDOR_X, z: cz })
      r.push({ x: CORRIDOR_X, z: MEETING.z })
      r.push({ x: seat.x, z: seat.z })
    } else {
      const cz2 = this.corridorZ(slot.rect)
      r.push({ x: cur.x, z: cz2 })
      r.push({ x: CORRIDOR_X, z: cz2 })
      r.push({ x: slot.x, z: cz2 })
      r.push({ x: slot.x, z: slot.z })
    }
    this.routes[i] = r
    this.routeHead[i] = 0
  }

  private updateAgents(t: number, dt: number) {
    const d = this.dummy
    const agents = world.agents
    const meeting = world.meeting

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      const s = this.agentSlots[i]
      const running = a.status === 'running'
      const err = a.status === 'error'
      const isMeeting = a.status === 'meeting'
      const pos = this.walkPos[i]

      // 进出会议室时重算路径
      if (isMeeting !== this.lastMeeting[i]) {
        this.lastMeeting[i] = isMeeting
        this.buildRoute(i, isMeeting)
      }

      // 沿路径走
      let walking = false
      if (isMeeting || this.routes[i].length) {
        const route = this.routes[i]
        let head = this.routeHead[i]
        while (head < route.length) {
          const wp = route[head]
          const dx = wp.x - pos.x
          const dz = wp.z - pos.z
          const dist = Math.hypot(dx, dz)
          if (dist < 0.06) {
            head++
            continue
          }
          const step = Math.min(dist, dt * 2.6)
          pos.x += (dx / dist) * step
          pos.z += (dz / dist) * step
          walking = true
          break
        }
        this.routeHead[i] = head
        if (head >= route.length && !isMeeting) {
          this.routes[i] = []
          this.routeHead[i] = 0
        }
      }

      const bob = walking
        ? Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.045
        : running
          ? Math.sin(t * 2.2 + i) * 0.012
          : 0
      const y = walking ? 0.375 : running ? 0.3 : 0.27

      // 人
      d.position.set(pos.x, y + bob + 0.08, pos.z)
      d.rotation.set(walking ? 0.06 : 0, 0, 0)
      d.scale.set(1, 1, 1)
      d.updateMatrix()
      this.bodyMesh.setMatrixAt(i, d.matrix)

      d.position.set(pos.x, y + 0.28 + bob, pos.z)
      d.rotation.set(0, 0, 0)
      d.updateMatrix()
      this.headMesh.setMatrixAt(i, d.matrix)

      // 屏幕颜色只在状态变化时写
      if (this.lastStatus[i] !== a.status) {
        this.lastStatus[i] = a.status
        if (err) this.tmpColor.set(0xff3b56).multiplyScalar(0.75)
        else if (isMeeting) this.tmpColor.set(0x2f7f96)
        else if (running) this.tmpColor.copy(s.color).multiplyScalar(0.92)
        else this.tmpColor.set(0x2a3446)
        this.screenMesh.setColorAt(i, this.tmpColor)
        if (this.screenMesh.instanceColor) this.screenMesh.instanceColor.needsUpdate = true
      }

      // 光点
      const heat = walking
        ? 0.5
        : running
          ? 0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.7)
          : err
            ? Math.sin(t * 6) > 0
              ? 0.55
              : 0.1
            : isMeeting
              ? 0.4
              : 0.02
      const c = err ? this.tmpColor.set(0xff4d63) : isMeeting ? this.tmpColor.set(0x5ad1e8) : this.tmpColor.copy(s.color)
      this.glowColors[i * 3] = c.r * heat
      this.glowColors[i * 3 + 1] = c.g * heat
      this.glowColors[i * 3 + 2] = c.b * heat
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true
    this.headMesh.instanceMatrix.needsUpdate = true
    ;(this.glowPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true

    // 会议室灯光随会议状态
    if (this.meetLight && this.meetLampMat) {
      const target = meeting ? 4.2 : 1.8
      this.meetLight.intensity = lerp(this.meetLight.intensity, target, 0.08)
      const k = meeting ? 0.62 + 0.08 * Math.sin(t * 2.4) : 0.2
      this.meetLampMat.color.setRGB(0.42 * k + 0.06, 0.86 * k + 0.08, 1.0 * k + 0.1)
    }
  }

  private updateRooms(t: number) {
    const loads = new Map(world.deptLoad().map((d) => [d.id, d]))
    const meetCount = world.meeting ? world.meeting.agentIds.length : 0
    for (const r of this.rooms) {
      const load = loads.get(r.deptId)
      const ratio = load && load.total ? load.running / load.total : 0
      const err = load ? load.error : 0
      const inMeet = r.deptId === 'meeting' ? meetCount : 0
      const pulse = err > 0 ? 0.5 + 0.5 * Math.sin(t * 4.2) : 0
      const dim = this.focusDept && this.focusDept !== r.deptId ? 0.26 : 1

      let base = 0.18 + ratio * 0.5
      if (r.deptId === 'meeting') base = inMeet > 0 ? 0.62 + 0.16 * Math.sin(t * 2.1) : 0.1
      if (r.deptId === 'director') base = 0.34 + 0.12 * Math.sin(t * 1.3)

      r.glowTarget = base * dim
      // 异常房间：红色脉冲整体压过部门色
      const alarm = err > 0 ? 0.55 + 0.45 * Math.sin(t * 4.2) : 0
      r.glowMat.opacity = lerp(r.glowMat.opacity, r.glowTarget + pulse * 0.34, 0.16)
      if (err > 0) r.glowMat.color.lerp(RED, 0.12 + alarm * 0.12)
      else r.glowMat.color.lerp(r.color, 0.16)

      if (err > 0) {
        r.floorMat.emissive.lerp(RED, 0.1 + alarm * 0.08)
        r.floorMat.emissiveIntensity = lerp(r.floorMat.emissiveIntensity, (0.14 + alarm * 0.16) * dim, 0.16)
      } else {
        r.floorMat.emissive.lerp(r.softColor, 0.12)
        r.floorMat.emissiveIntensity = lerp(
          r.floorMat.emissiveIntensity,
          (0.028 + ratio * 0.075) * dim + (inMeet ? 0.03 : 0),
          0.12
        )
      }
      r.stripMat.opacity = lerp(r.stripMat.opacity, (0.35 + ratio * 0.55) * dim, 0.12)
    }
  }

  private updateRing() {
    const id = this.focusDept
    if (!id) {
      this.ring.visible = false
      return
    }
    const room = this.roomById.get(id)
    if (!room) return
    this.ring.visible = true
    const { rect } = room
    const w = rect.w + 0.12
    const dpt = rect.d + 0.12
    const kids = this.ring.children as THREE.Mesh[]
    const th = 0.055
    const set = (m: THREE.Mesh, sw: number, sd: number, x: number, z: number) => {
      m.scale.set(sw, 1, sd)
      m.position.set(rect.x + x, 0.5, rect.z + z)
    }
    set(kids[0], w, th, 0, -dpt / 2)
    set(kids[1], w, th, 0, dpt / 2)
    set(kids[2], th, dpt, -w / 2, 0)
    set(kids[3], th, dpt, w / 2, 0)
    this.ringMat.opacity = 0.55 + 0.35 * Math.sin(performance.now() * 0.004)
  }

  /** 帧率太低时自动降级：先降分辨率，再关泛光 */
  private checkPerf(dt: number) {
    this.frameAcc += dt
    this.frameCnt++
    if (this.frameCnt < 100) return
    const avg = this.frameAcc / this.frameCnt
    this.avgMs = avg * 1000
    this.frameAcc = 0
    this.frameCnt = 0
    if (this.perfWarmup > 0) {
      this.perfWarmup--
      return
    }
    if (this.lockQuality) return
    if (avg > 0.026 && this.quality === 2) {
      this.quality = 1
      this.applyQuality()
    } else if (avg > 0.033 && this.quality === 1) {
      this.quality = 0
      this.applyQuality()
    }
  }

  private applyQuality() {
    if (this.quality === 2) {
      this.dprCap = 1.5
      this.useBloom = true
    } else if (this.quality === 1) {
      this.dprCap = 1.1
      this.useBloom = true
    } else {
      this.dprCap = 1
      this.useBloom = false
    }
    // 阴影是第二大开销：掉到最低档就关掉，保留泛光
    if (this.keyLight) {
      const want = this.quality > 0
      if (this.keyLight.castShadow !== want) {
        this.keyLight.castShadow = want
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material
          if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true))
        })
      }
    }
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap))
    this.renderer.setSize(w, h)
    this.composer?.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap))
    this.composer?.setSize(w, h)
  }

  /** 调试：直接把参会人瞬移到座位上（无头截图用，绕过 rAF 不跑的问题） */
  snapMeeting() {
    const m = world.meeting
    if (!m) return
    for (const id of m.agentIds) {
      const i = this.agentIndexById.get(id)
      if (i === undefined) continue
      const a = world.agents[i]
      if (a.seatIndex == null) continue
      const seat = this.seats[a.seatIndex]
      this.walkPos[i].x = seat.x
      this.walkPos[i].z = seat.z
      this.routes[i] = []
      this.routeHead[i] = 0
    }
  }

  /** 调试：输出会议参与者的行走坐标 */
  debugPos() {
    const m = world.meeting
    if (!m) return 'no-meeting'
    return m.agentIds
      .map((id) => {
        const i = this.agentIndexById.get(id)!
        const a = world.agents[i]
        const p = this.walkPos[i]
        const r = this.routes[i]
        return `${a.name}@(${p.x.toFixed(1)},${p.z.toFixed(1)})s${a.seatIndex} h${this.routeHead[i]}/${r.length}`
      })
      .join(' ; ')
  }

  get stats() {
    return {
      avgMs: this.avgMs,
      quality: this.quality,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
    }
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    // 下限 4ms：无头/虚拟时钟下 getDelta 可能为 0，会让动画卡死
    const dt = Math.min(0.05, Math.max(0.004, this.clock.getDelta()))
    this.renderer.info.reset()
    const t = this.clock.elapsedTime

    if (this.userCooldown > 0) this.userCooldown -= dt
    this.roam(dt)
    this.applyCamera()
    this.updateAgents(t, dt)
    this.updateRooms(t)
    this.updateRing()

    if (this.marker.visible) {
      const k = 1 + Math.sin(t * 3.2) * 0.12
      this.markerRing.scale.set(k, k, 1)
      this.markerRing.rotation.z = t * 0.8
    }
    if (this.dust) this.dust.rotation.y += dt * 0.01

    if (this.composer && this.useBloom) this.composer.render()
    else this.renderer.render(this.scene, this.camera)

    this.checkPerf(dt)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('pointerleave', this.onLeave)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    el.remove()
  }
}
