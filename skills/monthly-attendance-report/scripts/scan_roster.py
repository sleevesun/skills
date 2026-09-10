#!/usr/bin/env python3
"""
疑似花名册自动搜寻与用户确认辅助脚本 (scan_roster.py)
用于在项目目录中智能检索可能作为花名册的 Excel 文件，并输出结构化候选清单与用户确认提示。
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import xlrd
except ImportError:
    xlrd = None

try:
    import openpyxl
except ImportError:
    openpyxl = None


def inspect_excel_roster(file_path: Path) -> Dict[str, Any]:
    """快速探测 Excel 是否包含员工花名册特征"""
    info = {
        "valid": False,
        "sheet_name": "",
        "row_count": 0,
        "has_id_col": False,
        "has_office_col": False,
        "error": None,
    }

    suffix = file_path.suffix.lower()
    if suffix == ".xls" and xlrd is not None:
        try:
            b = xlrd.open_workbook(str(file_path), on_demand=True)
            target_sheet = None
            for s in ["数据", "员工花名册", "Sheet1"]:
                if s in b.sheet_names():
                    target_sheet = s
                    break
            if not target_sheet:
                target_sheet = b.sheet_names()[0]

            sh = b.sheet_by_name(target_sheet)
            info["sheet_name"] = target_sheet
            info["row_count"] = max(0, sh.nrows - 8 if target_sheet == "数据" else sh.nrows - 1)
            # 探测第 1~10 行是否有 "员工ID" 或 "工号"
            for r in range(min(12, sh.nrows)):
                row_vals = [str(x).strip() for x in sh.row_values(r)]
                if any("员工ID" in v or "工号" in v or "员工编号" in v for v in row_vals):
                    info["has_id_col"] = True
                if any("办公地点" in v or "常驻地" in v or "工作地点" in v for v in row_vals):
                    info["has_office_col"] = True
            info["valid"] = info["has_id_col"]
        except Exception as e:
            info["error"] = str(e)

    elif suffix in [".xlsx", ".xlsm"] and openpyxl is not None:
        try:
            wb = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
            target_sheet = None
            for s in ["数据", "员工花名册", "Sheet1"]:
                if s in wb.sheetnames:
                    target_sheet = s
                    break
            if not target_sheet:
                target_sheet = wb.sheetnames[0]

            ws = wb[target_sheet]
            info["sheet_name"] = target_sheet
            info["row_count"] = max(0, (ws.max_row or 0) - 1)
            # 探测表头
            for r in range(1, min(12, (ws.max_row or 0) + 1)):
                row_vals = [str(ws.cell(r, c).value or "").strip() for c in range(1, min(40, (ws.max_column or 0) + 1))]
                if any("员工ID" in v or "工号" in v or "员工编号" in v for v in row_vals):
                    info["has_id_col"] = True
                if any("办公地点" in v or "常驻地" in v or "工作地点" in v for v in row_vals):
                    info["has_office_col"] = True
            info["valid"] = info["has_id_col"]
            wb.close()
        except Exception as e:
            info["error"] = str(e)

    return info


def scan_candidate_rosters(target_dir: Path) -> List[Dict[str, Any]]:
    """递归检索目标目录下的所有疑似花名册文件并综合评分排序"""
    patterns = ["*花名册*", "*roster*", "*员工*", "*OD_*", "*中台*"]
    seen_paths = set()
    candidates = []

    search_dirs = [target_dir]
    # 如果目标目录不是根目录，也可检查其父级目录
    if target_dir.parent.exists() and target_dir.parent != target_dir:
        search_dirs.append(target_dir.parent)

    for s_dir in search_dirs:
        for pat in patterns:
            for p in s_dir.glob(pat):
                if p.is_file() and p.suffix.lower() in [".xls", ".xlsx"]:
                    # 忽略 Office 临时锁文件与隐藏文件
                    if p.name.startswith(("~", ".~", ".")):
                        continue
                    p_res = p.resolve()
                    if p_res in seen_paths:
                        continue
                    seen_paths.add(p_res)

                    st = p.stat()
                    mtime_dt = datetime.fromtimestamp(st.st_mtime)
                    mtime_str = mtime_dt.strftime("%Y-%m-%d %H:%M:%S")

                    # 从文件名中提取日期特征 (如 2026-09-03 或 20260903)
                    date_match = re.search(r"20\d{2}[-_]?\d{2}[-_]?\d{2}", p.name)
                    fn_date = ""
                    if date_match:
                        raw_d = date_match.group(0).replace("_", "-")
                        if len(raw_d) == 8 and raw_d.isdigit():
                            fn_date = f"{raw_d[:4]}-{raw_d[4:6]}-{raw_d[6:]}"
                        else:
                            fn_date = raw_d

                    excel_info = inspect_excel_roster(p)

                    # 综合权重评分：文件名日期 > 修改时间 > 行数
                    score = 0
                    if fn_date:
                        score += 1000
                    if excel_info.get("has_id_col"):
                        score += 500
                    if excel_info.get("has_office_col"):
                        score += 200
                    if "中台" in p.name:
                        score += 100

                    candidates.append({
                        "path": str(p),
                        "abs_path": str(p_res),
                        "name": p.name,
                        "size_kb": round(st.st_size / 1024, 1),
                        "mtime": mtime_str,
                        "fn_date": fn_date,
                        "sheet": excel_info.get("sheet_name", ""),
                        "records": excel_info.get("row_count", 0),
                        "has_id": excel_info.get("has_id_col", False),
                        "has_office": excel_info.get("has_office_col", False),
                        "score": score,
                    })

    # 排序：评分高优先，文件名日期最新优先，修改时间最新优先
    candidates.sort(key=lambda x: (x["score"], x["fn_date"], x["mtime"]), reverse=True)
    return candidates


def generate_prompt_text(candidates: List[Dict[str, Any]]) -> str:
    """生成给用户的标准友好确认提示"""
    if not candidates:
        return "⚠️ 未在项目文件夹中自动检索到疑似花名册文件，请用户手动提供花名册文件路径。"

    lines = []
    lines.append("🔍 **花名册前置确认**")
    lines.append("在项目文件夹中检索到以下疑似员工花名册文件：\n")
    for idx, c in enumerate(candidates[:3], 1):
        tag = "【推荐首选】" if idx == 1 else f"【备选 {idx}】"
        date_hint = f"，版本日期：{c['fn_date']}" if c['fn_date'] else ""
        lines.append(f"{idx}. {tag} **`{c['name']}`**")
        lines.append(f"   - 文件大小：{c['size_kb']} KB | 修改时间：{c['mtime']}{date_hint}")
        lines.append(f"   - 包含工作表：`{c['sheet']}` | 预估在册人数：{c['records']} 人")
        lines.append("")

    lines.append(f"👉 **系统默认推荐使用**：`{candidates[0]['name']}`")
    lines.append("请确认是否以此花名册为基准？（如需使用其他指定文件，请直接回复文件路径）")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="智能检索疑似员工花名册文件")
    parser.add_argument("--dir", default=".", help="搜索目录路径，默认当前目录")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出")
    args = parser.parse_args()

    search_path = Path(args.dir).resolve()
    cands = scan_candidate_rosters(search_path)

    if args.json:
        print(json.dumps({"candidates": cands, "count": len(cands)}, ensure_ascii=False, indent=2))
    else:
        print(generate_prompt_text(cands))


if __name__ == "__main__":
    main()
