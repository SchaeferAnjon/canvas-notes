/**
 * 写进文件的说法跟库语言（task-zojmg，设计稿第 4 节）：库语言变了（打开别的库）就换 packages/format 里写文件用的那套。
 * 主进程（main/lang.ts）和界面（renderer/i18n.ts）各 import 一次；两边各有一份 @cn/format。
 * 这一批管 AI 讲解 / AI 总结提示块的头一行；读 PDF 笔记的页标题、属性键这些跟着读 PDF 那一批改。
 */
import { EN_CALLOUT_WORDS, setCalloutWords, ZH_CALLOUT_WORDS } from '@cn/format'
import { onVaultLang, vaultLang } from './index'

const apply = () => setCalloutWords(vaultLang() === 'en' ? EN_CALLOUT_WORDS : ZH_CALLOUT_WORDS)
apply()
onVaultLang(apply)
