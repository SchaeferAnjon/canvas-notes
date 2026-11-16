/** 拍导图的接口：preload 暴露成 window.cnMap（实现在 main/mindmap/） */
import type { PlaceRequest, Recognition, StagedPhoto } from './mindmap'

export interface CnMapApi {
  /** 摄像头授权：granted / denied / restricted / not-determined */
  cameraStatus(): Promise<string>
  /** 第一次用：系统问一次；返回给没给 */
  cameraAsk(): Promise<boolean>
  /** 打开系统设置的「隐私 › 摄像头」 */
  cameraSettings(): Promise<void>
  /** 拍的、拖进来的、粘贴的照片先暂存（HEIC 转成 JPEG），返回能显示的数据 */
  stage(bytes: Uint8Array, name: string): Promise<StagedPhoto>
  /** 「从照片选…」：系统的选文件框；取消是 null */
  pick(): Promise<StagedPhoto | null>
  /** 不要这张了（重拍、关掉窗口） */
  discard(id: string): Promise<void>
  /** AI 认照片；reqId 用来中途停 */
  recognize(reqId: number, photoId: string, course?: string): Promise<Recognition>
  stop(reqId: number): Promise<void>
  /** 做成白板导图：照片进 附件/导图/，收件箱里新建导图白板，一次提交；返回白板的路径 */
  place(req: PlaceRequest): Promise<string>
  /** 窗口开着时看「下载」文件夹里新来的照片（隔空投送） */
  watchAirdrop(on: boolean): Promise<void>
  onAirdrop(cb: (photo: StagedPhoto) => void): () => void
  onAirdropError(cb: (message: string) => void): () => void
  /** 菜单「文件 › 拍一张导图」 */
  onOpen(cb: () => void): () => void
}
