import * as THREE from 'three'

/**
 * 程序化贴图工厂。全部用 canvas 画，零外部资源、零网络请求，
 * 一次性生成后按 key 缓存复用。
 */

const cache = new Map<string, THREE.Texture>()

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function make(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts?: { srgb?: boolean; repeat?: boolean; aniso?: number }
) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  draw(ctx, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = opts?.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  if (opts?.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = opts?.aniso ?? 4
  t.needsUpdate = true
  cache.set(key, t)
  return t
}

/* ------------------------------------------------------------------ 光晕类 */

export function radialTexture(inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  return make(`radial:${inner}:${outer}`, 256, 256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, inner)
    g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.35)'))
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })
}

export function spriteTexture() {
  return make('sprite', 128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })
}

export function gridTexture() {
  return make(
    'grid',
    256,
    256,
    (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = 'rgba(120,160,220,0.55)'
      ctx.lineWidth = 1.4
      ctx.strokeRect(0.7, 0.7, w - 1.4, w - 1.4)
      ctx.strokeStyle = 'rgba(120,160,220,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(w / 2, 0)
      ctx.lineTo(w / 2, w)
      ctx.moveTo(0, w / 2)
      ctx.lineTo(w, w / 2)
      ctx.stroke()
    },
    { repeat: true }
  )
}

