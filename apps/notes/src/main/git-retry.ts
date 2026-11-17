/**
 * 撤回时撞上别处正在用 Git（占着 index.lock）：等一下再试，最多 6 次。视频这些在后台自己撤回的地方用。别的错照常抛出去。
 * 提交（commitPaths、commitAll）在 @cn/git 里自己就会等锁，不用这里。
 */
import * as git from '@cn/git'

export async function revertRetry(root: string, hash: string): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return await git.revert(root, hash)
    } catch (e) {
      if (!git.isLocked(e) || i >= 5) throw e
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
}
