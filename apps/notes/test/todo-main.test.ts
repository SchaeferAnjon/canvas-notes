/**
 * 待办三处改库里那一行（task-pd1d1）：主进程这边的纯计算。只换那一行的那几个字（@cn/tasks），
 * 外面在上面加了几行也认得出是哪一行；加一条照定稿的写法接在最后一条后面；撤回照三方合并只退那一处；
 * 文件夹首页卡里存在 .首页.json 的旧待办搬进 <文件夹>/待办.md 时一条一行。
 */
import { describe, expect, it } from 'vitest'
import { addTodoText, editTodoText, legacyTodoLines, locateTodo, revertText } from '../src/main/todo-edit'

const TODAY = '2026-11-22'
const NOTE = '# 小论文计划\n\n截稿前把实验和初稿弄完。\n\n- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 ⏫\n- [ ] 读完三篇相关论文 📅 2026-11-22\n'
const ids = () => 'abc123'

describe('认那一行', () => {
  it('行号还对就是它；上面多了几行按原文找最近的；按 🆔 找；都没有是 null', () => {
    expect(locateTodo(NOTE, 5, '- [ ] 读完三篇相关论文 📅 2026-11-22')).toBe(5)
    const moved = '一行新的\n' + NOTE
    expect(locateTodo(moved, 5, '- [ ] 读完三篇相关论文 📅 2026-11-22')).toBe(6)
    expect(locateTodo('- [ ] 改了标题 🆔 k1\n', 3, '- [ ] 原来的标题 🆔 k1')).toBe(0)
    expect(locateTodo(NOTE, 5, '- [ ] 没有这一条')).toBeNull()
  })
})

describe('改一行只动那几个字', () => {
  it('勾掉：[ ] 换成 [x]、行尾加 ✅ 今天；别的行一个字不动', () => {
    const r = editTodoText(NOTE, 5, '- [ ] 读完三篇相关论文 📅 2026-11-22', { op: 'done', done: true }, TODAY, ids)!
    expect(r.text).toBe(NOTE.replace('- [ ] 读完三篇相关论文 📅 2026-11-22', '- [x] 读完三篇相关论文 📅 2026-11-22 ✅ 2026-11-22'))
    expect(r.line).toBe(5)
    expect(r.raw).toBe('- [x] 读完三篇相关论文 📅 2026-11-22 ✅ 2026-11-22')
    // 再取消勾选：回到原样
    const back = editTodoText(r.text, 5, r.raw, { op: 'done', done: false }, TODAY, ids)!
    expect(back.text).toBe(NOTE)
  })
  it('改日子只换那十个字，钟点留着；拿掉日子连钟点一起拿掉', () => {
    const r = editTodoText(NOTE, 4, '- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 ⏫', { op: 'date', date: TODAY }, TODAY, ids)!
    expect(r.raw).toBe('- [ ] 交论文初稿 📅 2026-11-22 15:00 🔔 提前1小时 ⏫')
    const none = editTodoText(NOTE, 4, '- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 ⏫', { op: 'date', date: null }, TODAY, ids)!
    expect(none.raw).toBe('- [ ] 交论文初稿 🔔 提前1小时 ⏫')
  })
  it('没日子的加日子：照定稿的先后插在优先级前面', () => {
    const r = editTodoText('- [ ] 买打印纸 ⏫\n', 0, '- [ ] 买打印纸 ⏫', { op: 'date', date: '2026-11-23' }, TODAY, ids)!
    expect(r.text).toBe('- [ ] 买打印纸 📅 2026-11-23 ⏫\n')
  })
  it('钟点、提醒、重复；设了提醒的给一个 🆔', () => {
    const line = '- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 ⏫'
    expect(editTodoText(NOTE, 4, line, { op: 'time', time: '20:00' }, TODAY, ids)!.raw).toBe('- [ ] 交论文初稿 📅 2026-11-23 20:00 🔔 提前1小时 ⏫')
    expect(editTodoText(NOTE, 4, line, { op: 'time', time: null }, TODAY, ids)!.raw).toBe('- [ ] 交论文初稿 📅 2026-11-23 🔔 提前1小时 ⏫')
    expect(editTodoText(NOTE, 4, line, { op: 'repeat', repeat: '每周日' }, TODAY, ids)!.raw).toBe('- [ ] 交论文初稿 📅 2026-11-23 15:00 🔔 提前1小时 🔁 每周日 ⏫')
    expect(editTodoText('- [ ] 取快递 📅 2026-11-22 18:00\n', 0, '- [ ] 取快递 📅 2026-11-22 18:00', { op: 'remind', remind: '准时' }, TODAY, ids)!.raw).toBe('- [ ] 取快递 📅 2026-11-22 18:00 🔔 准时 🆔 abc123')
    expect(editTodoText(NOTE, 4, line, { op: 'remind', remind: null }, TODAY, ids)!.raw).toBe('- [ ] 交论文初稿 📅 2026-11-23 15:00 ⏫')
  })
  it('勾掉重复的：下面加下一次那一行', () => {
    const r = editTodoText('- [ ] 倒垃圾 📅 2026-11-22 🔁 每周日\n', 0, '- [ ] 倒垃圾 📅 2026-11-22 🔁 每周日', { op: 'done', done: true }, TODAY, ids)!
    expect(r.text).toBe('- [x] 倒垃圾 📅 2026-11-22 🔁 每周日 ✅ 2026-11-22\n- [ ] 倒垃圾 📅 2026-11-29 🔁 每周日\n')
  })
  it('找不到那一行：null（不改）', () => {
    expect(editTodoText(NOTE, 4, '- [ ] 被别处删了', { op: 'done', done: true }, TODAY, ids)).toBeNull()
  })
})

describe('加一条', () => {
  it('接在最后一条待办后面；这一篇还没有就建「# 待办」', () => {
    expect(addTodoText('# 待办\n\n- [ ] 回导师邮件\n\n一段字\n', '待办', '- [ ] 交论文 📅 2026-11-23 15:00')).toEqual({ text: '# 待办\n\n- [ ] 回导师邮件\n- [ ] 交论文 📅 2026-11-23 15:00\n\n一段字\n', line: 3 })
    expect(addTodoText(null, '待办', '- [ ] 周末整理参考文献')).toEqual({ text: '# 待办\n\n- [ ] 周末整理参考文献\n', line: 2 })
    expect(addTodoText('# 小论文计划\n\n截稿前弄完。\n', '小论文计划', '- [ ] 交稿')).toEqual({ text: '# 小论文计划\n\n截稿前弄完。\n\n- [ ] 交稿\n', line: 4 })
  })
})

describe('撤回', () => {
  it('盘上还是改完的样子就换回去；后来别处又改了，只退这一处；合不了是 null', () => {
    const before = 'a\n- [ ] x\nb\n'
    const after = 'a\n- [x] x ✅ 2026-11-22\nb\n'
    expect(revertText(before, after, after)).toBe(before)
    expect(revertText(before, after, 'a\n- [x] x ✅ 2026-11-22\nb\nc\n')).toBe('a\n- [ ] x\nb\nc\n')
    expect(revertText(before, after, 'a\n- [x] x ✅ 2026-11-22 改了\nb\n')).toBeNull()
  })
})

describe('首页卡里的旧待办搬进 待办.md', () => {
  it('一条一行：[x] 开头的是做完的，字原样', () => {
    expect(legacyTodoLines(['交房租', '[x] 买菜', '  ', '[x]   带伞'])).toEqual(['- [ ] 交房租', '- [x] 买菜', '- [x] 带伞'])
  })
})
