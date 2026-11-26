/**
 * AI 空对话（task-0tgz2，小样 design/ai-empty 方向 A「贴着输入框」）：消息区底下一句问候，输入框上面一排快捷命令。
 * AI 对话（AiPanel）和读 PDF（ReadingAi）共用；组件和样子 2026-11-25 搬进了 @cn/ai-chat/greeting（家族对话框样式统一，ParaRead、MeetCaption 也用）。
 */
export { Greeting, type Quick, QuickRow } from '@cn/ai-chat/greeting'
