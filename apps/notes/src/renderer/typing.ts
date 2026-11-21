/** 按键落在能打字的地方（输入框、多行框、可编辑的区域）：白板、导图自己的快捷键（⌫ 删、⌘Z 撤回、方向键挪）让给打字 */
export const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable="true"]'))
