import type { CnTodoApi } from '../../shared/todo'

declare global {
  interface Window {
    cnTodo: CnTodoApi
  }
}
