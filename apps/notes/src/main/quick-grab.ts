/**
 * 速记弹出前拿前台软件里选中的字（quick.ts 用；单元测试 test/quick-grab.test.ts 换假的剪贴板和按键）。
 * 先存好剪贴板，放一个记号，等按快捷键的手松开，按 ⌘C，等剪贴板变了再读，最后把剪贴板还原。
 *
 * 收件箱「速记抓不到内容」（用户：有时抓不到）查到的三种偶发，都在这里守：
 * - ⌥⌘N 的 ⌥ 还按着时发出去的 ⌘C，前台软件收到的是 ⌥⌘C（浏览器里是开检查器，别的软件什么都不做），字没拷出来：先等 ⌥ ⇧ ⌃ 松开（最多 1 秒）；
 * - 前台软件拷得慢（长的一大段、忙着的浏览器、PDF 阅读器）：以前只等 0.48 秒就当没选字，晚到的字还把还原好的剪贴板盖掉：现在等 1.5 秒；
 * - 连按两下：两次交错着放记号、存剪贴板，后一次把前一次的记号当成「原来的剪贴板」存下又还原回去：现在一次做完再做下一次。
 */

export interface GrabDeps<S> {
  /** 剪贴板里原来的东西（每种格式） */
  save(): Promise<S>
  restore(saved: S): Promise<void>
  writeText(text: string): Promise<void>
  readText(): Promise<string>
  /** 等键盘上 ⌥ ⇧ ⌃ 都松开，最多等 maxMs */
  keysUp(maxMs: number): Promise<void>
  /** 让前台软件拷贝一次（模拟 ⌘C） */
  pressCopy(): Promise<void>
  sleep(ms: number): Promise<void>
}

/** 等前台软件把字放进剪贴板最多等多久 */
export const COPY_WAIT_MS = 1500
/** 等按快捷键的手松开最多等多久 */
export const KEYS_UP_MS = 1000
const STEP_MS = 40

let queue: Promise<unknown> = Promise.resolve()

export function grabSelection<S>(d: GrabDeps<S>): Promise<string> {
  const run = queue.then(() => grabOnce(d))
  queue = run.catch(() => undefined)
  return run
}

async function grabOnce<S>(d: GrabDeps<S>): Promise<string> {
  const saved = await d.save()
  const mark = `cn-quick-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await d.writeText(mark)
  let got = ''
  try {
    await d.keysUp(KEYS_UP_MS)
    await d.pressCopy()
    for (let waited = 0; waited < COPY_WAIT_MS; waited += STEP_MS) {
      await d.sleep(STEP_MS)
      const t = await d.readText()
      if (t !== mark) {
        got = t
        break
      }
    }
  } finally {
    // 还原不了：剪贴板里留着选中的字（或记号），拿到的字照样交回
    await d.restore(saved).catch((e) => console.error('速记：还原剪贴板没成', e))
  }
  return got
}

/**
 * 等 ⌥ ⇧ ⌃ 松开（读键盘状态不要任何权限，不发按键）：参数是最多等几毫秒，回的是等了几毫秒。
 * ⌘ 不用等：发的本来就是 ⌘C
 */
export const KEYS_UP_JXA = `ObjC.import('CoreGraphics');
function run(argv) {
  const max = Number(argv[0]) || 0;
  const mask = $.kCGEventFlagMaskAlternate | $.kCGEventFlagMaskShift | $.kCGEventFlagMaskControl;
  const t0 = Date.now();
  while (($.CGEventSourceFlagsState($.kCGEventSourceStateHIDSystemState) & mask) && Date.now() - t0 < max) delay(0.02);
  return String(Date.now() - t0);
}`

/** 模拟一次 ⌘C（CGEvent，只要辅助功能权限，不用控制「系统事件」的自动化权限） */
export const COPY_JXA = `ObjC.import('CoreGraphics');
const src = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);
for (const down of [true, false]) {
  const e = $.CGEventCreateKeyboardEvent(src, 8, down);
  $.CGEventSetFlags(e, $.kCGEventFlagMaskCommand);
  $.CGEventPost($.kCGHIDEventTap, e);
}`
