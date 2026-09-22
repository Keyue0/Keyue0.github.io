#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 stock-web 同步到 GitHub Pages 仓库并推送。

为什么需要它
------------
每日流程（`0914WB/tools/daily.py`）会更新本目录下的
`data/industry_crowding.json` 等数据，但仓库里的 GitHub Actions
（`bing-auto-daily.yml`）**只提交 `auto/data/`，不碰 `stock-web/`**。
所以线上 <https://keyue0.github.io/stock-web/> 的数据会一直停在
上一次手动推送的状态 —— 这种「本地在更新、线上不动」的静默变旧很难发现。

★ 仓库结构（别推错位置）
------------------------
本目录**不是**仓库根，而是仓库的 `stock-web/` 子目录：

    Keyue0.github.io/          ← 仓库根 = Pages 根
    ├── auto/                  ← 另一个项目，由 Actions 每日自动提交
    └── stock-web/             ← 本应用（= 本目录内容）

所以绝不能在本目录 `git init` 后推仓库根 —— 那会覆盖 `auto/`。
本脚本只操作克隆里 `stock-web/` 这一个前缀。

用法
----
    python tools/push_pages.py --dry-run        # 只看会改什么
    python tools/push_pages.py                  # 同步 + 提交 + 推送
    python tools/push_pages.py -m "自定义信息"
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.dirname(HERE)                    # stock-web/
PROJECT = os.path.dirname(os.path.dirname(LOCAL))  # E:\Peasonal\Game

REMOTE = "git@github.com:Keyue0/Keyue0.github.io.git"
CLONE = os.path.join(PROJECT, ".workbuddy-ai", "pages-repo")
PREFIX = "stock-web"
SITE = "https://keyue0.github.io/stock-web/"

# 提交身份。必须显式设置：本机没有全局 user.name/user.email，
# 而全新克隆的仓库级配置也是空的，否则 git commit 会直接失败
# （fatal: unable to auto-detect email address）。
GIT_NAME = "Keyue0"
GIT_EMAIL = "Keyue0@users.noreply.github.com"

# 不参与同步的本地目录（构建/缓存产物）
SKIP_DIRS = {".git", "__pycache__", "node_modules"}


