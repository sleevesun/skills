#!/usr/bin/env python3
"""
企业考勤月报全流程自动化交付引擎 (pipeline.py)
标准流程：
  1. 接收已确认的花名册、打卡底表与规则文件；
  2. 动态自适应年月工作日日历与周末/假期列排布；
  3. 执行出勤天数、签到退均工时、人脸修正均工时算法核算；
  4. 应用北京常驻过滤、特定人员/业务排除（000001池宇峰、完美世界文化）；
  5. 全业务线统一接入人脸数据（含洪恩）并统一按 F 列升序排序；
  6. 固化二维冻结窗格（J6/J7）、表头行内富文本（黄色/红色/灰色）、单向防作弊标红与G-F>0.5标红；
  7. 物理清空动态条件格式，导出静态交付版 Excel 及无损分页 PDF。
"""

import argparse
from copy import copy
from datetime import date, datetime, time, timedelta
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.styles.colors import Color
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.pagebreak import Break, RowBreak
from openpyxl.worksheet.views import Selection

try:
    import xlrd
except ImportError:
    xlrd = None

# ============================================================
# 常量定义
# ============================================================
FOCUS_LIST = [
    ("000477", "王巍巍", "洪恩"),
    ("110641", "白雪", "游戏业务"),
    ("114837", "龙田", "游戏业务"),
    ("100438", "薄琳", "游戏业务"),
    ("108913", "林葱郁", "洪恩"),
    ("100929", "林建明", "游戏业务"),
    ("100848", "白雪(小)", "游戏业务"),
    ("000211", "肖鹏", "游戏业务"),
]

AREA_ORDER = ["重点关注", "游戏业务", "集团职能", "影视业务", "虚拟世界", "新业务事业群", "洪恩"]

TARGET_SHEET_ORDER = [
    "重点关注",
    "游戏业务",
    "集团职能",
    "影视业务",
    "虚拟世界",
    "新业务事业群",
    "洪恩",
    "全量",
]

# 字体常量
FONT_WEEKDAY = Font(name="微软雅黑", size=9.0, bold=False, color="FF000000")
FONT_DATE = Font(name="微软雅黑", size=10.0, bold=False, color="FF000000")
FONT_WEEKEND_HEADER = Font(name="微软雅黑", size=10.0, bold=False, color="FF000000")

FONT_IN_OUT_BLACK = Font(name="微软雅黑", size=9.0, bold=False, color="FF000000")
FONT_IN_OUT_RED = Font(name="微软雅黑", size=9.0, bold=False, color="FFE54C5E")
FONT_IN_OUT_GRAY = Font(name="微软雅黑", size=9.0, bold=False, color="FF808080")
FONT_FACE = Font(name="微软雅黑", size=9.0, bold=False, color="FF0070C0")
FONT_OUTING = Font(name="微软雅黑", size=9.0, bold=False, color="FF843E0B")

FILL_WEEKEND_LIGHT = PatternFill(fill_type="solid", fgColor="FFF2F2F2")
FILL_HIGHLIGHT_YELLOW = PatternFill(fill_type="solid", fgColor="FFFFF3CA")
FILL_NONE = PatternFill()

BORDER_MEDIUM_BLACK = Side(style="medium", color="000000")
BORDER_THIN_GRAY = Side(style="thin", color="D9D9D9")

FONT_RT_NORMAL = InlineFont(rFont="微软雅黑", sz=10.0, color=Color(rgb="FF000000"))
FONT_RT_YELLOW = InlineFont(rFont="微软雅黑", sz=10.0, b=True, color=Color(rgb="FFFFC000"))
FONT_RT_RED = InlineFont(rFont="微软雅黑", sz=10.0, b=True, color=Color(rgb="FFFF0000"))
FONT_RT_GRAY = InlineFont(rFont="微软雅黑", sz=10.0, b=False, color=Color(rgb="FF808080"))


