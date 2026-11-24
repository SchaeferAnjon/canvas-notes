/**
 * 认图里的字：macOS 自带的 Vision（VNRecognizeTextRequest），走 osascript 的 JavaScript（JXA）调它，不用编译、不联网。JXA 里设属性要用 setXxx()（直接赋值不生效，中文就认不出）。
 * 读 PDF 时贴进来的截图拿它认字、去 PDF 文字层里找是哪一页（shared/locate.ts）。不是 Mac 的给空字符串
 */
import { execFile } from 'node:child_process'

const SCRIPT = `ObjC.import('Vision')
function run(argv) {
  const req = $.VNRecognizeTextRequest.alloc.init
  req.setRecognitionLevel(0)
  req.setUsesLanguageCorrection(false)
  req.setRecognitionLanguages($(['zh-Hans', 'en-US']))
  const h = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}))
  h.performRequestsError($([req]), null)
  const out = []
  const rs = req.results
  for (let i = 0; i < rs.count; i++) {
    const c = rs.objectAtIndex(i).topCandidates(1)
    if (c.count) out.push(c.objectAtIndex(0).string.js)
  }
  return out.join('\\n')
}`

export function ocrImage(path: string): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve('')
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, path], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`认图里的字没成：${(stderr || err.message).trim().slice(0, 300)}`))
      else resolve(stdout.trim())
    })
  })
}
