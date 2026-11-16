import { Codicon } from "@cn/design";
import { Fragment, useMemo, useState } from "react";
import type { NoteFile } from "../shared/api";
import { type FolderEntry, KIND_LABEL } from "../shared/folder-home";
import { titleOf } from "../shared/layout";
import {
  type ArchiveDays,
  INBOX_WARN,
  MAX_FOLDERS,
  sidebarOf,
} from "../shared/sidebar";
import { noteMenu, RenameInput } from "./note-menu";
import { GhostRows, MovedMark, type DreamPreview } from "./dream/preview";
import { FolderMark } from "./folder-home/icons";
import { FileTree } from "./files/FileTree";
import { HeadBtn, ViewHead } from "./shell/Shell";
import "./sidebar.css";
import type { Tab } from "./tabs";

/**
 * 左栏只放「活着的」：置顶的、最近的白板、这周动过的文档、最近剪过的素材主题；
 * 其余在底部「全部笔记」「归档」里。库再大，左栏也只有二三十行。
 */
export type SideView = "files" | "recent" | "folders" | "inbox" | "dream";
export const VIEW_NAME: Record<SideView, string> = {
  files: "文件",
  recent: "最近",
  folders: "课程和文件夹首页",
  inbox: "收件箱",
  dream: "梦游报告",
};

