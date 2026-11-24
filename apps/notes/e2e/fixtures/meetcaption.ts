/**
 * MeetCaption 联动的样本库：一门课 课程/ECP（MeetCaption 连库时对上的项目 ecp、课堂、每周课表），两篇上课记录
 * （11-04 两段，录音、字幕、关键画面都在；10-21 一段，录音还是 Git LFS 的指针、没下到这台 Mac 上），一个会议项目。
 * 上课记录用 @cn/format 的 writeMcRecord 写（MeetCaption 下课写进库用同一份）。
 */
import { mcFrameName, mcRecordingDir, mcSubtitlePath, writeMcRecord, writeVtt, type McCue } from '@cn/format'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const FOLDER = '课程/ECP'
export const SUB = `${FOLDER}/上课的录音和转录`
export const REC_A = `${SUB}/2026-11-04 近似加法器与 CDM8 乘法器.md`
export const REC_B = `${SUB}/2026-10-21 AI、ML 方法与硬件导论.md`
export const S1 = '2026-11-04 09.29'
export const S2 = '2026-11-04 11.05'
export const S3 = '2026-10-21 14.15'
export const MEET = '项目/hiwi2例会'
export const REC_M = `${MEET}/会议记录/2026-11-12 hiwi2例会：工时与误差分析.md`
export const S4 = '2026-11-12 10.00'

const AUDIO = readFileSync(join(__dirname, 'mc-silence.webm'))
const FRAME = readFileSync(join(__dirname, 'mc-frame.jpg'))
/** 09:29 那一场开始后 40 秒、95 秒截的两张 */
export const F1 = 9 * 3600 + 29 * 60 + 40
export const F2 = 9 * 3600 + 29 * 60 + 95

export const TEXT_A = writeMcRecord({
  path: REC_A,
  title: '2026-11-04 近似加法器与 CDM8 乘法器',
  course: 'ecp',
  mode: 'class',
  sessions: [S1, S2],
  duration: '2:30',
  overview: { text: '本节课从 CMOS scaling 走到尽头、dark silicon 讲起，说明为什么需要近似计算；随后讲 full adder、静态近似加法器 LOA 与 AMA，后半段转向乘法器 CDM8。', engine: 'DeepSeek' },
  todos: [
    { text: '列出 full adder 所有输入组合的真值表', session: S1, t: 75, due: '2026-11-11' },
    { text: '分组练习：分析 LOA 结构，算门数和 worst case error', session: S2, t: 30 },
  ],
  parts: [
    {
      session: S1,
      sections: [
        { title: '近似计算的动机', t: 0, points: [{ text: 'Dark silicon：芯片上不能同时全开', t: 20 }], frames: [F1] },
        { title: 'Full adder 和 carry chain', t: 90, points: [{ text: 'carry chain 是关键瓶颈', t: 120 }], frames: [F2] },
      ],
    },
    { session: S2, sections: [{ title: 'CDM8 乘法器', t: 0, points: [{ text: 'horizontal cut 拆成两个 8×4', t: 60 }] }] },
  ],
})

export const TEXT_B = writeMcRecord({
  path: REC_B,
  title: '2026-10-21 AI、ML 方法与硬件导论',
  course: 'ecp',
  mode: 'class',
  sessions: [S3],
  duration: '1:22',
  parts: [{ session: S3, sections: [{ title: '为什么要专用硬件', t: 0 }, { title: '脉动阵列', t: 1800 }] }],
})

export const TEXT_M = writeMcRecord({
  path: REC_M,
  title: '2026-11-12 hiwi2例会：工时与误差分析',
  mode: 'meeting',
  sessions: [S4],
  duration: '0:45',
  todos: [{ text: '整理误差分析的图', session: S4, t: 300, due: '2026-11-19' }],
  parts: [{ session: S4, sections: [{ title: '工时', t: 0 }] }],
})

const cues = (n: number, step: number, lead: string): McCue[] =>
  Array.from({ length: n }, (_, i) => ({ start: i * step, end: (i + 1) * step, text: `${lead} sentence ${i + 1}.`, tr: `${lead} 第 ${i + 1} 句。`, ...(i === 0 ? { who: 'Prof' } : {}) }))

const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 9433188\n'

/** 下一节：明天 09:00（每周这一天） */
const tomorrow = (new Date().getDay() + 1) % 7

export const MC_FILES: Record<string, Uint8Array | string> = {
  [REC_A]: TEXT_A,
  [REC_B]: TEXT_B,
  [REC_M]: TEXT_M,
  [`${FOLDER}/第1讲 笔记.md`]: '# 第1讲 笔记\n\n随手记的。\n',
  [`${mcRecordingDir(REC_A)}/录音-1.webm`]: AUDIO,
  [`${mcRecordingDir(REC_A)}/录音-2.webm`]: AUDIO,
  [`${mcRecordingDir(REC_A)}/${mcFrameName(F1)}`]: FRAME,
  [`${mcRecordingDir(REC_A)}/${mcFrameName(F2)}`]: FRAME,
  [`${mcRecordingDir(REC_B)}/录音-1.webm`]: pointer,
  [mcSubtitlePath(S1)]: writeVtt(cues(36, 5, 'Approximate computing')),
  [mcSubtitlePath(S2)]: writeVtt(cues(10, 6, 'Multiplier')),
  [mcSubtitlePath(S3)]: writeVtt(cues(4, 10, 'Hardware')),
  '.canvas-notes/meetcaption.json':
    JSON.stringify(
      {
        projects: [
          { id: 'ecp', name: 'Emerging Computing Paradigms', folder: FOLDER, mode: 'class', schedule: [{ weekday: tomorrow, time: '09:00' }] },
          { id: 'hiwi2', folder: MEET, mode: 'meeting' },
        ],
      },
      null,
      2,
    ) + '\n',
}
