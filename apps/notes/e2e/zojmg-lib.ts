// 英文版对照图和英文库测试共用（task-zojmg）：同一份样本库，英文那一遍做成「英文库」：
// 八个分类文件夹换成英文名、记上库语言（.canvas-notes/库.json），和英文界面新建的库一个样子。
export const EN_CAT: Record<string, string> = { 收件箱: 'Inbox', 课程: 'Courses', 阅读: 'Reading', 剪藏: 'Clippings', 周记: 'Weekly', 写作: 'Writing', 项目: 'Projects', 生活: 'Life' }

/** 样本库的英文库版本：最外层是分类的换成英文名，其余原样 */
export function enVault<T extends string | Uint8Array>(lib: Record<string, T>): Record<string, T | string> {
  const out: Record<string, T | string> = {}
  for (const [path, content] of Object.entries(lib)) {
    const [top, ...rest] = path.split('/')
    out[rest.length && EN_CAT[top!] ? [EN_CAT[top!], ...rest].join('/') : path] = content
  }
  out['.canvas-notes/库.json'] = JSON.stringify({ 语言: 'en' }, null, 2) + '\n'
  return out
}

/** 照语言挑一个名字（按钮、标签、对话框的无障碍名字） */
export const L = (lang: 'zh' | 'en', zh: string, en: string) => (lang === 'en' ? en : zh)

/** 这一类在这一遍里叫什么 */
export const cat = (lang: 'zh' | 'en', zh: string) => (lang === 'en' ? (EN_CAT[zh] ?? zh) : zh)