# ============================================================
# 工具函数
# ============================================================
def norm_emp_id(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.isdigit():
        try:
            return str(int(text)).zfill(6)
        except ValueError:
            return text
    return text


def employee_id_key(value: Any) -> Tuple[int, Any]:
    if value is None:
        return (1, "")
    text = str(value).strip()
    if not text:
        return (1, "")
    if text.isdigit():
        try:
            return (0, int(text))
        except ValueError:
            return (0, text)
    return (0, text)


def metric_key(value: Any) -> Tuple[int, Any]:
    if value is None:
        return (0, None)
    if isinstance(value, str):
        text = value.strip()
        if not text or text == "-":
            return (0, None)
        try:
            return (1, float(text))
        except ValueError:
            return (1, text)
    if isinstance(value, (int, float)):
        return (1, float(value))
    return (1, str(value))


def is_bj_office(office_text: Any) -> bool:
    if office_text is None:
        return False
    t = str(office_text).strip().upper()
    if not t:
        return False
    return "BJ" in t or "北京" in t or "ABJ1" in t


def parse_time_to_hours(val: Any) -> Optional[float]:
    if val is None or str(val).strip() in ("", "-", "--:--"):
        return None
    h = None
    if isinstance(val, (time, datetime)):
        h = val.hour + val.minute / 60.0 + val.second / 3600.0
    elif isinstance(val, str):
        t = val.strip().replace("次日", "").replace("(+1)", "").replace("（+1）", "")
        if " " in t:
            t = t.split(" ")[-1].strip()
        if ":" in t:
            try:
                parts = [int(x) for x in t.split(":")]
                while len(parts) < 3:
                    parts.append(0)
                h = parts[0] + parts[1] / 60.0 + parts[2] / 3600.0
            except (ValueError, IndexError):
                return None
        else:
            return None
    if h is not None:
        # Excel TIME(3, 59, 59) 跨午夜归一化阈值
        if h <= (3 * 3600 + 59 * 60 + 59) / 3600.0:
            h += 24.0
        return h
    return None


def determine_in_out_font(card_str: str, face_str: str, is_out: bool = False) -> Font:
    """严格对齐 Excel 模板原始条件格式单向防作弊判定"""
    if not card_str or card_str == "--:--":
        return FONT_IN_OUT_GRAY
    if not face_str or face_str == "--:--":
        return FONT_IN_OUT_GRAY

    t_c = parse_time_to_hours(card_str)
    t_f = parse_time_to_hours(face_str)
    if t_c is not None and t_f is not None:
        threshold = 60.0 / 60.0
        if not is_out:
            if (t_c + threshold) < t_f:
                return FONT_IN_OUT_RED
        else:
            if (t_c - threshold) > t_f:
                return FONT_IN_OUT_RED
    return FONT_IN_OUT_BLACK


def format_time_str(val: Any, is_out: bool = False) -> str:
    if val is None or str(val).strip() in ("", "-"):
        return "--:--"
    s = ""
    is_next_day = "次日" in str(val) or "(+1)" in str(val) or "（+1）" in str(val)
    if isinstance(val, (time, datetime)):
        s = f"{val.hour:02d}:{val.minute:02d}"
    else:
        t = str(val).strip().replace("次日", "").replace("(+1)", "").replace("（+1）", "")
        if " " in t:
            t = t.split(" ")[-1].strip()
        if ":" in t:
            parts = t.split(":")
            if len(parts) >= 2:
                try:
                    h = int(parts[0])
                    m = int(parts[1][:2])
                    s = f"{h:02d}:{m:02d}"
                except ValueError:
                    s = t[:5]
            else:
                s = t
        else:
            s = t
    if is_out and s != "--:--":
        try:
            h = int(s.split(":")[0])
            m = int(s.split(":")[1][:2])
            if (h == 0 and m >= 1) or (1 <= h < 4) or is_next_day:
                s += "(+1)"
        except (ValueError, IndexError):
            pass
    return s


def apply_rich_text_legends(target_ws: Any) -> None:
    target_ws.cell(1, 10).value = CellRichText([
        TextBlock(FONT_RT_NORMAL, "单元格 "),
        TextBlock(FONT_RT_YELLOW, "“黄色”"),
        TextBlock(FONT_RT_NORMAL, " ，表示这是一个考勤补签"),
    ])
    target_ws.cell(2, 10).value = CellRichText([
        TextBlock(FONT_RT_NORMAL, "字体 "),
        TextBlock(FONT_RT_RED, "“红色”"),
        TextBlock(FONT_RT_NORMAL, " ，表示这个考勤数据有 “异常” （与人脸识别相差60分钟以上）"),
    ])
    target_ws.cell(3, 10).value = CellRichText([
        TextBlock(FONT_RT_NORMAL, "字体 "),
        TextBlock(FONT_RT_GRAY, "“灰色”"),
        TextBlock(FONT_RT_NORMAL, " ，表示这个日期没有人脸数据"),
    ])


# ============================================================
# 1. 加载花名册
# ============================================================
def load_roster(roster_path: Path) -> Dict[str, Dict[str, Any]]:
    print(f"\n📋 [阶段 1/6] 加载员工花名册: {roster_path.name}")
    roster_map = {}

    suffix = roster_path.suffix.lower()
    if suffix == ".xls":
        if xlrd is None:
            raise RuntimeError("需要 xlrd 库以读取 .xls 文件，请安装: pip install xlrd")
        b = xlrd.open_workbook(str(roster_path))
        sh_name = "数据" if "数据" in b.sheet_names() else b.sheet_names()[0]
        sh = b.sheet_by_name(sh_name)
        header_row = 7 if sh_name == "数据" else 0
        headers = [str(h).strip() for h in sh.row_values(header_row)]

        def get_col(name, default_idx):
            for i, h in enumerate(headers):
                if name in h:
                    return i
            return default_idx

        c_eid = get_col("员工ID", 7)
        c_name = get_col("员工姓名", 8)
        c_biz = get_col("业务类别", 0)
        c_sub = get_col("所属部门", 6)
        c_d4 = get_col("四级部门", 4)
        c_d5 = get_col("五级部门", 5)
        c_off = get_col("办公地点", 31)
        c_comp = get_col("公司", 16)
        c_att = get_col("考勤类型", 30)

        for r in range(header_row + 1, sh.nrows):
            vals = sh.row_values(r)
            eid = norm_emp_id(vals[c_eid])
            if eid:
                parts = [str(vals[c]).strip() for c in [c_d4, c_d5, c_sub] if c < len(vals) and str(vals[c]).strip()]
                dept = ">".join(parts) if parts else ""
                off = vals[c_off] if c_off < len(vals) else ""
                roster_map[eid] = {
                    "raw_id": str(vals[c_eid]).strip(),
                    "name": str(vals[c_name]).strip() if c_name < len(vals) else "",
                    "biz": str(vals[c_biz]).strip() if c_biz < len(vals) else "",
                    "dept": dept,
                    "office": off,
                    "company": str(vals[c_comp]).strip() if c_comp < len(vals) else "",
                    "att_type": str(vals[c_att]).strip() if c_att < len(vals) else "",
                    "is_bj": is_bj_office(off),
                }

    else:
        wb = openpyxl.load_workbook(str(roster_path), data_only=True)
        sh_name = "数据" if "数据" in wb.sheetnames else ("员工花名册" if "员工花名册" in wb.sheetnames else wb.sheetnames[0])
        ws = wb[sh_name]
        header_row = 1
        for r in range(1, min(10, ws.max_row + 1)):
            row_vals = [str(ws.cell(r, c).value or "").strip() for c in range(1, ws.max_column + 1)]
            if any("员工ID" in v or "工号" in v or "员工编号" in v for v in row_vals):
                header_row = r
                headers = row_vals
                break

        def get_col_xlsx(name, default_idx):
            for i, h in enumerate(headers, 1):
                if name in h:
                    return i
            return default_idx

        c_eid = get_col_xlsx("员工ID", 1)
        c_name = get_col_xlsx("员工姓名", 2)
        c_biz = get_col_xlsx("业务类别", 3)
        c_sub = get_col_xlsx("所属部门", 7)
        c_off = get_col_xlsx("办公地点", 41)
        c_comp = get_col_xlsx("公司", 17)
        c_att = get_col_xlsx("考勤类型", 31)

        for r in range(header_row + 1, ws.max_row + 1):
            eid_raw = ws.cell(r, c_eid).value
            eid = norm_emp_id(eid_raw)
            if eid:
                off = ws.cell(r, c_off).value
                roster_map[eid] = {
                    "raw_id": str(eid_raw).strip(),
                    "name": str(ws.cell(r, c_name).value or "").strip(),
                    "biz": str(ws.cell(r, c_biz).value or "").strip(),
                    "dept": str(ws.cell(r, c_sub).value or "").strip(),
                    "office": off,
                    "company": str(ws.cell(r, c_comp).value or "").strip(),
                    "att_type": str(ws.cell(r, c_att).value or "").strip(),
                    "is_bj": is_bj_office(off),
                }
        wb.close()

    print(f"  ✓ 成功读取花名册，在册员工总数: {len(roster_map)} 人")
    return roster_map


# ============================================================
# 2. 动态日历构建与指标计算
# ============================================================
def calculate_attendance_engine(
    raw_xlsx: Path, rules_json: Path
) -> Tuple[Dict[str, Any], Dict[Tuple[str, str], Any], Set[str], List[Tuple[int, date, str]], Set[int], int]:
    print(f"\n⚡ [阶段 2/6] 执行原生考勤工时与异常核算: {raw_xlsx.name}")

    with open(rules_json, "r", encoding="utf-8") as f:
        rules: Dict[str, float] = json.load(f)

    wb_raw = openpyxl.load_workbook(str(raw_xlsx), data_only=True)
    ws_raw = wb_raw["Sheet0"] if "Sheet0" in wb_raw.sheetnames else wb_raw.active

    daily_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
    emp_meta: Dict[str, Dict[str, Any]] = {}
    all_raw_eids: Set[str] = set()
    calendar_map: Dict[str, bool] = {}

    for r in range(2, ws_raw.max_row + 1):
        eid_val = ws_raw.cell(r, 1).value
        if not eid_val or str(eid_val).strip() == "员工编号":
            continue
        eid = norm_emp_id(eid_val)
        all_raw_eids.add(eid)

        name = str(ws_raw.cell(r, 2).value or "").strip()
        dt_val = ws_raw.cell(r, 3).value
        dt_str = str(dt_val)[:10] if dt_val else ""
        d_in = ws_raw.cell(r, 4).value
        e_out = ws_raw.cell(r, 5).value
        f_am = str(ws_raw.cell(r, 6).value or "").strip()
        g_pm = str(ws_raw.cell(r, 7).value or "").strip()
        l_early = ws_raw.cell(r, 12).value
        m_late = ws_raw.cell(r, 13).value
        p_work = str(ws_raw.cell(r, 16).value or "").strip().upper()
        att_type = ws_raw.cell(r, 21).value
        v_in = ws_raw.cell(r, 22).value
        w_out = ws_raw.cell(r, 23).value

        if dt_str and dt_str not in calendar_map:
            calendar_map[dt_str] = (p_work != "N")

        if eid not in emp_meta:
            emp_meta[eid] = {
                "name": name,
                "att_type": att_type,
                "records": [],
            }

        rec = {
            "dt": dt_str,
            "d_in": d_in,
            "e_out": e_out,
            "f_am": f_am,
            "g_pm": g_pm,
            "l_early": l_early,
            "m_late": m_late,
            "p_work": p_work,
            "v_in": v_in,
            "w_out": w_out,
        }
        emp_meta[eid]["records"].append(rec)
        daily_map[(eid, dt_str)] = rec

    wb_raw.close()

    # 动态构建月份日历与列分布
    dates_sorted = sorted(calendar_map.items(), key=lambda x: x[0])
    col_idx = 10
    workdays_config: List[Tuple[int, date, str]] = []
    weekend_cols: Set[int] = set()
    in_workday_session = False
    has_started_workday = False

    weekday_names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]

    for dt_str, is_w in dates_sorted:
        d_obj = datetime.strptime(dt_str, "%Y-%m-%d").date()
        w_str = weekday_names[d_obj.weekday()]
        if is_w:
            workdays_config.append((col_idx, d_obj, w_str))
            col_idx += 1
            has_started_workday = True
            in_workday_session = True
        else:
            if has_started_workday and in_workday_session:
                weekend_cols.add(col_idx)
                col_idx += 1
                in_workday_session = False

    max_col_total = col_idx - 1

    # 核算各项均工时指标
    metrics_map: Dict[str, Dict[str, Any]] = {}
    for eid, info in emp_meta.items():
        total_days = 0.0
        total_duration = 0.0
        total_ag = 0.0
        total_ad = 0.0
        compensate_days = 0

        for rec in info["records"]:
            is_workday = rec["p_work"] != "N"
            has_cards = bool(rec["d_in"] and rec["e_out"])
            weight = 0.0
            if is_workday and has_cards:
                pair = f"{rec['f_am']}|{rec['g_pm']}"
                weight = rules.get(pair, 0.0)

            total_days += weight

            t_d = parse_time_to_hours(rec["d_in"])
            t_e = parse_time_to_hours(rec["e_out"])
            if t_d is not None and t_e is not None:
                dur = t_e - t_d
                if t_e < t_d:
                    dur += 24.0
                if weight > 0:
                    total_duration += dur

            t_l = parse_time_to_hours(rec["l_early"])
            t_m = parse_time_to_hours(rec["m_late"])
            af_val = 0.0
            if rec["f_am"] == "已考勤补签" and t_d is not None and t_l is not None and t_e is not None and t_m is not None:
                if (t_d - t_l) * 60.0 < -30.0 and (t_m - t_e) * 60.0 < -30.0:
                    af_val = 1.0

            ag_val = af_val + weight
            total_ag += ag_val

            if t_l is not None and t_m is not None:
                ad_dur = t_m - t_l
                if t_m < t_l:
                    ad_dur += 24.0
                if ag_val > 0:
                    total_ad += ad_dur

            if rec["f_am"] == "已考勤补签" or rec["g_pm"] == "已考勤补签":
                compensate_days += 1

        d_avg = total_duration / total_days if total_days > 0 else "-"
        h_avg = total_ad / total_ag if total_ag > 0 else "-"

        metrics_map[eid] = {
            "name": info["name"],
            "att_type": info["att_type"],
            "days": total_days,
            "G_val": d_avg,
            "H_val": h_avg,
            "compensate": compensate_days,
        }

    print(f"  ✓ 成功完成 {len(metrics_map)} 名员工的全月工时指标核算（共包含 {len(workdays_config)} 个工作日）")
    return metrics_map, daily_map, all_raw_eids, workdays_config, weekend_cols, max_col_total