export function Sidebar(props: {
  /** 左边图标栏选中的那一页（梦游报告由 App 直接放 DreamPanel） */
  view: Exclude<SideView, "dream">;
  notes: NoteFile[];
  pins: string[];
  archiveDays: ArchiveDays;
  active: Tab | null;
  onOpenNote(path: string): void;
  onOpenInbox(): void;
  onOpenTopic(topic: string): void;
  onOpenAll(): void;
  onOpenArchive(): void;
  onNewNote(): void;
  onNewBoard(): void;
  /** 「全部文件」目录树里点了文件（md、PDF、HTML）、点了 ⌘O 按钮 */
  onOpenFile(path: string): void;
  onQuickOpen(): void;
  /** 收件箱堆多了：让 AI 分一分 */
  onTidy(): void;
  /** 右键菜单里点了「重命名」后，在左栏原地改名 */
  onRename(path: string, name: string): void;
  onTrash(path: string): void;
  /** 右键置顶 / 取消置顶之后 */
  onPinsChanged(): void;
  /** 梦游预览开着：notes 已经是改好以后的样子，挪来的行标「新」，收件箱里留影子 */
  preview?: DreamPreview | null;
  /** 有首页的文件夹（课程/<课>、项目/<项目>、生活、写作）；fresh：只在梦游预览里才有的 */
  folders: (FolderEntry & { fresh?: boolean })[];
  onOpenFolder(folder: string): void;
  onNewCourse(): void;
}) {
  const [allFolders, setAllFolders] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { notes, active } = props;
  const m = useMemo(
    () =>
      sidebarOf(
        notes,
        props.pins,
        Date.now(),
        props.archiveDays,
        props.folders.length,
      ),
    [notes, props.pins, props.archiveDays, props.folders.length],
  );
  const menu = (e: React.MouseEvent, path: string) =>
    void noteMenu(e, path, {
      rename: setRenaming,
      trash: props.onTrash,
      pinned: props.onPinsChanged,
    });
  const isOn = (path: string) =>
    active?.type === "note" && active.path === path;

  const row = (n: NoteFile) => (
    <button
      key={n.path}
      className={"si" + (isOn(n.path) ? " on" : "")}
      onClick={() => props.onOpenNote(n.path)}
      onContextMenu={(e) => menu(e, n.path)}
      title={n.path}
    >
      {n.board ? (
        <i className="sw" style={{ background: n.board.color }} />
      ) : (
        <Codicon
          name={
            n.kind === "inbox"
              ? "inbox"
              : n.kind === "clip"
                ? "quote"
                : "file-text"
          }
        />
      )}
      {renaming === n.path ? (
        <RenameInput
          path={n.path}
          onDone={() => setRenaming(null)}
          onRename={props.onRename}
        />
      ) : (
        <span className="truncate">{titleOf(n.path)}</span>
      )}
      {props.preview?.preview.marks.get(n.path) && (
        <MovedMark
          m={props.preview.preview.marks.get(n.path)!}
          pv={props.preview}
        />
      )}
      {n.board ? (
        <span className="c num">{n.board.cards}</span>
      ) : (
        n.draft && <span className="tag-draft">草稿</span>
      )}
    </button>
  );
  const warn = m.inbox > INBOX_WARN;

  // 收件箱页只列最新的 60 条（别把上万条全铺开），更多在中间打开
  const inbox = useMemo(
    () =>
      notes
        .filter((n) => n.kind === "inbox")
        .sort((a, b) => b.mtimeMs - a.mtimeMs),
    [notes],
  );

  return (
    <aside
      className={
        "side" +
        (props.preview ? " previewing" : "") +
        (props.view === "files" ? " tree-mode" : "")
      }
      aria-label={VIEW_NAME[props.view]}
    >
      {props.view === "files" && (
        <>
          <ViewHead
            title="文件"
            sub={<span className="num">{notes.length} 篇 · 本地 Git</span>}
          >
            <HeadBtn
              icon="new-file"
              label="新建笔记"
              keys="⌘N"
              onClick={props.onNewNote}
            />
            <HeadBtn
              icon="go-to-file"
              label="按名字跳"
              keys="⌘O"
              onClick={props.onQuickOpen}
            />
          </ViewHead>
          <nav className="nav" aria-label="笔记">
            <FileTree
              activePath={
                active?.type === "folder"
                  ? active.folder
                  : active && "path" in active
                    ? active.path
                    : null
              }
              onOpen={props.onOpenFile}
              onOpenFolder={props.onOpenFolder}
              preview={props.preview ?? null}
            />
          </nav>
        </>
      )}
      {props.view === "folders" && (
        <>
          <ViewHead title="课程和文件夹首页">
            <HeadBtn
              icon="new-folder"
              label="新建一门课"
              onClick={props.onNewCourse}
            />
          </ViewHead>
          <nav className="nav" aria-label="笔记">
            <div className="s-group" role="group" aria-label="文件夹">
              {(allFolders
                ? props.folders
                : props.folders.slice(0, MAX_FOLDERS)
              ).map((f, i, list) => {
                const name = f.folder.split("/").pop()!;
                // 按课程、项目、其他分组，组头和原型一样（spec 第 0 节「课程和文件夹首页」）
                const group = (k: FolderEntry["kind"]) => (k === "course" ? "课程" : k === "project" ? "项目" : "其他");
                const head = i === 0 || group(list[i - 1]!.kind) !== group(f.kind) ? group(f.kind) : null;
                return (
                  <Fragment key={f.folder}>
                  {head && <div className="sh">{head}</div>}
                  <button
                    className={
                      "si" +
                      (active?.type === "folder" && active.folder === f.folder
                        ? " on"
                        : "")
                    }
                    onClick={() => props.onOpenFolder(f.folder)}
                    title={`${f.folder} · 点开首页`}
                  >
                    <FolderMark f={f} />
                    <span className="truncate">{name}</span>
                    {f.fresh && <span className="tag-new">新</span>}
                    {group(f.kind) === "其他" && name !== KIND_LABEL[f.kind] && (
                      <span className="c">{KIND_LABEL[f.kind]}</span>
                    )}
                  </button>
                  </Fragment>
                );
              })}
              {props.folders.length === 0 && (
                <p className="s-none">还没有课程。点右上角新建一门</p>
              )}
              {props.folders.length > MAX_FOLDERS && (
                <button
                  className="si s-more"
                  onClick={() => setAllFolders((v) => !v)}
                >
                  {allFolders ? (
                    "收起"
                  ) : (
                    <>
                      还有{" "}
                      <span className="num">
                        {props.folders.length - MAX_FOLDERS}
                      </span>{" "}
                      个文件夹
                    </>
                  )}
                </button>
              )}
            </div>
          </nav>
        </>
      )}
      {props.view === "inbox" && (
        <>
          <ViewHead
            title="收件箱"
            sub={<span className="num">{m.inbox} 条</span>}
          >
            <HeadBtn
              icon="sparkle"
              label={
                warn
                  ? `收件箱堆了 ${m.inbox} 条，让 AI 按主题分进素材`
                  : "让 AI 分一分"
              }
              className={warn ? "s-tidy" : undefined}
              onClick={props.onTidy}
            >
              {warn && <span>让 AI 分一分</span>}
            </HeadBtn>
            <HeadBtn
              icon="link-external"
              label="在中间打开整个收件箱"
              onClick={props.onOpenInbox}
            />
          </ViewHead>
          <nav className="nav" aria-label="笔记">
            {inbox.slice(0, 60).map(row)}
            {inbox.length === 0 && <p className="s-none">收件箱是空的</p>}
            {inbox.length > 60 && (
              <button className="si s-more" onClick={props.onOpenInbox}>
                还有 <span className="num">{inbox.length - 60}</span>{" "}
                条，在中间打开
              </button>
            )}
          </nav>
        </>
      )}
      {props.view === "recent" && (
        <>
          <ViewHead title="最近">
            <HeadBtn
              icon="new-file"
              label="新建笔记"
              keys="⌘N"
              onClick={props.onNewNote}
            />
            {/* 没有白板时「白板」组藏起来，新建白板还在页头 */}
            <HeadBtn icon="layout" label="新建白板" onClick={props.onNewBoard} />
          </ViewHead>
          <nav className="nav" aria-label="笔记">
            {m.pinned.length > 0 && (
              <div className="s-group" role="group" aria-label="置顶">
                <div className="sh">置顶</div>
                {m.pinned.map(row)}
              </div>
            )}

            {m.boards.length > 0 && (
              <div className="s-group" role="group" aria-label="最近的白板">
                <div className="sh">
                  白板
                  <button
                    className="add"
                    aria-label="新建白板"
                    title="新建白板"
                    onClick={props.onNewBoard}
                  >
                    <Codicon name="add" size={14} />
                  </button>
                </div>
                {m.boards.map(row)}
              </div>
            )}

            <div className="s-group" role="group" aria-label="这周动过的">
              <div className="sh">
                我写的
                <span className="sub">这周动过的</span>
                <button
                  className="add"
                  aria-label="新建笔记"
                  title="新建笔记 ⌘N"
                  onClick={props.onNewNote}
                >
                  <Codicon name="add" size={14} />
                </button>
              </div>
              {m.works.map(row)}
              {m.works.length === 0 && (
                <p className="s-none">这周还没动过，旧的都在「全部笔记」</p>
              )}
              {m.moreWorks > 0 && (
                <button className="si s-more" onClick={props.onOpenAll}>
                  还有 <span className="num">{m.moreWorks}</span> 篇这周动过
                </button>
              )}
            </div>

            {props.preview && <GhostRows pv={props.preview} />}

            {m.topics.length > 0 && <div className="sh">素材 · 按主题</div>}
            {m.topics.map(({ topic, count }) => (
              <button
                key={topic}
                className={
                  "si" +
                  (active?.type === "topic" && active.topic === topic
                    ? " on"
                    : "")
                }
                onClick={() => props.onOpenTopic(topic)}
              >
                <Codicon name="folder" />
                <span className="truncate">{topic}</span>
                <span className="c num">{count}</span>
              </button>
            ))}
          </nav>
          <div className="sall">
            <button
              className={"si" + (active?.type === "all" ? " on" : "")}
              onClick={props.onOpenAll}
            >
              <Codicon name="files" />
              全部笔记
              <span className="c num" data-testid="all-count">
                {m.all} 篇
              </span>
            </button>
            <button
              className={"si" + (active?.type === "archive" ? " on" : "")}
              onClick={props.onOpenArchive}
              title={
                props.archiveDays
                  ? `${props.archiveDays} 天没改过的，左栏不显示`
                  : "没开自动归档"
              }
            >
              <Codicon name="archive" />
              归档
              <span className="c num" data-testid="archive-count">
                {m.archived} 篇
              </span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
