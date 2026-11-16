/**
 * 提交时撞上别处正在用 Git（界面刷新底栏的 git status 也会短暂占着 index.lock）：等一下再试，最多 6 次。
 * 视频、微信读书这些在后台自己提交的地方用。别的错照常抛出去。
 */
import * as git from '@cn/git'

const locked = (e: unknown) => /index\.lock|Unable to create .*\.lock|another git process/i.test(String((e as Error)?.message ?? e))

export async function commitPathsRetry(root: string, paths: string[], message: string): Promise<string | null> {
  for (let i = 0; ; i++) {
    try {
      return await git.commitPaths(root, paths, message)
    } catch (e) {
      if (!locked(e) || i >= 5) throw e
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
}

export async function revertRetry(root: string, hash: string): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return await git.revert(root, hash)
    } catch (e) {
      if (!locked(e) || i >= 5) throw e
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
}
