/** 假引擎（CN_AI_FAKE=1）认照片时的固定回答：线性代数第 3 讲的导图，有一个节点拿不准 */
export const FAKE_ANSWER = JSON.stringify({
  mindmap: true,
  legible: true,
  course: '线性代数',
  lecture: 3,
  root: {
    text: '线性映射',
    box: [0.402, 0.436, 0.197, 0.095],
    children: [
      { text: '定义', box: [0.233, 0.211, 0.091, 0.082], children: [{ text: 'T(u+v)=T(u)+T(v)', box: [0.075, 0.074, 0.232, 0.066], children: [] }, { text: 'T(cv)=cT(v)', box: [0.054, 0.338, 0.166, 0.066], children: [] }] },
      { text: '矩阵表示', box: [0.655, 0.189, 0.159, 0.082], children: [{ text: '列 = 基向量的像', box: [0.712, 0.061, 0.202, 0.066], children: [] }, { text: '复合 = 矩阵相乘', box: [0.755, 0.32, 0.202, 0.066], children: [] }] },
      {
        text: '核与像',
        box: [0.669, 0.675, 0.125, 0.082],
        children: [
          { text: 'ker T 映到 0', box: [0.812, 0.567, 0.164, 0.064], children: [] },
          { text: 'im T 所有的像', box: [0.813, 0.781, 0.171, 0.064], children: [] },
          { text: '秩-零化渡定理', box: [0.579, 0.872, 0.186, 0.068], unsure: true, guesses: ['秩-零化度定理', '秩-零化渡定理'], children: [] },
        ],
      },
      { text: '例子', box: [0.233, 0.675, 0.091, 0.082], children: [{ text: '旋转', box: [0.073, 0.591, 0.072, 0.068], children: [] }, { text: '投影', box: [0.061, 0.754, 0.072, 0.068], children: [] }, { text: '求导 d/dx', box: [0.207, 0.882, 0.142, 0.068], children: [] }] },
    ],
  },
})

export const FAKE_NOT_MAP = JSON.stringify({ mindmap: false })
