/** 旁支的名字搬进了 @cn/ai-chat（ParaRead 联动）；画布笔记这边认「讲讲这句」时中英两种都认 */
import { ASK_THIS, sideName as nameOf } from '@cn/ai-chat/side/name'
import { tIn } from '../../shared/i18n'

export { ASK_THIS, cutWords, sideAsks } from '@cn/ai-chat/side/name'

export const sideName = (s: Parameters<typeof nameOf>[0]): string => nameOf(s, [tIn('en', ASK_THIS)])
