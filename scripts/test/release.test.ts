import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const brand = JSON.parse(readFileSync(join(ROOT, 'release/brand.json'), 'utf8'))
const tmps: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cn-release-test-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('名字和许可证只写在 release/brand.json 一处', () => {
  test('仓库里现在的各处和 brand.json 一致', () => {
    const out = execFileSync('node', [join(ROOT, 'scripts/brand.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toContain('一致')
  })

  test('改了 brand.json 再跑一次，各处的旧名字、仓库、网址、许可证都换掉；换回去文件和原来一个字节不差', async () => {
    const { FILES } = await import('../brand.mjs')
    const root = tmp()
    const copy = [...FILES.filter((f: string) => existsSync(join(ROOT, f))), 'release/brand.json', 'release/brand.lock.json', 'package.json', 'apps/notes/package.json', 'apps/notes/src/shared/brand.ts']
    for (const f of copy) {
      mkdirSync(dirname(join(root, f)), { recursive: true })
      cpSync(join(ROOT, f), join(root, f))
    }
    const before = Object.fromEntries(copy.map((f) => [f, readFileSync(join(root, f), 'utf8')]))
    const run = (...a: string[]) => execFileSync('node', [join(ROOT, 'scripts/brand.mjs'), ...a], { env: { ...process.env, CN_BRAND_ROOT: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

    const next = { ...brand, name: 'Paper Desk', nameZh: '纸桌', artifact: 'PaperDesk', repo: 'someone/paper-desk', site: 'https://desk.example.com', license: 'MPL-2.0' }
    writeFileSync(join(root, 'release/brand.json'), JSON.stringify(next, null, 2) + '\n')
    expect(() => run('--check')).toThrow()
    run()
    expect(run('--check')).toContain('一致')
    for (const f of FILES.filter((f: string) => existsSync(join(root, f)))) {
      const t = readFileSync(join(root, f), 'utf8')
      expect(t, f).toContain('Paper Desk')
      expect(t, f).not.toMatch(/(?<![\w-])Canvas Notes(?![\w-])/)
      expect(t, f).not.toContain(brand.repo)
    }
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    expect(readme).toContain('[MPL-2.0](LICENSE)')
    expect(readme).toContain('PaperDesk-mac-arm64.dmg')
    expect(readFileSync(join(root, 'README.zh-CN.md'), 'utf8')).toContain('Paper Desk · 纸桌')
    expect(readFileSync(join(root, 'apps/notes/src/shared/brand.ts'), 'utf8')).toContain('name: "Paper Desk"')
    expect(JSON.parse(readFileSync(join(root, 'apps/notes/package.json'), 'utf8'))).toMatchObject({ productName: 'Paper Desk', license: 'MPL-2.0' })
    // 第三方声明里别人的许可证名不在替换范围里（脚本只动 FILES）
    expect(FILES).not.toContain('THIRD_PARTY_NOTICES.md')

    writeFileSync(join(root, 'release/brand.json'), before['release/brand.json']!)
    run()
    for (const f of copy) expect(readFileSync(join(root, f), 'utf8'), f).toBe(before[f])
  })

  // 画布笔记的公开仓库里没有 apps/apple（release/public-exclude.txt），那里跳过
  test.skipIf(!existsSync(join(ROOT, 'apps/apple/project.yml')))('iPhone / iPad 版「用 GitHub 登录」的 Client ID 只写在 brand.json：生成进 Brand.xcconfig，Info.plist 从那里读', () => {
    expect(brand.github).toHaveProperty('oauthClientId')
    const xc = readFileSync(join(ROOT, 'apps/apple/Brand.xcconfig'), 'utf8')
    expect(xc).toContain(`CN_GITHUB_CLIENT_ID = ${brand.github.oauthClientId}`)
    expect(readFileSync(join(ROOT, 'apps/apple/project.yml'), 'utf8')).toContain('CNGitHubClientID: $(CN_GITHUB_CLIENT_ID)')
    const root = tmp()
    for (const f of ['release/brand.json', 'package.json', 'apps/notes/package.json', 'apps/notes/src/shared/brand.ts', 'apps/apple/project.yml']) {
      mkdirSync(dirname(join(root, f)), { recursive: true })
      cpSync(join(ROOT, f), join(root, f))
    }
    writeFileSync(join(root, 'release/brand.json'), JSON.stringify({ ...brand, github: { oauthClientId: 'Ov23liTEST' } }, null, 2) + '\n')
    execFileSync('node', [join(ROOT, 'scripts/brand.mjs')], { env: { ...process.env, CN_BRAND_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(readFileSync(join(root, 'apps/apple/Brand.xcconfig'), 'utf8')).toContain('CN_GITHUB_CLIENT_ID = Ov23liTEST')
  })

  test('应用里用的 BRAND 就是 brand.json 里的', async () => {
    const { BRAND } = await import('../../apps/notes/src/shared/brand')
    expect(BRAND).toMatchObject({ name: brand.name, nameZh: brand.nameZh, appId: brand.appId, license: 'GPL-3.0-or-later' })
  })
})

describe('electron-builder 配置', () => {
  const load = (env: Record<string, string>) => {
    const p = require.resolve(join(ROOT, 'apps/notes/electron-builder.cjs'))
    const saved = { ...process.env }
    Object.assign(process.env, env)
    try {
      delete require.cache[p]
      return require(p)
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }

  test('本机自用：本地签名、不开 hardened runtime、只出 .app', () => {
    const c = load({ CN_RELEASE: '0', CN_NOTARIZE: '0' })
    expect(c).toMatchObject({ appId: 'com.jiazonghan.canvasnotes', productName: 'Canvas Notes' })
    expect(c.mac).toMatchObject({ identity: '-', hardenedRuntime: false, target: 'dir', notarize: false })
  })

  test('发布：Developer ID、hardened runtime、entitlements、dmg + zip，文件名用 CanvasNotes-版本-mac-架构', () => {
    const c = load({ CN_RELEASE: '1', CN_NOTARIZE: '0' })
    expect(c.mac).toMatchObject({ identity: brand.signing.identity, hardenedRuntime: true, target: ['dmg', 'zip'], entitlements: 'build/entitlements.mac.plist', notarize: false })
    expect(c.artifactName).toBe('CanvasNotes-${version}-${os}-${arch}.${ext}')
    // 包里不带 AI 的 SDK（Claude Agent SDK 不是开源许可，2026-11-15 去掉）
    // 带进包里的只有构建出来的和 package.json；别的都是去掉不用的（别的平台的原生库、source map）
    expect(c.files.slice(0, 2)).toEqual(['out/**', 'package.json'])
    expect(c.files.slice(2).every((f: string) => f.startsWith('!'))).toBe(true)
    expect(JSON.stringify(c)).not.toMatch(/anthropic|claude-agent-sdk/i)
    // 按意思搜的本机模型和它的原生运行库（onnxruntime-node 不能在 asar 里）；梦游找候选的 bge-m3 的运行库 node-llama-cpp 同理（task-h7oy8）
    expect(c.asarUnpack).toEqual(['**/node_modules/onnxruntime-node/**', '**/node_modules/node-llama-cpp/**', '**/node_modules/@node-llama-cpp/**'])
    // 模型文件（GGUF）不进包，只带 Mac arm64 Metal 的预编译
    expect(c.files).toContain('!**/*.{gguf,gguf.part}')
    expect(c.files).toContain('!**/node_modules/@node-llama-cpp/{mac-x64,linux-*,win-*}/**')
    expect(c.extraResources).toContainEqual({ from: 'resources/models/multilingual-e5-small', to: 'models/multilingual-e5-small' })
    expect(c.mac.extendInfo.NSAppleEventsUsageDescription).toContain('Canvas Notes')
    const ent = readFileSync(join(ROOT, 'apps/notes/build/entitlements.mac.plist'), 'utf8')
    for (const k of ['allow-jit', 'allow-unsigned-executable-memory', 'disable-library-validation', 'automation.apple-events']) expect(ent).toContain(k)
  })

  test('要公证却没给钥匙串 profile：直接报错，不出一个没公证的包', () => {
    expect(() => load({ CN_RELEASE: '1', CN_NOTARIZE: '1', APPLE_KEYCHAIN_PROFILE: '' })).toThrow(/APPLE_KEYCHAIN_PROFILE/)
    expect(load({ CN_RELEASE: '1', CN_NOTARIZE: '1', APPLE_KEYCHAIN_PROFILE: 'p' }).mac.notarize).toBe(true)
  })
})

describe('开源仓库的导出', () => {
  test('排除规则：design/ 不要，图标源文件和第三版规范留着；CLAUDE.md、交接文档、总站补丁、画布今日、iPhone / iPad 版不要', async () => {
    const { excluder } = await import('../public-export.mjs')
    const out = excluder(readFileSync(join(ROOT, 'release/public-exclude.txt'), 'utf8'))
    for (const f of ['design/refs/tolaria.png', 'design/v2-b/proto-b.html', 'design/src/imgs.json', 'design/v3/src/proto.js', 'CLAUDE.md', 'docs/HANDOFF.md', 'website/hub-entry/apps-hub.patch', 'apps/today/src/main/index.ts', 'apps/apple/project.yml'])
      expect(out(f), f).toBe(true)
    for (const f of ['design/v3/icon/icon-1-cards.png', 'design/v3/DESIGN.v3.md', 'README.md', 'docs/DEVELOPMENT.md', 'website/index.html', 'apps/notes/src/main/index.ts', 'packages/tasks/src/line.ts', 'designer.md'])
      expect(out(f), f).toBe(false)
  })

  test('扫得出密钥、私人邮箱、本机路径、AI 签名；example.com、noreply、锁文件里的依赖作者邮箱、测试里编的 /Users/me/ 不算', async () => {
    const { scan } = await import('../public-export.mjs')
    const dir = tmp()
    writeFileSync(join(dir, 'ok.md'), 'test@example.com\n1+x@users.noreply.github.com\n/Users/runner/work\n' + '/Use' + 'rs/me/笔记库/\n')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'author: i' + '@izs.me\n')
    expect(scan(dir)).toEqual([])
    // 拼起来写，这个测试文件自己就不会被导出检查当成泄露
    writeFileSync(join(dir, 'bad.ts'), `const k = 'sk-ant-${'a'.repeat(20)}'\nconst p = '${'/Use' + 'rs/someone/notes/'}'\n// ${'me' + '@gmail.com'}\n`)
    writeFileSync(join(dir, 'MSG'), 'Co-Authored-' + 'By: Claude Opus\n')
    const found = scan(dir).join('\n')
    for (const w of ['API 密钥', '本机用户目录', '邮箱', 'AI 工具签名']) expect(found).toContain(w)
  })
})
