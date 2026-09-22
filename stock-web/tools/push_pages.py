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
    target = os.path.join(CLONE, PREFIX)
    before = walk_files(target) if os.path.isdir(target) else set()
    if os.path.isdir(target):
        shutil.rmtree(target)
    shutil.copytree(LOCAL, target,
                    ignore=shutil.ignore_patterns(*SKIP_DIRS))
    after = walk_files(target)
    return len(after - before), len(before - after)


def fresh_clone() -> None:
    """每次全新克隆。

    ★ 为什么不用「复用克隆 + git reset --hard / clean」：
    实测这套状态管理不可靠 —— 上一次 `--dry-run`（或中途失败）留下的
    暂存区 / 工作区脏状态会挡住 `git pull --rebase`，而 `reset --hard` +
    `clean -fd <prefix>` 的组合甚至在一次运行中把克隆里的 `stock-web/`
    整个删掉了（本地目录未受影响，但足以说明这套做法不该用）。
    仓库只有 ~3MB，克隆约十几秒，直接重建最简单也最不容易出错。
    """
    if os.path.isdir(CLONE):
        shutil.rmtree(CLONE, ignore_errors=True)
    os.makedirs(os.path.dirname(CLONE), exist_ok=True)
    run(["git", "clone", "--quiet", REMOTE, CLONE], cwd=os.path.dirname(CLONE))
    # 本机无全局身份，全新克隆的仓库级配置也为空，必须显式设置才能 commit
    run(["git", "config", "user.name", GIT_NAME], cwd=CLONE, quiet=True)
    run(["git", "config", "user.email", GIT_EMAIL], cwd=CLONE, quiet=True)
    print(f"      已克隆到 {CLONE}")


def main() -> int:
    ap = argparse.ArgumentParser(description="同步 stock-web 到 GitHub Pages 并推送")
    ap.add_argument("--dry-run", action="store_true", help="只检查，不提交不推送")
    ap.add_argument("-m", "--message", default=None, help="提交信息")
    args = ap.parse_args()

    print(f"本地目录 {LOCAL}")
    print(f"目标前缀 {PREFIX}/ @ {CLONE}")

    print("[1/5] 全新克隆仓库（保证工作区干净、且已是最新 main）")
    fresh_clone()

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