def run(cmd: list[str], cwd: str, check: bool = True, quiet: bool = False):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if not quiet and r.stdout.strip():
        print(r.stdout.strip())
    if check and r.returncode != 0:
        print(f"[失败] {' '.join(cmd)}\n{r.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return r


def walk_files(root: str) -> set[str]:
    """返回相对路径集合，跳过 SKIP_DIRS。"""
    out = set()
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            out.add(os.path.relpath(os.path.join(dirpath, f), root).replace("\\", "/"))
    return out


def check_remote_only() -> list[str]:
    """★ 安全检查：目标前缀里若有「远程独有文件」，镜像会误删，必须中止。"""
    target = os.path.join(CLONE, PREFIX)
    if not os.path.isdir(target):
        return []
    remote_only = sorted(walk_files(target) - walk_files(LOCAL))
    return remote_only


def sync() -> tuple[int, int]:
    """把 LOCAL 镜像到 克隆/<PREFIX>，**不做整目录删除**。

    ★ 为什么不 rmtree + copytree：见 prepare_clone() 的说明。
    这里只删「目标有、本地没有」的少数文件（正常情况 0~个位数），
    不会一次删几百个文件。
    """
    target = os.path.join(CLONE, PREFIX)
    src = walk_files(LOCAL)
    dst = walk_files(target)
    os.makedirs(target, exist_ok=True)

    removed = 0
    for rel in sorted(dst - src):
        p = os.path.join(target, rel)
        try:
            os.remove(p)
            removed += 1
        except OSError:
            pass
    # 清掉因此变空的目录
    for dirpath, dirnames, filenames in os.walk(target, topdown=False):
        if dirpath == target:
            continue
        if not os.listdir(dirpath):
            try:
                os.rmdir(dirpath)
            except OSError:
                pass

    added = 0
    for rel in sorted(src):
        s = os.path.join(LOCAL, rel)
        d = os.path.join(target, rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        if rel not in dst:
            added += 1
    return added, removed


def prepare_clone() -> None:
    """准备一个干净的、已同步到 origin/main 的克隆。

    ★ 为什么不每次 rmtree 重建（曾经就是这么写的）
    ------------------------------------------------
    `shutil.rmtree(CLONE)` 一次会删掉 800+ 个文件。这在**沙箱环境**里会被
    批量删除保护直接拦下，而且拦的方式很隐蔽 —— 子进程返回非 0，
    日志里只有一行 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，
    看起来像「推送脚本自己失败了」。同理，任何对文件删除量有阈值的
    环境（CI、企业 EDR）都会踩到。仓库本身只有 ~3MB，但「一次删 800 个
    文件」这个动作本身就是不该有的。

    现在改成：
      首次 → 全量克隆；
      之后 → fetch + reset --hard FETCH_HEAD（只改内容不同的文件，通常 0 个）
             + 只对 stock-web/ 前缀做 git clean（不动 auto/）。
    这两步都是确定性的：reset --hard 无条件把工作区对齐到抓下来的提交，
    不存在「上次留下的脏暂存区挡住 pull --rebase」那类问题。
    """
    if os.path.isdir(os.path.join(CLONE, ".git")):
        run(["git", "fetch", "--quiet", "origin", "main"], cwd=CLONE)
        run(["git", "reset", "--hard", "--quiet", "FETCH_HEAD"], cwd=CLONE)
        run(["git", "clean", "-fdq", "--", PREFIX], cwd=CLONE)
        print(f"      已复用并重置克隆 {CLONE}")
    else:
        if os.path.isdir(CLONE):
            # 目录在但不是有效仓库（上次中途失败留下的残骸）
            try:
                shutil.rmtree(CLONE)
            except OSError as e:
                raise SystemExit(
                    f"克隆目录 {CLONE} 已存在但不是有效 git 仓库，且无法删除（{e}）。"
                    "请手动清理后重跑。"
                )
        os.makedirs(os.path.dirname(CLONE), exist_ok=True)
        run(["git", "clone", "--quiet", REMOTE, CLONE], cwd=os.path.dirname(CLONE))
        print(f"      已克隆到 {CLONE}")
    # 本机无全局身份，克隆/复用的仓库级配置可能为空，必须显式设置才能 commit
    run(["git", "config", "user.name", GIT_NAME], cwd=CLONE, quiet=True)
    run(["git", "config", "user.email", GIT_EMAIL], cwd=CLONE, quiet=True)



def main() -> int:
    ap = argparse.ArgumentParser(description="同步 stock-web 到 GitHub Pages 并推送")
    ap.add_argument("--dry-run", action="store_true", help="只检查，不提交不推送")
    ap.add_argument("-m", "--message", default=None, help="提交信息")
    args = ap.parse_args()

    print(f"本地目录 {LOCAL}")
    print(f"目标前缀 {PREFIX}/ @ {CLONE}")

    print("[1/5] 准备克隆（首次全量克隆，之后增量重置）")
    prepare_clone()

    print("[2/5] 安全检查：远程前缀是否有「独有文件」")
    remote_only = check_remote_only()
    if remote_only:
        print(f"      发现 {len(remote_only)} 个远程独有文件，镜像会删掉它们，已中止：")
        for p in remote_only[:20]:
            print(f"        {PREFIX}/{p}")
        print("      请先人工确认这些文件是否该删，再决定是否继续。", file=sys.stderr)
        return 2
    print("      无远程独有文件，可安全镜像")

    added, removed = sync()
    print(f"[3/5] 已同步（新增 {added} / 删除 {removed}）")

    run(["git", "add", PREFIX], cwd=CLONE)
    staged = run(["git", "diff", "--cached", "--name-only"], cwd=CLONE, quiet=True)
    files = [l for l in staged.stdout.splitlines() if l.strip()]
    if not files:
        print("[4/5] 无变更，无需提交")
        return 0

    bad = [f for f in files if not f.startswith(PREFIX + "/")]
    if bad:
        print(f"      暂存区出现非 {PREFIX}/ 的文件，已中止：{bad[:5]}", file=sys.stderr)
        return 2

    print(f"[4/5] 暂存 {len(files)} 个文件（全部在 {PREFIX}/ 下）")
    if args.dry_run:
        for f in files[:30]:
            print(f"        {f}")
        if len(files) > 30:
            print(f"        … 另有 {len(files) - 30} 个")
        print("[dry-run] 到此为止，未提交未推送")
        return 0

    msg = args.message or f"stock-web: 数据更新 {time.strftime('%Y-%m-%d %H:%M')}"
    run(["git", "commit", "-q", "-m", msg], cwd=CLONE)
    print("[5/5] 推送")
    run(["git", "push", "origin", "main"], cwd=CLONE)
    head = run(["git", "rev-parse", "--short", "HEAD"], cwd=CLONE, quiet=True).stdout.strip()
    print(f"\n完成，提交 {head}")
    print(f"线上地址 {SITE}（GitHub Pages 约 20 秒后生效）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
