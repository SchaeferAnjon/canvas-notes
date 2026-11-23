declare module '*.css'
declare module '*.jpg' {
  const url: string
  export default url
}
declare module '*.png' {
  const url: string
  export default url
}
/** vite 的「?url&no-inline」：小文件也单独打成一个文件给网址，不内联成 data:（语音输入的 AudioWorklet 脚本：主窗口的 CSP 只认 'self'） */
declare module '*?url&no-inline' {
  const url: string
  export default url
}
/** vite 的「?url」：文件打包后的网址（pdf.js 的 worker） */
declare module '*?url' {
  const url: string
  export default url
}