# ============================================================
# 3. 构建全量与分表工作簿
# ============================================================
def build_attendance_workbook(
    template_path: Path,
    roster_map: Dict[str, Dict[str, Any]],
    metrics_map: Dict[str, Dict[str, Any]],
    daily_map: Dict[Tuple[str, str], Dict[str, Any]],
    all_raw_eids: Set[str],
    workdays_config: List[Tuple[int, date, str]],
    weekend_cols: Set[int],
    max_col: int,
    exclusions_json: Path,
) -> Tuple[openpyxl.Workbook, Dict[str, int]]:
    print("\n🏗️  [阶段 3/6] 构建静态标准 Excel 工作簿...")

    # 读取排除名单
    excluded_eids = set()
    excluded_bizs = set()
    if exclusions_json.exists():
        with open(exclusions_json, "r", encoding="utf-8") as f:
            ex_data = json.load(f)
            for item in ex_data.get("excluded_employee_ids", []):
                excluded_eids.add(norm_emp_id(item.get("eid")))
            for item in ex_data.get("excluded_businesses", []):
                excluded_bizs.add(item.get("biz"))

    wb = openpyxl.load_workbook(str(template_path))
    bj_assigned: Dict[str, List[Dict[str, Any]]] = {a: [] for a in AREA_ORDER}
    removed_non_bj = []
    removed_unmatched = []
    focus_id_set = {f[0] for f in FOCUS_LIST}

    # 重点关注固定人员
    for fid, fname, fbiz in FOCUS_LIST:
        fid_norm = norm_emp_id(fid)
        if fid in metrics_map or fid_norm in metrics_map:
            m = metrics_map.get(fid, metrics_map.get(fid_norm, {}))
            r_info = roster_map.get(fid_norm, {})
            dept = r_info.get("dept", "")
            bj_assigned["重点关注"].append({
                "eid": fid,
                "name": fname,
                "biz": fbiz,
                "dept": dept,
                "att_type": m.get("att_type") or r_info.get("att_type", ""),
                "G_val": m.get("G_val", "-"),
                "F_val": m.get("H_val", "-"),
                "H_val": m.get("compensate", 0),
            })

    # 其他员工分流
    for eid in sorted(all_raw_eids):
        eid_norm = norm_emp_id(eid)
        if eid in focus_id_set or eid_norm in focus_id_set:
            continue
        if eid in excluded_eids or eid_norm in excluded_eids:
            removed_non_bj.append((eid, metrics_map.get(eid, {}).get("name", ""), "特殊白名单排除"))
            continue

        if eid_norm in roster_map:
            r_info = roster_map[eid_norm]
            if r_info["is_bj"]:
                biz = r_info["biz"]
                if biz in excluded_bizs:
                    removed_non_bj.append((eid, metrics_map.get(eid, {}).get("name", ""), f"{biz}(业务排除)"))
                    continue

                target_area = "集团职能"
                if biz in AREA_ORDER:
                    target_area = biz
                elif biz in ["电竞与平台业务"]:
                    target_area = "游戏业务"
                elif biz == "影视业务":
                    target_area = "影视业务"
                elif biz in ["体外业务(鲲鹏/通识)"]:
                    target_area = "集团职能"

                m = metrics_map.get(eid, {})
                bj_assigned[target_area].append({
                    "eid": eid,
                    "name": m.get("name", ""),
                    "biz": biz,
                    "dept": r_info["dept"],
                    "att_type": m.get("att_type") or r_info.get("att_type", ""),
                    "G_val": m.get("G_val", "-"),
                    "F_val": m.get("H_val", "-"),
                    "H_val": m.get("compensate", 0),
                })
            else:
                removed_non_bj.append((eid, metrics_map.get(eid, {}).get("name", ""), r_info["office"]))
        else:
            removed_unmatched.append((eid, metrics_map.get(eid, {}).get("name", "")))

    print("  • 员工归属统计:")
    for a in AREA_ORDER:
        print(f"      [{a:<10}]: {len(bj_assigned[a]):>3} 人")
    print(f"  • 剔除非北京/业务排除人员: {len(removed_non_bj)} 人")
    print(f"  • 剔除未匹配人员: {len(removed_unmatched)} 人")

    # 全业务线统一按 F 列（人脸修正均工时）升序排序
    for a in AREA_ORDER:
        bj_assigned[a].sort(key=lambda x: (metric_key(x["F_val"]), employee_id_key(x["eid"])))

    for sname in list(wb.sheetnames):
        if sname not in TARGET_SHEET_ORDER:
            del wb[sname]

    ws_full = wb["全量"]

    # 捕获表头第 1~5 行样式骨架
    hdr_rows = []
    for r in range(1, 6):
        r_cells = []
        for c in range(1, max_col + 1):
            cell = ws_full.cell(r, c)
            r_cells.append({
                "value": cell.value,
                "font": copy(cell.font),
                "fill": copy(cell.fill),
                "border": copy(cell.border),
                "alignment": copy(cell.alignment),
                "number_format": cell.number_format,
            })
        hdr_rows.append({"cells": r_cells, "height": ws_full.row_dimensions[r].height})

    hdr_merges = [
        (m.min_row - 1, m.max_row - 1, m.min_col, m.max_col)
        for m in ws_full.merged_cells.ranges
        if m.max_row <= 5 and m.max_col < 10
    ]

    r6_snap = {
        "height": ws_full.row_dimensions[6].height,
        "font": copy(ws_full.cell(6, 1).font),
        "fill": copy(ws_full.cell(6, 1).fill),
        "alignment": copy(ws_full.cell(6, 1).alignment),
        "border": copy(ws_full.cell(6, 1).border),
    }

    base_col_styles = []
    for off in range(6):
        r = 7 + off
        styles = []
        for c in range(1, 10):
            cell = ws_full.cell(r, c)
            styles.append({
                "font": copy(cell.font),
                "alignment": copy(cell.alignment),
                "border": copy(cell.border),
                "fill": copy(cell.fill),
            })
        base_col_styles.append({
            "cells": styles,
            "height": ws_full.row_dimensions[r].height,
        })

    # 重构全量表
    for m in list(ws_full.merged_cells.ranges):
        ws_full.unmerge_cells(str(m))
    if ws_full.max_row >= 1:
        ws_full.delete_rows(1, ws_full.max_row)

    for r_idx, r_data in enumerate(hdr_rows, 1):
        ws_full.row_dimensions[r_idx].height = r_data["height"]
        for c_idx, c_data in enumerate(r_data["cells"], 1):
            cell = ws_full.cell(r_idx, c_idx)
            cell.value = c_data["value"]
            cell.font = copy(c_data["font"])
            cell.fill = copy(c_data["fill"])
            cell.border = copy(c_data["border"])
            cell.alignment = copy(c_data["alignment"])
            cell.number_format = c_data["number_format"]

    for min_off, max_off, min_col, max_col_m in hdr_merges:
        ws_full.merge_cells(start_row=1 + min_off, end_row=1 + max_off, start_column=min_col, end_column=max_col_m)

    # 动态写入工作日表头
    for col_idx, dt, w_name in workdays_config:
        for r in range(1, 6):
            ws_full.cell(r, col_idx).fill = FILL_NONE
            ws_full.cell(r, col_idx).border = Border()
        c4 = ws_full.cell(4, col_idx)
        c4.value = w_name
        c4.font = FONT_WEEKDAY
        c4.alignment = Alignment(horizontal="center", vertical="center")
        c5 = ws_full.cell(5, col_idx)
        c5.value = date(dt.year, dt.month, dt.day)
        c5.font = FONT_DATE
        c5.number_format = "m/d;@"
        c5.alignment = Alignment(horizontal="center", vertical="center")
        ws_full.column_dimensions[get_column_letter(col_idx)].width = 11.17

    # 动态写入周末列表头
    for col_idx in weekend_cols:
        for r in range(1, 3):
            ws_full.cell(r, col_idx).fill = FILL_NONE
            ws_full.cell(r, col_idx).border = Border()
        ws_full.cell(3, col_idx).value = None
        ws_full.cell(3, col_idx).fill = FILL_WEEKEND_LIGHT
        ws_full.cell(3, col_idx).border = Border()

        c4 = ws_full.cell(4, col_idx)
        c4.value = "周末/假期"
        c4.font = FONT_WEEKEND_HEADER
        c4.fill = FILL_WEEKEND_LIGHT
        c4.alignment = Alignment(horizontal="center", vertical="center")
        c4.border = Border()

        c5 = ws_full.cell(5, col_idx)
        c5.value = None
        c5.fill = FILL_WEEKEND_LIGHT
        c5.border = Border()

        ws_full.merge_cells(start_row=4, end_row=5, start_column=col_idx, end_column=col_idx)
        ws_full.column_dimensions[get_column_letter(col_idx)].width = 9.17

    apply_rich_text_legends(ws_full)

    cursor = 6
    section_ranges: Dict[str, Tuple[int, int]] = {}

    for area in AREA_ORDER:
        emps = bj_assigned[area]
        if not emps:
            continue

        ws_full.row_dimensions[cursor].height = r6_snap["height"]
        ws_full.cell(cursor, 1).value = area
        ws_full.cell(cursor, 1).font = copy(r6_snap["font"])
        ws_full.cell(cursor, 1).fill = copy(r6_snap["fill"])
        ws_full.cell(cursor, 1).alignment = copy(r6_snap["alignment"])
        ws_full.cell(cursor, 1).border = copy(r6_snap["border"])
        for c in range(2, max_col + 1):
            ws_full.cell(cursor, c).border = Border(bottom=BORDER_MEDIUM_BLACK)
            ws_full.cell(cursor, c).fill = copy(r6_snap["fill"])
        ws_full.merge_cells(start_row=cursor, end_row=cursor, start_column=1, end_column=max_col)
        cursor += 1

        start_row = cursor
        for emp in emps:
            eid = emp["eid"]

            for off in range(6):
                row_num = cursor + off
                ws_full.row_dimensions[row_num].height = base_col_styles[off]["height"]
                b_side = None
                if off in [1, 3]:
                    b_side = BORDER_THIN_GRAY
                elif off == 5:
                    b_side = BORDER_MEDIUM_BLACK

                for c in range(1, 10):
                    cell = ws_full.cell(row_num, c)
                    st = base_col_styles[off]["cells"][c - 1]
                    cell.font = copy(st["font"])
                    cell.alignment = copy(st["alignment"])
                    cell.fill = copy(st["fill"])
                    b = Border(
                        left=copy(st["border"].left),
                        right=copy(st["border"].right),
                        top=None,
                        bottom=b_side if off in [1, 3, 5] else None,
                    )
                    cell.border = b

                for col_idx in range(10, max_col + 1):
                    cell = ws_full.cell(row_num, col_idx)
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                    if col_idx in weekend_cols:
                        cell.border = Border(left=None, right=None, top=None, bottom=b_side if off == 5 else None)
                        cell.fill = FILL_WEEKEND_LIGHT
                    else:
                        cell.border = Border(left=None, right=None, top=None, bottom=b_side)
                        cell.fill = FILL_NONE

            # 基础信息
            ws_full.cell(cursor, 1).value = emp["eid"]
            ws_full.cell(cursor, 2).value = emp["name"]
            ws_full.cell(cursor, 3).value = emp["biz"]
            ws_full.cell(cursor, 4).value = emp["att_type"]
            ws_full.cell(cursor, 5).value = emp["dept"]

            # F / G 列数值与格式
            f_disp = emp["F_val"]
            if f_disp != "-" and isinstance(f_disp, (int, float)):
                f_disp = round(float(f_disp), 2)
                ws_full.cell(cursor, 6).number_format = "0.00"

            g_disp = emp["G_val"]
            if g_disp != "-" and isinstance(g_disp, (int, float)):
                g_disp = round(float(g_disp), 2)
                ws_full.cell(cursor, 7).number_format = "0.00"

            ws_full.cell(cursor, 6).value = f_disp
            ws_full.cell(cursor, 7).value = g_disp

            # G - F > 0.5 标红
            is_g_red = False
            if f_disp != "-" and g_disp != "-":
                try:
                    if (float(g_disp) - float(f_disp)) > 0.5:
                        is_g_red = True
                except (ValueError, TypeError):
                    pass

            g_font = FONT_IN_OUT_RED if is_g_red else FONT_IN_OUT_BLACK
            for r_off in range(6):
                ws_full.cell(cursor + r_off, 7).font = copy(g_font)

            ws_full.cell(cursor, 8).value = emp["H_val"]
            ws_full.cell(cursor, 9).value = "A（签到/签退）"
            ws_full.cell(cursor + 2, 9).value = "B（人脸）"
            ws_full.cell(cursor + 4, 9).value = "C（因公外出）"

            # 每日打卡明细
            for col_idx, dt, _ in workdays_config:
                dt_str = f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
                d_rec = daily_map.get((eid, dt_str), {})

                face_early_str = format_time_str(d_rec.get("l_early"))
                face_late_str = format_time_str(d_rec.get("m_late"))

                din_str = format_time_str(d_rec.get("d_in"))
                c_in = ws_full.cell(cursor, col_idx)
                c_in.value = din_str
                c_in.font = determine_in_out_font(din_str, face_early_str)

                eout_str = format_time_str(d_rec.get("e_out"), is_out=True)
                c_out = ws_full.cell(cursor + 1, col_idx)
                c_out.value = eout_str
                c_out.font = determine_in_out_font(eout_str, face_late_str, is_out=True)

                c_fe = ws_full.cell(cursor + 2, col_idx)
                c_fe.value = face_early_str
                c_fe.font = FONT_FACE

                c_fl = ws_full.cell(cursor + 3, col_idx)
                c_fl.value = face_late_str
                c_fl.font = FONT_FACE

                c_vo = ws_full.cell(cursor + 4, col_idx)
                c_vo.value = format_time_str(d_rec.get("v_in"))
                c_vo.font = FONT_OUTING

                c_ve = ws_full.cell(cursor + 5, col_idx)
                c_ve.value = format_time_str(d_rec.get("w_out"))
                c_ve.font = FONT_OUTING

                fam = str(d_rec.get("f_am", "")).strip()
                gpm = str(d_rec.get("g_pm", "")).strip()
                if fam == "已考勤补签":
                    c_in.fill = FILL_HIGHLIGHT_YELLOW
                if gpm == "已考勤补签":
                    c_out.fill = FILL_HIGHLIGHT_YELLOW

            for c in range(1, 9):
                ws_full.merge_cells(start_row=cursor, end_row=cursor + 5, start_column=c, end_column=c)
            ws_full.merge_cells(start_row=cursor, end_row=cursor + 1, start_column=9, end_column=9)
            ws_full.merge_cells(start_row=cursor + 2, end_row=cursor + 3, start_column=9, end_column=9)
            ws_full.merge_cells(start_row=cursor + 4, end_row=cursor + 5, start_column=9, end_column=9)

            cursor += 6

        section_ranges[area] = (start_row, cursor - 1)

    # 复制到 7 个业务分表
    def copy_rows(src_ws, dst_ws, start_r, end_r, target_start):
        for offset in range(end_r - start_r + 1):
            s_row = start_r + offset
            d_row = target_start + offset
            dst_ws.row_dimensions[d_row].height = src_ws.row_dimensions[s_row].height
            for c in range(1, max_col + 1):
                src_cell = src_ws.cell(s_row, c)
                dst_cell = dst_ws.cell(d_row, c)
                dst_cell.value = src_cell.value
                dst_cell.font = copy(src_cell.font)
                dst_cell.fill = copy(src_cell.fill)
                dst_cell.border = copy(src_cell.border)
                dst_cell.alignment = copy(src_cell.alignment)
                dst_cell.number_format = src_cell.number_format

        for m in src_ws.merged_cells.ranges:
            if m.min_row >= start_r and m.max_row <= end_r:
                r_off = target_start - start_r
                dst_ws.merge_cells(
                    start_row=m.min_row + r_off,
                    end_row=m.max_row + r_off,
                    start_column=m.min_col,
                    end_column=m.max_col,
                )

    for area in AREA_ORDER:
        ws_biz = wb[area]
        for m in list(ws_biz.merged_cells.ranges):
            ws_biz.unmerge_cells(str(m))
        if ws_biz.max_row >= 1:
            ws_biz.delete_rows(1, ws_biz.max_row)

        for r_idx, r_data in enumerate(hdr_rows, 1):
            ws_biz.row_dimensions[r_idx].height = r_data["height"]
            for c_idx, c_data in enumerate(r_data["cells"], 1):
                cell = ws_biz.cell(r_idx, c_idx)
                cell.value = c_data["value"]
                cell.font = copy(c_data["font"])
                cell.fill = copy(c_data["fill"])
                cell.border = copy(c_data["border"])
                cell.alignment = copy(c_data["alignment"])
                cell.number_format = c_data["number_format"]

        for min_off, max_off, min_col, max_col_m in hdr_merges:
            ws_biz.merge_cells(start_row=1 + min_off, end_row=1 + max_off, start_column=min_col, end_column=max_col_m)

        for col_idx, dt, w_name in workdays_config:
            for r in range(1, 6):
                ws_biz.cell(r, col_idx).fill = FILL_NONE
                ws_biz.cell(r, col_idx).border = Border()
            c4 = ws_biz.cell(4, col_idx)
            c4.value = w_name
            c4.font = FONT_WEEKDAY
            c4.alignment = Alignment(horizontal="center", vertical="center")
            c5 = ws_biz.cell(5, col_idx)
            c5.value = date(dt.year, dt.month, dt.day)
            c5.font = FONT_DATE
            c5.number_format = "m/d;@"
            c5.alignment = Alignment(horizontal="center", vertical="center")
            ws_biz.column_dimensions[get_column_letter(col_idx)].width = 11.17

        for col_idx in weekend_cols:
            for r in range(1, 3):
                ws_biz.cell(r, col_idx).fill = FILL_NONE
                ws_biz.cell(r, col_idx).border = Border()
            ws_biz.cell(3, col_idx).value = None
            ws_biz.cell(3, col_idx).fill = FILL_WEEKEND_LIGHT
            c4 = ws_biz.cell(4, col_idx)
            c4.value = "周末/假期"
            c4.font = FONT_WEEKEND_HEADER
            c4.fill = FILL_WEEKEND_LIGHT
            c4.alignment = Alignment(horizontal="center", vertical="center")
            c5 = ws_biz.cell(5, col_idx)
            c5.value = None
            c5.fill = FILL_WEEKEND_LIGHT
            c5.border = Border()
            ws_biz.merge_cells(start_row=4, end_row=5, start_column=col_idx, end_column=col_idx)
            ws_biz.column_dimensions[get_column_letter(col_idx)].width = 9.17

        ws_biz.row_dimensions[6].height = r6_snap["height"]
        ws_biz.cell(6, 1).value = area
        ws_biz.cell(6, 1).font = copy(r6_snap["font"])
        ws_biz.cell(6, 1).fill = copy(r6_snap["fill"])
        ws_biz.cell(6, 1).alignment = copy(r6_snap["alignment"])
        ws_biz.cell(6, 1).border = copy(r6_snap["border"])
        for c in range(2, max_col + 1):
            ws_biz.cell(6, c).border = Border(bottom=BORDER_MEDIUM_BLACK)
            ws_biz.cell(6, c).fill = copy(r6_snap["fill"])
        ws_biz.merge_cells(start_row=6, end_row=6, start_column=1, end_column=max_col)

        sr, er = section_ranges[area]
        copy_rows(ws_full, ws_biz, sr, er, 7)
        apply_rich_text_legends(ws_biz)

    # 规范 Tab 顺序与视图配置
    ordered_sheets = []
    current_sheets = {s.title: s for s in wb.worksheets}
    for name in TARGET_SHEET_ORDER:
        if name in current_sheets:
            ordered_sheets.append(current_sheets[name])
    setattr(wb, "_sheets", ordered_sheets)

    for ws_each in wb.worksheets:
        active_c = "J6" if ws_each.title == "全量" else "J7"
        ws_each.freeze_panes = active_c
        for sv in ws_each.views.sheetView:
            sv.zoomScale = 100
            sv.zoomScaleNormal = 100
            sv.topLeftCell = "A1"
            sv.selection = [Selection(activeCell=active_c, sqref=active_c)]
        ws_each.conditional_formatting = ConditionalFormattingList()

    counts = {a: len(bj_assigned[a]) for a in AREA_ORDER}
    return wb, counts