/** 横向光带：中间亮两头淡，用于窗光和灯带 */
export function bandTexture() {
  return make('band', 64, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.42, 'rgba(255,255,255,0.92)')
    g.addColorStop(0.58, 'rgba(255,255,255,0.92)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

/* ------------------------------------------------------------------ 地面 */

/** 满铺地毯：中性灰，靠材质 color 上色 */
export function carpetTexture() {
  return make(
    'carpet',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry32(7781)
      ctx.fillStyle = '#a7acb4'
      ctx.fillRect(0, 0, w, h)
      // 绒线短簇
      for (let i = 0; i < 14000; i++) {
        const x = rnd() * w
        const y = rnd() * h
        const v = 0.5 + rnd() * 0.72
        ctx.fillStyle = `rgba(${(176 * v) | 0},${(180 * v) | 0},${(188 * v) | 0},0.55)`
        ctx.fillRect(x, y, 1.8, 1.8)
      }
      // 织纹走向
      for (let y = 0; y < h; y += 3) {
        ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.04 * (y % 6 === 0 ? 1 : 0)})`
        ctx.fillRect(0, y, w, 1)
      }
      for (let x = 0; x < w; x += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)'
        ctx.fillRect(x, 0, 1, h)
      }
      // 方块地毯的拼缝
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = 1.6
      ctx.strokeRect(0.8, 0.8, w - 1.6, h - 1.6)
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(w / 2, 0)
      ctx.lineTo(w / 2, h)
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()
    },
    { repeat: true }
  )
}

/** 地面除尘用的粗糙度噪声 */
export function noiseTexture() {
  return make(
    'noise',
    128,
    128,
    (ctx, w, h) => {
      const rnd = mulberry32(4242)
      const img = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const v = 150 + rnd() * 105
        img.data[i * 4] = v
        img.data[i * 4 + 1] = v
        img.data[i * 4 + 2] = v
        img.data[i * 4 + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
    },
    { srgb: false, repeat: true }
  )
}

/* ------------------------------------------------------------------ 木作 / 石材 */

/** 台面木纹（浅灰底，靠 color 上色） */
export function laminateTexture() {
  return make(
    'laminate',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry32(991)
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#f0f4f9')
      g.addColorStop(0.5, '#d6dde6')
      g.addColorStop(1, '#e6ebf2')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // 长纹理
      for (let i = 0; i < 90; i++) {
        const y0 = rnd() * h
        const amp = 2 + rnd() * 6
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '96,106,122' : '176,186,200'},${0.07 + rnd() * 0.12})`
        ctx.lineWidth = 0.6 + rnd() * 1.4
        for (let x = 0; x <= w; x += 8) {
          const y = y0 + Math.sin((x / w) * Math.PI * 2 + i) * amp
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      // 细密颗粒
      for (let i = 0; i < 2400; i++) {
        ctx.fillStyle = `rgba(70,80,95,${rnd() * 0.06})`
        ctx.fillRect(rnd() * w, rnd() * h, 1, 1)
      }
    },
    { repeat: true }
  )
}

/** 深色木纹（总监班台 / 会议桌） */
export function darkWoodTexture() {
  return make(
    'darkwood',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry32(313)
      ctx.fillStyle = '#8a7256'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 120; i++) {
        const y0 = rnd() * h
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '48,36,24' : '186,158,120'},${0.06 + rnd() * 0.12})`
        ctx.lineWidth = 0.5 + rnd() * 2.2
        for (let x = 0; x <= w; x += 6) {
          const y = y0 + Math.sin((x / w) * Math.PI * 3 + i * 0.7) * (2 + rnd() * 5)
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    },
    { repeat: true }
  )
}

/* ------------------------------------------------------------------ 屏幕 */

/** Agent 工位显示器：代码行 + 迷你走势 + 状态条 */
export function monitorTexture() {
  return make(
    'monitor',
    192,
    120,
    (ctx, w, h) => {
      const rnd = mulberry32(5150)
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#12233a')
      g.addColorStop(1, '#0a1524')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      // 标题栏
      ctx.fillStyle = 'rgba(120,190,255,0.16)'
      ctx.fillRect(0, 0, w, 13)
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#ff6b6b', '#ffca5c', '#5ce08a'][i]
        ctx.beginPath()
        ctx.arc(7 + i * 7, 6.5, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(160,215,255,0.55)'
      ctx.fillRect(30, 4.5, 46, 4)

      // 代码行
      const colors = ['rgba(126,214,255,0.9)', 'rgba(178,152,255,0.85)', 'rgba(255,208,130,0.85)', 'rgba(150,230,190,0.8)']
      for (let row = 0; row < 7; row++) {
        const y = 19 + row * 9
        let x = 7
        const segs = 2 + ((rnd() * 4) | 0)
        for (let k = 0; k < segs; k++) {
          const len = 8 + rnd() * 30
          ctx.fillStyle = colors[(rnd() * colors.length) | 0]
          ctx.globalAlpha = 0.55 + rnd() * 0.45
          ctx.fillRect(x, y, Math.min(len, w - 58 - x), 3)
          x += len + 5
          if (x > w - 60) break
        }
        ctx.globalAlpha = 1
      }

      // 右侧走势面板
      ctx.fillStyle = 'rgba(80,150,220,0.1)'
      ctx.fillRect(w - 50, 17, 43, 58)
      ctx.strokeStyle = 'rgba(70,224,176,0.95)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      let px = w - 47
      let py = 62
      for (let i = 0; i < 12; i++) {
        px += 3.7
        py = 62 - Math.sin(i * 0.9) * 12 - rnd() * 6
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.fillStyle = 'rgba(70,224,176,0.16)'
      ctx.lineTo(px, 75)
      ctx.lineTo(w - 47, 75)
      ctx.closePath()
      ctx.fill()

      // 底部进度条
      ctx.fillStyle = 'rgba(255,255,255,0.1)'
      ctx.fillRect(7, h - 10, w - 14, 3.5)
      ctx.fillStyle = 'rgba(120,205,255,0.9)'
      ctx.fillRect(7, h - 10, (w - 14) * 0.62, 3.5)

      // 细扫描线
      for (let y = 0; y < h; y += 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.fillRect(0, y, w, 1)
      }
    },
    { repeat: false }
  )
}

/** 大屏：柱状 + 折线 + 指标块 */
export function bigScreenTexture() {
  return make(
    'bigscreen',
    320,
    200,
    (ctx, w, h) => {
      const rnd = mulberry32(2027)
      ctx.fillStyle = '#050e18'
      ctx.fillRect(0, 0, w, h)

      // 网格
      ctx.strokeStyle = 'rgba(80,150,210,0.13)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 16) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = 0; y < h; y += 16) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // 顶部标题
      ctx.fillStyle = 'rgba(150,215,255,0.85)'
      ctx.fillRect(12, 10, 92, 7)
      ctx.fillStyle = 'rgba(120,180,225,0.35)'
      ctx.fillRect(12, 22, 58, 4)

      // 三个指标块
      for (let i = 0; i < 3; i++) {
        const x = 12 + i * 62
        ctx.fillStyle = 'rgba(90,180,235,0.1)'
        ctx.fillRect(x, 34, 54, 26)
        ctx.fillStyle = ['#7fe3ff', '#ffd27a', '#8affc9'][i]
        ctx.fillRect(x + 5, 39, 22 + rnd() * 14, 7)
        ctx.fillStyle = 'rgba(160,200,230,0.4)'
        ctx.fillRect(x + 5, 50, 36, 4)
      }

      // 柱状图
      const baseY = h - 22
      for (let i = 0; i < 11; i++) {
        const bh = 18 + rnd() * 72
        const x = 12 + i * 15
        const g2 = ctx.createLinearGradient(0, baseY - bh, 0, baseY)
        g2.addColorStop(0, 'rgba(120,225,255,0.95)')
        g2.addColorStop(1, 'rgba(40,120,190,0.35)')
        ctx.fillStyle = g2
        ctx.fillRect(x, baseY - bh, 9, bh)
      }
      ctx.strokeStyle = 'rgba(120,190,240,0.3)'
      ctx.beginPath()
      ctx.moveTo(10, baseY)
      ctx.lineTo(w - 10, baseY)
      ctx.stroke()

      // 右侧折线
      ctx.strokeStyle = 'rgba(255,190,110,0.95)'
      ctx.lineWidth = 2
      ctx.beginPath()
      let py = 70
      for (let i = 0; i <= 40; i++) {
        const x = w - 112 + (i * 100) / 40
        py = 74 + Math.sin(i * 0.5) * 14 + rnd() * 7
        if (i === 0) ctx.moveTo(x, py)
        else ctx.lineTo(x, py)
      }
      ctx.stroke()

      // 右下角色块条
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = ['#5ad1e8', '#8ea8ff', '#ffc46b', '#7ff0c2', '#ff8fa3', '#c7a6ff'][i]
        ctx.globalAlpha = 0.85
        ctx.fillRect(w - 112 + i * 18, h - 12, 13, 5)
      }
      ctx.globalAlpha = 1
    },
    { repeat: false }
  )
}

/* ------------------------------------------------------------------ 装饰 */

/** 白板：手写涂鸦 + 便签 + 草图 */
export function whiteboardTexture() {
  return make('whiteboard', 320, 140, (ctx, w, h) => {
    const rnd = mulberry32(8080)
    ctx.fillStyle = '#e6edf2'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(190,205,215,0.5)'
    ctx.fillRect(0, h - 8, w, 8)

    // 标题
    ctx.strokeStyle = 'rgba(38,66,120,0.85)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(14, 24)
    ctx.lineTo(96, 24)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(38,66,120,0.5)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(14, 32)
    ctx.lineTo(72, 32)
    ctx.stroke()

    // 手写线条
    const pen = ['rgba(30,60,120,0.8)', 'rgba(200,60,50,0.8)', 'rgba(30,120,80,0.8)']
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = pen[i % pen.length]
      ctx.lineWidth = 1.2 + rnd()
      ctx.beginPath()
      let x = 14 + rnd() * 20
      let y = 48 + i * 11
      ctx.moveTo(x, y)
      for (let k = 0; k < 5; k++) {
        x += 8 + rnd() * 18
        y += (rnd() - 0.5) * 6
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // 便签
    const note = ['#ffe9a8', '#ffd0cc', '#c9f0dd']
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = note[i]
      ctx.fillRect(w - 92 + (i % 2) * 34, 16 + i * 34, 28, 28)
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      for (let k = 0; k < 3; k++) ctx.fillRect(w - 88 + (i % 2) * 34, 24 + i * 34 + k * 6, 14 + rnd() * 8, 1.6)
    }

    // 右下角示意图
    ctx.strokeStyle = 'rgba(40,80,140,0.7)'
    ctx.lineWidth = 1.4
    for (let i = 0; i < 3; i++) {
      ctx.strokeRect(w - 90 + i * 26, h - 52, 20, 14)
      if (i < 2) {
        ctx.beginPath()
        ctx.moveTo(w - 70 + i * 26, h - 45)
        ctx.lineTo(w - 64 + i * 26, h - 45)
        ctx.stroke()
      }
    }
  })
}

/** 书架：一排书脊 */
export function booksTexture() {
  return make(
    'books',
    128,
    128,
    (ctx, w, h) => {
      const rnd = mulberry32(6161)
      ctx.fillStyle = '#1b2029'
      ctx.fillRect(0, 0, w, h)
      let x = 2
      const palette = ['#8c3b34', '#2f4f7a', '#3d6b52', '#8a6b32', '#5a3f6b', '#2a5f6e', '#7a4a2c', '#46506b']
      while (x < w - 2) {
        const bw = 4 + rnd() * 7
        const bh = 58 + rnd() * 54
        ctx.fillStyle = palette[(rnd() * palette.length) | 0]
        ctx.fillRect(x, h - bh, bw, bh)
        ctx.fillStyle = 'rgba(255,255,255,0.16)'
        ctx.fillRect(x + 1, h - bh + 6, bw - 2, 2)
        ctx.fillStyle = 'rgba(0,0,0,0.28)'
        ctx.fillRect(x + bw - 1, h - bh, 1, bh)
        x += bw + 1 + rnd() * 1.6
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, w, 6)
    },
    { repeat: false }
  )
}

/** 挂画：抽象色块 */
export function artTexture() {
  return make('art', 160, 120, (ctx, w, h) => {
    const rnd = mulberry32(1717)
    ctx.fillStyle = '#1d2531'
    ctx.fillRect(0, 0, w, h)
    const palette = ['#d98a3f', '#3f6f9c', '#c2544a', '#d8c9a4', '#2f4b56']
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = palette[(rnd() * palette.length) | 0]
      ctx.globalAlpha = 0.55 + rnd() * 0.4
      ctx.beginPath()
      const cx = rnd() * w
      const cy = rnd() * h
      ctx.ellipse(cx, cy, 12 + rnd() * 40, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, h * 0.68)
    ctx.bezierCurveTo(w * 0.3, h * 0.4, w * 0.6, h * 0.9, w, h * 0.55)
    ctx.stroke()
  })
}

/** 地毯：几何边框纹样 */
export function rugTexture() {
  return make('rug', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2a2118'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(196,150,90,0.5)'
    ctx.lineWidth = 5
    ctx.strokeRect(14, 14, w - 28, h - 28)
    ctx.lineWidth = 1.6
    ctx.strokeRect(26, 26, w - 52, h - 52)
    // 菱形网格
    ctx.strokeStyle = 'rgba(196,150,90,0.16)'
    ctx.lineWidth = 1.2
    for (let i = -h; i < w; i += 26) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + h, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i + h, 0)
      ctx.lineTo(i, h)
      ctx.stroke()
    }
    // 四角纹
    for (const [cx, cy] of [
      [26, 26],
      [w - 26, 26],
      [26, h - 26],
      [w - 26, h - 26],
    ]) {
      ctx.strokeStyle = 'rgba(206,160,96,0.42)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(cx, cy, 12, 0, Math.PI * 2)
      ctx.stroke()
    }
    // 绒面颗粒
    const rnd = mulberry32(2323)
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(255,235,200,${rnd() * 0.04})`
      ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5)
    }
  })
}

