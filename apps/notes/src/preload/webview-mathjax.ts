/** 主世界里的 MathJax（预加载在隔离世界，读不到 window.MathJax）：单独一个文件，剪藏对照样例的测试不打包它 */
import { webFrame } from 'electron'

/**
 * MathJax 3 的公式在网页里只剩画出来的样子：到网页自己的世界里（MathJax 在那儿）把每个公式的原文写到容器的 data-cn-tex 上，
 * 隔离世界里的预加载、整页剪藏的克隆都读得到。没有 MathJax 3 的网页什么都不做
 */
export function tagMathJax(): Promise<unknown> {
  return webFrame
    .executeJavaScript(
      `(() => { try { const d = window.MathJax && MathJax.startup && MathJax.startup.document; if (!d || !d.math) return 0; let n = 0;
        for (const m of d.math) { const r = m.typesetRoot; if (r && r.setAttribute && !r.hasAttribute('data-cn-tex')) { r.setAttribute('data-cn-tex', m.math); r.setAttribute('data-cn-display', m.display ? '1' : '0'); n++ } }
        return n } catch (e) { return 0 } })()`,
    )
    .catch(() => 0)
}
