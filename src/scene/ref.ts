import type { HQScene } from './HQScene'

/** 场景单例引用：供顶栏等 UI 直接调用相机指令 */
export const sceneRef: { current: HQScene | null } = { current: null }
