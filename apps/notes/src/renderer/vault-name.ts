/**
 * 库的名字（CN-106）：放在库最外层的东西写库名（canvas-note-test），不写「最外层」这种说法。
 * App 打开库时设一次；位置条、「移到」菜单、「最近」页、提示都从这里拿。
 */
let name = ''

export const vaultName = () => name

export function setVaultName(n: string) {
  name = n
}

/** 一个文件夹给人看的写法：最外层是库名 */
export const folderLabel = (folder: string) => folder || name
