import type { CnCalApi } from '../../shared/calendar'
import type { CnTodoApi } from '../../shared/todo'
import type { CnWhenApi } from '../../shared/when-ai'
import type { CnFamilyApi } from '../../shared/family'

declare global {
  interface Window {
    cnTodo: CnTodoApi
    cnWhen: CnWhenApi
    cnCal: CnCalApi
    /** 设置 › 软件家族（main/family.ts） */
    cnFamily: CnFamilyApi
  }
}
