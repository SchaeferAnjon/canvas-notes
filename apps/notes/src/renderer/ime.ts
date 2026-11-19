/**
 * 输入法还在组字（拼音没上屏）时的回车、Esc 是给输入法的：起名框、改名框不能把它当成「好了」（CN-115：
 * 打 ecp 时按回车，拼音串「e'c'p」被当成了文件夹名）。每个处理回车的输入框，onKeyDown 第一句先问它
 * （test/ime-enter.test.ts 扫一遍 renderer，输入框处理了 Enter 却没问的就失败）。
 */
export const composing = (e: { nativeEvent?: KeyboardEvent; isComposing?: boolean; keyCode?: number }) => !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229
