// 英文库的分类文件夹名（task-zojmg 第二批，库语言，设计稿第 4 节）：库语言是英文时八个分类叫 Inbox、Courses…，
// 代码里认分类、拼路径的地方都跟着换；换回中文库一切照旧（中文库和以前一模一样）。
import { afterEach, describe, expect, it } from 'vitest'
import { CATEGORIES, CATEGORY_IDS, CATEGORY_NAMES, catId, catName, categoryOf, groupLeft, isCategory, isChildOf, underCat } from '../src/shared/categories'
import { CLIPS, INBOX, kindOf } from '../src/shared/layout'
import { DEFAULT_LEFT, defaultColor, defaultIcon, normalizeLeft } from '../src/shared/left'
import { TOP_ORDER, topGroups } from '../src/shared/files'
import { folderKind, templateFileOf } from '../src/shared/folder-home'
import { INBOX_TODO } from '../src/shared/todo'
import { inboxPathFor, VIDEO_FOLDER } from '../src/shared/video'
import { weekPath } from '../src/shared/cmd-run'
import { WEREAD_FOLDER } from '../src/shared/plugins/weread'
import { coursesOf } from '../src/shared/mindmap'
import { filePrompt, placesOf, validFolder } from '../src/shared/filing'
import { inferRoles } from '../src/shared/vault-roles'
import { DEFAULT_DREAM, filesOn, inDreamFolders, linkFolders, normalizeDream, weekOn } from '../src/shared/dream-settings'
import { courseDeckOf, deckFor } from '../src/main/reading/anki'
import { setVaultLang } from '../src/shared/i18n'

const EN = ['Inbox', 'Courses', 'Reading', 'Clippings', 'Weekly', 'Writing', 'Projects', 'Life']
const ZH = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']

afterEach(() => setVaultLang('zh'))

describe('中文库（没记库语言的都是中文库）：和以前一模一样', () => {
  it('分类名、收件箱、剪藏、待办那篇、视频文件夹、周记、书摘都是中文', () => {
    expect(CATEGORY_NAMES).toEqual(ZH)
    expect(CATEGORIES.map((c) => c.name)).toEqual(ZH)
    expect([INBOX, CLIPS, INBOX_TODO, VIDEO_FOLDER, WEREAD_FOLDER]).toEqual(['收件箱', '剪藏', '收件箱/待办.md', '剪藏/视频', '阅读'])
    expect(weekPath('2026-W47')).toBe('周记/2026-W47 周记.md')
    expect(inboxPathFor('猫')).toBe('收件箱/猫.md')
    expect(courseDeckOf('课程/ecp/Week 2/x.pdf')).toBe('课程::ecp')
    expect(deckFor('课程/ecp/Lecture05.pdf')).toBe('课程::ecp::Lecture05')
  })
})