/** 会议桌木纹（深色，带细光泽） */
export function conferenceTexture() {
  return make(
    'conference',
    256,
    128,
    (ctx, w, h) => {
      const rnd = mulberry32(4545)
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#a8b6c8')
      g.addColorStop(0.45, '#c2cede')
      g.addColorStop(0.55, '#b4c1d2')
      g.addColorStop(1, '#9aa7b8')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '45,55,70' : '210,220,235'},${rnd() * 0.08})`
        ctx.lineWidth = 0.6 + rnd() * 1.8
        const y = rnd() * h
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 8, w * 0.7, y + (rnd() - 0.5) * 8, w, y)
        ctx.stroke()
      }
    },
    { repeat: true }
  )
}

/* ------------------------------------------------------------------ 环境光探针 */

/** 一张等距柱状环境图：上冷下暗，带几块柔和窗光，用 PMREM 预滤成 envMap */
export function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const key = 'env'
  const hit = cache.get(key)
  if (hit) return hit

  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#1b2a44')
  g.addColorStop(0.42, '#3a4c6b')
  g.addColorStop(0.55, '#2a3446')
  g.addColorStop(1, '#05070c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // 顶部主光板
  const panels: [number, number, number, number, string][] = [
    [90, 30, 120, 46, 'rgba(210,232,255,0.95)'],
    [300, 22, 96, 40, 'rgba(255,236,208,0.8)'],
    [430, 46, 70, 30, 'rgba(170,205,255,0.7)'],
  ]
  for (const [x, y, pw, ph, col] of panels) {
    const rg = ctx.createRadialGradient(x + pw / 2, y + ph / 2, 0, x + pw / 2, y + ph / 2, pw / 2)
    rg.addColorStop(0, col)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg
    ctx.fillRect(x - pw / 2, y - ph, pw * 2, ph * 3)
  }

  // 地平线暖带
  const hz = ctx.createLinearGradient(0, h * 0.46, 0, h * 0.6)
  hz.addColorStop(0, 'rgba(255,150,80,0)')
  hz.addColorStop(0.5, 'rgba(255,150,80,0.35)')
  hz.addColorStop(1, 'rgba(255,150,80,0)')
  ctx.fillStyle = hz
  ctx.fillRect(0, h * 0.46, w, h * 0.14)

  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromEquirectangular(tex)
  pmrem.dispose()
  tex.dispose()
  cache.set(key, envRT.texture)
  return envRT.texture
}
