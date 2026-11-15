/**
 * 测试模式（CN_E2E=1，或通用的 E2E=1）：软件照常跑，但不抢用户的屏幕——
 * 窗口放在屏幕外、只用 showInactive() 显示（不激活软件、不抢焦点），程序坞里不出图标，
 * 窗口在后台也照常渲染（截图、动画、定时器都正常）。
 */
export const E2E = process.env.CN_E2E === '1' || process.env.E2E === '1'