describe('英文库：八个分类叫英文名，认分类、拼路径的地方都跟着换', () => {
  it('分类表原地换成英文名；身份（中文名）不变；别处 import 进去的同一个数组跟着换', () => {
    setVaultLang('en')
    expect(CATEGORY_NAMES).toEqual(EN)
    expect(CATEGORIES.map((c) => c.name)).toEqual(EN)
    expect(CATEGORY_IDS).toEqual(ZH)
    expect(TOP_ORDER).toEqual(EN)
    expect(DEFAULT_LEFT).toEqual(EN)
    expect(catName('课程')).toBe('Courses')
    expect(catId('Courses')).toBe('课程')
    expect(catId('课程')).toBeUndefined()
    expect(isCategory('Reading')).toBe(true)
    expect(isCategory('阅读')).toBe(false)
    expect(categoryOf('Clippings')?.icon).toBe('bookmark')
    // 图标、颜色、组跟着分类走，和中文库一样
    expect(categoryOf('Courses')).toMatchObject({ icon: 'folder-library', color: 'sky', group: '读进来的' })
  })

  it('收件箱、剪藏、待办那篇、视频、周记、书摘、新视频那篇都在英文文件夹里', () => {
    setVaultLang('en')
    expect([INBOX, CLIPS, INBOX_TODO, VIDEO_FOLDER, WEREAD_FOLDER]).toEqual(['Inbox', 'Clippings', 'Inbox/待办.md', 'Clippings/Videos', 'Reading'])
    expect(weekPath('2026-W47')).toBe('Weekly/2026-W47 Weekly.md')
    expect(inboxPathFor('Cats')).toBe('Inbox/Cats.md')
    expect(kindOf('Inbox/idea.md')).toEqual({ kind: 'inbox' })
    expect(kindOf('Inbox/待办.md')).toEqual({ kind: 'work' })
    expect(kindOf('Clippings/Travel/Paris.md')).toEqual({ kind: 'clip', topic: 'Travel' })
    // 英文库里叫「收件箱」的是用户自己的文件夹
    expect(kindOf('收件箱/idea.md')).toEqual({ kind: 'work' })
  })

  it('左栏：默认摘整套英文分类；老文件补上来的是英文分类；分段、图标、颜色认英文名', () => {
    setVaultLang('en')
    expect(normalizeLeft({ 左边: ['Trips'] }).left).toEqual([...EN, 'Trips'])
    expect(groupLeft(['Writing', 'Inbox', 'Reading/Sapiens', 'Courses', 'Life'])).toEqual([['Inbox'], ['Courses'], ['Writing', 'Life'], ['Reading/Sapiens']])
    expect(groupLeft(['Writing', 'Inbox', 'Trips'], false)).toEqual([['Inbox'], ['Writing', 'Trips']])
    expect([defaultIcon('Courses/ML'), defaultColor('Courses/ML')]).toEqual(['folder-library', 'sky'])
    expect([defaultIcon('Reading/Sapiens'), defaultColor('Reading/Sapiens')]).toEqual(['book', 'green'])
    expect([defaultIcon('课程/ML'), defaultColor('课程/ML')]).toEqual(['folder', null])
    expect([isChildOf('Courses/ML', '课程'), isChildOf('Courses/ML/Week 1', '课程'), isChildOf('Courses', '课程')]).toEqual([true, false, false])
    expect([underCat('Weekly/2026-W47.md', '周记'), underCat('周记/x.md', '周记')]).toEqual([true, false])
  })

  it('文件树最外层：收件箱单独在前，「读进来的」「自己写的」两组按英文名排', () => {
    setVaultLang('en')
    const dir = (name: string) => ({ path: name, name, kind: 'dir' as const, children: [], count: 1, time: 0 })
    const groups = topGroups([dir('Life'), dir('Inbox'), dir('Courses'), dir('Trips')], true)
    expect(groups.map((g) => [g.title, g.nodes.map((n) => n.name)])).toEqual([
      ['', ['Inbox']],
      ['读进来的', ['Courses', 'Reading', 'Clippings']],
      ['自己写的', ['Weekly', 'Writing', 'Projects', 'Life']],
      ['不在分类里的', ['Trips']],
    ])
  })

  it('文件夹首页认得出课程、项目、生活、写作；模板放在英文的「课程」「项目」里', () => {
    setVaultLang('en')
    expect(['Courses', 'Courses/ML', 'Projects/Trip', 'Life', 'Writing', '课程'].map(folderKind)).toEqual(['courses', 'course', 'project', 'life', 'writing', null])
    expect([templateFileOf('course'), templateFileOf('project')]).toEqual(['Courses/.首页模板.json', 'Projects/.首页模板.json'])
    expect(coursesOf(['Courses/ML/a.md', 'Courses/Linear Algebra/b.md', '课程/中文/c.md'])).toEqual(['Linear Algebra', 'ML'])
  })

  it('归类：能挪去的地方、库里已有的去处、给 AI 的去处都照英文名（提示词本身不翻）', () => {
    setVaultLang('en')
    const files = ['Courses/ML/a.md', 'Life/b.md', 'Clippings/Travel/c.md', 'Inbox/d.md']
    const places = placesOf(files, inferRoles(files, new Map()))
    expect(['Courses/ML', 'Projects/Trip', 'Life', 'Clippings/Travel', 'Clippings', '课程/ML', 'Life/x'].map((f) => validFolder(f, places))).toEqual([true, true, true, true, false, false, false])
    expect(places.map((p) => p.folder)).toEqual(['Clippings', 'Clippings/Travel', 'Courses', 'Courses/ML', 'Life', 'Projects', 'Reading', 'Weekly', 'Writing'])
    const p = filePrompt([{ path: 'Inbox/a.md', preview: 'x', props: '' }], places)
    expect(p).toContain('- Courses/ML｜课程｜1 篇，如：a｜能新建一层')
    expect(p).toContain('"path": "Inbox/…", "folder": "<上面的一个文件夹>"')
  })

  it('梦游：设置里存分类的身份（中文名），英文库里换成英文文件夹名去比', () => {
    setVaultLang('en')
    expect(DEFAULT_DREAM.folders).toEqual(['收件箱', '阅读', '剪藏', '周记'])
    expect(inDreamFolders(DEFAULT_DREAM, 'Inbox/a.md')).toBe(true)
    expect(inDreamFolders(DEFAULT_DREAM, 'Courses/ML/a.md')).toBe(false)
    expect(linkFolders(DEFAULT_DREAM)).toEqual(['Inbox', 'Reading', 'Clippings'])
    expect([filesOn(DEFAULT_DREAM), weekOn(DEFAULT_DREAM)]).toEqual([true, true])
    expect(normalizeDream({ folders: ['课程', 'Courses', '收件箱'] }).folders).toEqual(['收件箱', '课程'])
  })

  it('出卡的牌组跟着英文的「课程」文件夹走', () => {
    setVaultLang('en')
    expect(courseDeckOf('Courses/ecp/Week 2/x.pdf')).toBe('Courses::ecp')
    expect(deckFor('Courses/ecp/Week 2/补充材料/x.pdf')).toBe('Courses::ecp::Week 2::补充材料')
    expect(courseDeckOf('课程/ecp/x.pdf')).toBeNull()
  })

  it('换回中文库：全部回到中文名', () => {
    setVaultLang('en')
    setVaultLang('zh')
    expect([CATEGORY_NAMES, TOP_ORDER, DEFAULT_LEFT]).toEqual([ZH, ZH, ZH])
    expect([INBOX, CLIPS, INBOX_TODO, VIDEO_FOLDER, WEREAD_FOLDER]).toEqual(['收件箱', '剪藏', '收件箱/待办.md', '剪藏/视频', '阅读'])
  })
})
