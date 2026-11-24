/**
 * 以前视频问框写进文档的那块问答（<!-- moment-ask … --> 问答块 + 一块 AI 讲解）。2026-11-24 起问框的问答记进那篇下面的 AI 笔记，
 * 不再往文档里插这一块；老文档里还有，块上的「接着问」照样能用。测「接着问」时先把这一块写进文档（截图那一帧一起放进库里）。
 */
import { solidPng } from './png'
import { FAKE_VIDEO_ID } from './fake-video'

export const OLD_ASK_FRAME = `附件/视频/youtube-${FAKE_VIDEO_ID}/00-06-问.jpg`

export function oldAskBlock(base: string): string {
  return [
    `<!-- moment-ask video=youtube:${FAKE_VIDEO_ID} t=6 -->`,
    `![00:06 框住的地方](${OLD_ASK_FRAME})`,
    `[▶ 00:06 · Linear transformations and matrices](${base}/watch?v=${FAKE_VIDEO_ID}&t=6s)`,
    '> **我的疑惑**：框里这两个箭头为什么能决定整个网格怎么动？',
    '',
    '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧、00:00–00:36 的字幕',
    '> 框里是 i 帽和 j 帽变换后的位置。任何向量都是它俩的组合，所以它俩落到哪，整个网格就跟着落到哪。',
  ].join('\n')
}

/** 那一帧（库里的图，内容无所谓） */
export const oldAskFrame = () => solidPng(64, 36, [20, 20, 20])