# ============================================================
# 4. 原生高质量无损 PDF 导出
# ============================================================
def export_pdf_applescript(src_xlsx: Path, sheet_name: str, target_pdf: Path, max_col: int) -> None:
    wb = openpyxl.load_workbook(str(src_xlsx), rich_text=True)
    for name in list(wb.sheetnames):
        if name != sheet_name:
            del wb[name]
    ws = wb[sheet_name]

    last_row = ws.max_row
    max_col_letter = get_column_letter(max_col)

    ws.print_title_rows = "1:5"
    ws.print_area = f"A1:{max_col_letter}{last_row}"
    ps = ws.page_setup
    pm = ws.page_margins
    ps.orientation = "landscape"
    ps.paperSize = 1
    ps.scale = None
    ps.fitToWidth = 1
    ps.fitToHeight = False
    pm.left = 0.25
    pm.right = 0.25
    pm.top = 0.0
    pm.bottom = 0.0
    pm.header = 0.0
    pm.footer = 0.0

    ws.row_breaks = RowBreak()
    target_pages = max(1, math.ceil((last_row - 5) / 104))
    current_start = 6
    for page_index in range(1, target_pages):
        remaining_pages = target_pages - page_index + 1
        target_row = current_start + math.ceil((last_row - current_start + 1) / remaining_pages)
        candidates = [r for r in range(current_start + 1, min(target_row, last_row) + 1) if ws.cell(r, 1).value is not None]
        if not candidates:
            break
        next_start = candidates[-1]
        ws.row_breaks.append(Break(id=next_start - 1))
        current_start = next_start

    temp_xlsx = src_xlsx.parent / "_pdf_temp_in.xlsx"
    temp_pdf = src_xlsx.parent / "_pdf_temp_out.pdf"

    for p in [temp_xlsx, temp_pdf]:
        if p.exists():
            p.unlink()

    wb.save(str(temp_xlsx))
    wb.close()

    x_str = str(temp_xlsx.resolve())
    p_str = str(temp_pdf.resolve())

    applescript = f'''
tell application "Microsoft Excel"
    launch
    set display alerts to false
    set theWorkbook to open workbook workbook file name "{x_str}"
    delay 0.8
    save workbook as theWorkbook filename "{p_str}" file format PDF file format
    delay 0.8
    close theWorkbook saving no
    delay 0.3
end tell
'''
    res = subprocess.run(["osascript"], input=applescript, capture_output=True, text=True, timeout=120)
    if temp_xlsx.exists():
        temp_xlsx.unlink()

    if res.returncode != 0 or not temp_pdf.exists():
        raise RuntimeError(f"PDF 导出失败 ({sheet_name}): {res.stderr.strip()}")

    if target_pdf.exists():
        target_pdf.unlink()
    shutil.move(str(temp_pdf), str(target_pdf))
    print(f"  ✓ PDF 导出成功: {target_pdf.name} ({target_pdf.stat().st_size / 1024:.1f} KB)")


