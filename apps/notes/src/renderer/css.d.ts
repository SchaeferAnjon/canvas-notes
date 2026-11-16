declare module '*.css'
declare module '*.jpg' {
  const url: string
  export default url
}
declare module '*.png' {
  const url: string
  export default url
}
/** vite 的「?url」：文件打包后的网址（pdf.js 的 worker） */
declare module '*?url' {
  const url: string
  export default url
}
