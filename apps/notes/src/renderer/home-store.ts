/** 首页设置在界面里只有一份：首页上编辑和设置页「首页」改的是同一个，改了立刻存进库里 */
import { useEffect, useState } from 'react'
import type { HomeConfig } from '../shared/home'

let current: HomeConfig | null = null
let loading: Promise<void> | null = null
const listeners = new Set<(c: HomeConfig) => void>()

function emit(c: HomeConfig) {
  current = c
  for (const l of listeners) l(c)
}

/** 从库里重新读（同步拉下来别处改过的首页时用） */
export function reloadHome(): Promise<void> {
  loading = window.cn.homeConfig().then(emit)
  return loading
}

/** 先在界面上换，再存；存回来的是检查过的样子 */
export async function saveHome(c: HomeConfig): Promise<HomeConfig> {
  emit(c)
  const saved = await window.cn.saveHomeConfig(c)
  emit(saved)
  return saved
}

export function useHomeConfig(): HomeConfig | null {
  const [c, setC] = useState<HomeConfig | null>(current)
  useEffect(() => {
    listeners.add(setC)
    if (!current && !loading) void reloadHome()
    else if (current) setC(current)
    return () => void listeners.delete(setC)
  }, [])
  return c
}

/** 换库时清掉，下次按新库读 */
export function resetHome() {
  current = null
  loading = null
}