# ============================================================
# 主执行入口
# ============================================================
def run_pipeline(
    raw_path: Path,
    roster_path: Path,
    rules_path: Path,
    exclusions_path: Path,
    template_path: Path,
    out_dir: Path,
    export_pdf: bool = True,
) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. 读取花名册
    roster_map = load_roster(roster_path)

    # 2. 计算工时与日历
    metrics_map, daily_map, all_raw_eids, workdays_config, weekend_cols, max_col = calculate_attendance_engine(
        raw_path, rules_path
    )

    # 3. 构建工作簿
    wb, counts = build_attendance_workbook(
        template_path,
        roster_map,
        metrics_map,
        daily_map,
        all_raw_eids,
        workdays_config,
        weekend_cols,
        max_col,
        exclusions_path,
    )

    # 自动识别月份命名
    sample_dt = workdays_config[0][1]
    last_dt = workdays_config[-1][1]
    month_tag = f"{sample_dt.year:04d}年{sample_dt.month:02d}01-{last_dt.month:02d}{last_dt.day:02d}"

    out_excel = out_dir / f"考勤数据+排名-{month_tag}- v1.0.xlsx"
    out_latest = out_dir / f"考勤数据+排名-{month_tag}- v1.0_最新.xlsx"

    wb.save(str(out_excel))
    wb.close()
    shutil.copy2(out_excel, out_latest)
    print(f"\n💾 [阶段 4/6] Excel 已生成: {out_excel.name}")

    # 4. 导出 PDF
    pdf_full = out_dir / f"全量_考勤数据+排名-{month_tag}- v1.0.pdf"
    pdf_focus = out_dir / f"重点关注_考勤数据+排名-{month_tag}- v1.0.pdf"

    if export_pdf and sys.platform == "darwin":
        print("\n📄 [阶段 5/6] 导出全量与重点关注 PDF...")
        export_pdf_applescript(out_excel, "全量", pdf_full, max_col)
        export_pdf_applescript(out_excel, "重点关注", pdf_focus, max_col)

    return {
        "status": "success",
        "month_tag": month_tag,
        "counts": counts,
        "total_employees": counts.get("全量", sum(counts.values())),
        "excel_path": str(out_excel),
        "pdf_full_path": str(pdf_full) if pdf_full.exists() else None,
        "pdf_focus_path": str(pdf_focus) if pdf_focus.exists() else None,
    }


