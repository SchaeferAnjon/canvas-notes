import type { CnCalApi } from '../../shared/calendar'
import type { CnTodoApi } from '../../shared/todo'
import type { CnWhenApi } from '../../shared/when-ai'
import type { CnFamilyApi } from '../../shared/family'
import type { CnFeedsApi } from '../../shared/feeds-widget'

declare global {
  interface Window {
    cnTodo: CnTodoApi
    cnWhen: CnWhenApi
    cnCal: CnCalApi
    /** 设置 › 软件家族（main/family.ts） */
    cnFamily: CnFamilyApi
    /** 文件夹首页的「画布订阅」组件（main/feeds-widget.ts） */
    cnFeeds: CnFeedsApi
  }
}
