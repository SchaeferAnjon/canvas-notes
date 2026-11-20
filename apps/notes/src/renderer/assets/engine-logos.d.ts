declare module '*.svg?raw' {
  const svg: string
  export default svg
}
/** 主进程里要图本身（data: 网址，放进网页） */
declare module '*.png?inline' {
  const url: string
  export default url
}