def main():
    parser = argparse.ArgumentParser(description="企业考勤月报全流程自动化交付引擎")
    parser.add_argument("--raw", required=True, help="原始考勤打卡底表 (.xlsx)")
    parser.add_argument("--roster", required=True, help="员工花名册 (.xls 或 .xlsx)")
    parser.add_argument("--rules", default=str(Path(__file__).parent.parent / "config" / "考勤规则.json"), help="考勤规则库 (.json)")
    parser.add_argument("--exclusions", default=str(Path(__file__).parent.parent / "config" / "exclusions.json"), help="排除名单 (.json)")
    parser.add_argument("--template", default=str(Path(__file__).parent.parent / "template" / "attendance_template.xlsm"), help="模板文件 (.xlsm)")
    parser.add_argument("--out-dir", default="./交付", help="输出目录")
    parser.add_argument("--no-pdf", action="store_true", help="跳过 PDF 导出")
    args = parser.parse_args()

    res = run_pipeline(
        raw_path=Path(args.raw).resolve(),
        roster_path=Path(args.roster).resolve(),
        rules_path=Path(args.rules).resolve(),
        exclusions_path=Path(args.exclusions).resolve(),
        template_path=Path(args.template).resolve(),
        out_dir=Path(args.out_dir).resolve(),
        export_pdf=not args.no_pdf,
    )
    print("\n🎉 考勤月报处理全部完成！")
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
