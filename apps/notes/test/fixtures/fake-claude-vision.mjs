// 假的 claude（claude -p --input-format stream-json）：测「让 AI 看照片」的接法，不联网。
// 从标准输入读一条用户消息，回一行 result：里面写着收到了什么（图的类型、大小、话的开头）
const argv = process.argv.slice(2)
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  if (process.env.FAKE_VISION_HANG) return setInterval(() => undefined, 1000)
  const i = argv.indexOf('--input-format')
  const msg = JSON.parse(input.trim().split('\n')[0])
  const [img, text] = msg.message.content
  out({ type: 'system', subtype: 'init', session_id: 'v' })
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'v',
    result: JSON.stringify({
      inputFormat: argv[i + 1],
      tools: argv[argv.indexOf('--tools') + 1],
      role: msg.message.role,
      image: img.type,
      mime: img.source.media_type,
      bytes: Buffer.from(img.source.data, 'base64').length,
      prompt: text.text.slice(0, 12),
    }),
  })
})
