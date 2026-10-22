#!/usr/bin/env python3
"""
2026年09月 考勤月报端到端全自动交付脚本
功能特性:
  1. 动态表头自适应匹配花名册 (免疫字段增减或列偏移)
  2. 接入最新考勤规则库 (包含5种新状态组合)
  3. 人员精准归属与过滤:
     - 5位花名册外人员按业务明确组织归入对应分表 (考勤类型留空)
     - 000001 (池宇峰) 与 601102 (陈阳, 完美世界文化) 确认排除
     - 110641 (白雪) 重点关注名单保留坑位且数据留空
     - 非北京常驻人员严格剔除
     - 洪恩业务线按方案B全面接入人脸与F列核算，全员按F列升序排序
  4. 2026年9月工作日日历智能适配 (22个工作日，4个周末/假期列，总列数至AI列)
  5. 视觉固化:
     - 单向60分钟防作弊标红与跨午夜归一化
     - G - F > 0.5 均工时偏差标红
     - J1~J3富文本行内图例、J6/J7二维冻结窗格
     - 彻底清除动态条件格式，纯静态交付
  6. 产出交付件:
     - 单一 Excel: 考勤数据+排名-2026年0901-0930- v1.0.xlsx (无“最新”后缀)
     - 全量与重点关注双 PDF (无损打印排版)
"""

import contextlib
import json
import math
import shutil
import subprocess
import sys
from copy import copy
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

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
# 常量与路径配置
# ============================================================
BASE_DIR = Path("/Users/xianer/Downloads/考勤月报/Data")
MONTH_DIR = BASE_DIR / "202609"

SRC_DATA_FILE = MONTH_DIR / "考勤数据0901至0930(含合并卡数据).xlsx"
PRIMARY_ROSTER_FILE = BASE_DIR / "〔中台〕员工花名册-OD_zhaohui118278_2026-09-03_10-11-06.xls"
SUPPLEMENT_ROSTER_FILE = BASE_DIR / "员工花名册.xlsx"
RULES_FILE = BASE_DIR / "考勤规则.json"
TEMPLATE_FILE = BASE_DIR.parent / "Attendance Analysis template-March.xlsm"
if not TEMPLATE_FILE.exists():
    TEMPLATE_FILE = Path("/Users/xianer/.agents/skills/_disabled/monthly-attendance-report/template/attendance_template.xlsm")
OUTPUT_DIR = MONTH_DIR / "交付"

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

# 特殊排除人员名单与业务
# 130700 (见川)、130753 (Happy Liu) 确认归属游戏业务(定潮工作室)，本次按业务指示剔除，下次有数据再纳入游戏业务生成
EXCLUDED_EIDS = {"000001", "601102", "130700", "130753"}
EXCLUDED_BIZS = {"完美世界文化"}

# 手工确认补充的花名册外人员 (130700、130753 本次剔除)
MANUAL_EMPLOYEES = {
    "130734": {
        "eid": "130734",
        "name": "唐思遥",
        "biz": "游戏业务",
        "target_area": "游戏业务",
        "dept": "黑羽工作室>KIZUNA",
        "office": "北京",
        "is_bj": True,
        "att_type": "",
    },
    "606765": {
        "eid": "606765",
        "name": "宋阳",
        "biz": "虚拟世界",
        "target_area": "虚拟世界",
        "dept": "业务管理部",
        "office": "北京",
        "is_bj": True,
        "att_type": "",
    },
    "804257": {
        "eid": "804257",
        "name": "秦健",
        "biz": "洪恩",
        "target_area": "洪恩",
        "dept": "国内营销中心>商业化程序中台",
        "office": "北京",
        "is_bj": True,
        "att_type": "",
    },
}

# 用户明确确认：视同补签进行“标黄”的非补签异常打卡名单 (工号, 日期, 签到/签退端)
# 包括张月阳(9/9)、马曼曼(9/24)、徐研芳(9/20)、张雨姗(9/23)、陈永波(9/1)
CONFIRMED_YELLOW_HIGHLIGHTS: set[tuple[str, str, str]] = {
    ("128898", "2026-09-09", "in"),   # 张月阳 9/9 签到 12:00
    ("109476", "2026-09-24", "out"),  # 马曼曼 9/24 签退 13:00
    ("117707", "2026-09-20", "out"),  # 徐研芳 9/20 签退 14:30
    ("800954", "2026-09-23", "out"),  # 张雨姗 9/23 签退 15:50
    ("802356", "2026-09-01", "in"),   # 陈永波 9/1 签到 09:30
}

# ============================================================
# 固化样式常量
# ============================================================
FONT_WEEKDAY = Font(name="微软雅黑", size=9.0, bold=False, color="FF000000")
FONT_DATE = Font(name="微软雅黑", size=10.0, bold=False, color="FF000000")
FONT_WEEKEND_HEADER = Font(name="微软雅黑", size=10.0, bold=False, color="FF000000")

FONT_IN_OUT_BLACK = Font(name="微软雅黑", size=9.0, bold=False, color="FF000000")
FONT_IN_OUT_RED = Font(name="微软雅黑", size=9.0, bold=False, color="FFE54C5E")
FONT_IN_OUT_GRAY = Font(name="微软雅黑", size=9.0, bold=False, color="FF808080")
FONT_FACE = Font(name="微软雅黑", size=9.0, bold=False, color="FF0070C0")
FONT_OUTING = Font(name="微软雅黑", size=9.0, bold=False, color="FF000000")

FILL_WEEKEND_LIGHT = PatternFill(fill_type="solid", fgColor="FFF2F2F2")
FILL_HIGHLIGHT_YELLOW = PatternFill(fill_type="solid", fgColor="FFFFF3CA")
FILL_NONE = PatternFill()

# 方案三: 纯净白底无填充，微文本标签明度与字重分层 (方案 A)
# 出差: [出差] 深海青黑体字
FONT_STATUS_TRAVEL = Font(name="微软雅黑", size=9.0, bold=True, color="FF004085")
# 全天请假: 【全天请假】 深炭黑加粗体字 (醒目扎实，一眼抓住整天休假)
FONT_STATUS_LEAVE_FULL = Font(name="微软雅黑", size=9.0, bold=True, color="FF1A202C")
# 半天请假: 【上午请假】/【下午请假】 雅致中灰常规字重 (优雅轻描，比全天明显变浅约40%)
FONT_STATUS_LEAVE_HALF = Font(name="微软雅黑", size=9.0, bold=False, color="FF718096")

BORDER_MEDIUM_BLACK = Side(style="medium", color="000000")
BORDER_THIN_GRAY = Side(style="thin", color="D9D9D9")

FONT_RT_NORMAL = InlineFont(rFont="微软雅黑", sz=10.0, color=Color(rgb="FF000000"))
FONT_RT_YELLOW = InlineFont(rFont="微软雅黑", sz=10.0, b=True, color=Color(rgb="FFFFC000"))
FONT_RT_RED = InlineFont(rFont="微软雅黑", sz=10.0, b=True, color=Color(rgb="FFFF0000"))
FONT_RT_GRAY = InlineFont(rFont="微软雅黑", sz=10.0, b=False, color=Color(rgb="FF808080"))


def apply_rich_text_legends(target_ws: Any) -> None:
    """在 J1, J2, J3 写入带有黄色、红色、灰色关键字色彩高亮的富文本说明"""
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
# 工具函数
# ============================================================
def norm_emp_id(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    text = text.removesuffix(".0")
    if text.isdigit():
        try:
            return str(int(text)).zfill(6)
        except ValueError:
            return text
    return text


def employee_id_key(value: Any) -> tuple[int, Any]:
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


def metric_key(value: Any) -> tuple[int, Any]:
    if value is None:
        return (0, None)
    if isinstance(value, str):
        text = value.strip()
        if not text or text == "-":
            return (0, None)
        try:
            return (1, float(text))
        except ValueError:
            if ":" in text:
                try:
                    parts = [int(p) for p in text.split(":")]
                    while len(parts) < 3:
                        parts.append(0)
                    h, m, s = parts[:3]
                    return (1, h + m / 60.0 + s / 3600.0)
                except ValueError:
                    return (1, text)
            return (1, text)
    if isinstance(value, (int, float)):
        try:
            return (1, float(value))
        except (ValueError, TypeError):
            return (1, value)
    return (1, str(value))


def is_bj_office(office_text: Any) -> bool:
    if office_text is None:
        return False
    t = str(office_text).strip().upper()
    if not t:
        return False
    return "BJ" in t or "北京" in t or "ABJ1" in t


def parse_time_to_hours(val: Any) -> float | None:
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
        if h <= (3 * 3600 + 59 * 60 + 59) / 3600.0:
            h += 24.0
        return h
    return None


def determine_in_out_font(card_str: str, face_str: str, is_out: bool = False) -> Font:
    if not card_str or card_str == "--:--":
        return FONT_IN_OUT_GRAY
    if not face_str or face_str == "--:--":
        return FONT_IN_OUT_GRAY

    t_c = parse_time_to_hours(card_str)
    t_f = parse_time_to_hours(face_str)
    if t_c is not None and t_f is not None:
        THRESHOLD_H = 60.0 / 60.0
        if not is_out:
            if (t_c + THRESHOLD_H) < t_f:
                return FONT_IN_OUT_RED
        else:
            if (t_c - THRESHOLD_H) > t_f:
                return FONT_IN_OUT_RED

    return FONT_IN_OUT_BLACK


def format_time_str(val: Any, is_out: bool = False) -> str:
    if val is None or str(val).strip() in ("", "-", "--:--"):
        return "--:--"
    s = ""
    val_str = str(val).strip()
    is_next_day = "次日" in val_str or "(+1)" in val_str or "（+1）" in val_str
    h = None
    if isinstance(val, (time, datetime)):
        s = f"{val.hour:02d}:{val.minute:02d}"
        h = val.hour
    else:
        t = val_str.replace("次日", "").replace("(+1)", "").replace("（+1）", "")
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

    if (is_next_day or (is_out and h is not None and h < 4)) and s and s != "--:--":
        return f"{s}(+1)"
    return s if s else "--:--"


def set_cell(target_ws: Any, row: int, col: int, val: Any) -> None:
    cell_obj = target_ws.cell(row, col)
    cell_obj.value = val


def get_attendance_status(f_am: Any, g_pm: Any) -> str:
    """根据底表 F 列(上午状态)与 G 列(下午状态)计算 D 考勤状态 (方案三: 微文本标签):
    1. 半天或全天出差，或同时出差和请假 -> 统一显示 '[出差]'
    2. 上下午均请假(含调休) -> '【全天请假】'
    3. 仅上午请假(含调休) -> '【上午请假】'
    4. 仅下午请假(含调休) -> '【下午请假】'
    5. 其余无请假出差 -> 空字符串 ''
    """
    f_am_str = str(f_am or "").strip()
    g_pm_str = str(g_pm or "").strip()

    is_travel_am = ("差旅" in f_am_str) or ("出差" in f_am_str)
    is_travel_pm = ("差旅" in g_pm_str) or ("出差" in g_pm_str)
    is_travel = is_travel_am or is_travel_pm

    is_leave_am = ("请假" in f_am_str) or ("调休" in f_am_str)
    is_leave_pm = ("请假" in g_pm_str) or ("调休" in g_pm_str)

    if is_travel:
        return "[出差]"
    if is_leave_am and is_leave_pm:
        return "【全天请假】"
    if is_leave_am:
        return "【上午请假】"
    if is_leave_pm:
        return "【下午请假】"
    return ""


# ============================================================
# 1. 动态表头读取花名册 (方案2 优选)
# ============================================================
def load_roster_dynamic(primary_path: Path, supplement_path: Path | None = None) -> dict[str, dict[str, Any]]:
    print(f"\n📋 [阶段 1/6] 动态解析加载花名册: {primary_path.name}")
    roster_map: dict[str, dict[str, Any]] = {}

    if xlrd is None:
        raise RuntimeError("需要 xlrd 库以读取 .xls 文件")
    if not primary_path.exists():
        raise FileNotFoundError(f"主花名册未找到: {primary_path}")

    b = xlrd.open_workbook(str(primary_path))
    sh_name = "数据" if "数据" in b.sheet_names() else b.sheet_names()[0]
    sh = b.sheet_by_name(sh_name)

    # 动态扫描定位表头所在行及对应列
    header_row_idx = None
    headers: list[str] = []
    for r in range(min(30, sh.nrows)):
        row_vals = [str(x).strip() for x in sh.row_values(r)]
        if "员工ID" in row_vals and "办公地点" in row_vals:
            header_row_idx = r
            headers = row_vals
            break

    if header_row_idx is None:
        raise ValueError("无法在主花名册中定位包含'员工ID'和'办公地点'的表头行")

    print(f"  ✓ 成功定位花名册表头位于第 {header_row_idx + 1} 行")

    def find_col(name: str, fallback_idx: int) -> int:
        for i, h in enumerate(headers):
            if name in h:
                return i
        return fallback_idx

    c_eid = find_col("员工ID", 7)
    c_name = find_col("员工姓名", 8)
    c_biz = find_col("业务类别", 0)
    c_d1 = find_col("1.1级部门", 1)
    c_d2 = find_col("二级部门", 2)
    c_d3 = find_col("三级部门", 3)
    c_d4 = find_col("四级部门", 4)
    c_d5 = find_col("五级部门", 5)
    c_off = find_col("办公地点", 31)
    c_att = find_col("考勤类型", 30)

    def get_cell_str(row: Any, idx: int) -> str:
        if idx < len(row):
            v = row[idx]
            if v is not None:
                s = str(v).strip()
                return "" if s in ("", "-", "None") else s
        return ""

    for r in range(header_row_idx + 1, sh.nrows):
        vals = sh.row_values(r)
        eid = norm_emp_id(vals[c_eid])
        if not eid:
            continue

        biz = get_cell_str(vals, c_biz)
        d1 = get_cell_str(vals, c_d1)
        d2 = get_cell_str(vals, c_d2)
        d3 = get_cell_str(vals, c_d3)
        d4 = get_cell_str(vals, c_d4)
        d5 = get_cell_str(vals, c_d5)

        # 部门拼接业务规则：
        # 1. 如果是游戏业务下且二级部门是游戏工作室群或者新业务事业群，则从三级部门拼接到五级部门
        # 2. 否则，如果1.1级部门和业务类别是相同的，则从二级部门拼接到四级部门
        # 3. 否则，从1.1级部门一直拼接到四级部门
        if biz == "游戏业务" and d2 in ["游戏工作室群", "新业务事业群"]:
            raw_chain = [d3, d4, d5]
        elif d1 == biz:
            raw_chain = [d2, d3, d4]
        else:
            raw_chain = [d1, d2, d3, d4]

        # 相邻同名去重与过滤空值
        dedup_chain = []
        for p in raw_chain:
            if p and (not dedup_chain or dedup_chain[-1] != p):
                dedup_chain.append(p)
        dept = ">".join(dedup_chain)

        off = get_cell_str(vals, c_off)
        name = get_cell_str(vals, c_name)
        att_type = get_cell_str(vals, c_att)

        roster_map[eid] = {
            "eid": eid,
            "name": name,
            "biz": biz,
            "dept": dept,
            "office": off,
            "att_type": att_type,
            "is_bj": is_bj_office(off),
            "source": "primary",
        }

    # 补充花名册 (若有)
    if supplement_path and supplement_path.exists():
        wb_sup = openpyxl.load_workbook(str(supplement_path), data_only=True)
        ws_sup = wb_sup["员工花名册"] if "员工花名册" in wb_sup.sheetnames else wb_sup.active
        if ws_sup is not None:
            for row in ws_sup.iter_rows(min_row=5, values_only=True):
                if not row or row[0] is None:
                    continue
                eid = norm_emp_id(row[0])
                if eid and eid not in roster_map:
                    name = str(row[1] or "").strip()
                    biz = str(row[2] or "").strip()
                    dept = str(row[3] or "").strip()
                    off = str(row[4] or "").strip() if len(row) > 4 else ""
                    att_type = str(row[5] or "").strip() if len(row) > 5 else ""
                    roster_map[eid] = {
                        "eid": eid,
                        "name": name,
                        "biz": biz,
                        "dept": dept,
                        "office": off,
                        "att_type": att_type,
                        "is_bj": is_bj_office(off),
                        "source": "supplement",
                    }
        wb_sup.close()

    # 注入用户确认的 5 位手工归属人员
    for eid, info in MANUAL_EMPLOYEES.items():
        roster_map[eid] = info
        print(f"  • 手工注入人员: {eid} {info['name']} -> {info['dept']}")

    print(f"  ✓ 成功加载花名册映射库，有效在册总数: {len(roster_map)} 人")
    return roster_map


# ============================================================
# 2. 考勤指标核算与日历自适应构建
# ============================================================
def calculate_attendance_engine(
    raw_xlsx: Path, rules_json: Path
) -> tuple[dict[str, Any], dict[tuple[str, str], Any], set[str], list[tuple[int, date, str]], set[int], int]:
    print(f"\n⚡ [阶段 2/6] 执行原生考勤工时与异常核算: {raw_xlsx.name}")

    try:
        with open(rules_json, encoding="utf-8") as f:
            rules: dict[str, float] = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise RuntimeError(f"加载规则库失败: {e}") from e

    wb_raw = openpyxl.load_workbook(str(raw_xlsx), data_only=True)
    ws_raw = wb_raw["Sheet0"] if "Sheet0" in wb_raw.sheetnames else wb_raw.active
    if ws_raw is None:
        wb_raw.close()
        raise RuntimeError("无法获取原始数据工作表")

    daily_map: dict[tuple[str, str], dict[str, Any]] = {}
    emp_meta: dict[str, dict[str, Any]] = {}
    all_raw_eids: set[str] = set()
    calendar_map: dict[str, bool] = {}

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

    # 动态构建 9 月日历布局
    dates_sorted = sorted(calendar_map.items(), key=lambda x: x[0])
    col_idx = 10
    workdays_config: list[tuple[int, date, str]] = []
    weekend_cols: set[int] = set()
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

    # 核算出勤天数与工时指标
    metrics_map: dict[str, dict[str, Any]] = {}
    missing_rule_pairs: dict[str, int] = {}

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
                if pair not in rules:
                    missing_rule_pairs[pair] = missing_rule_pairs.get(pair, 0) + 1
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
            if (
                rec["f_am"] == "已考勤补签"
                and t_d is not None
                and t_l is not None
                and t_e is not None
                and t_m is not None
                and (t_d - t_l) * 60.0 < -30.0
                and (t_m - t_e) * 60.0 < -30.0
            ):
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

    if missing_rule_pairs:
        print(f"  ⚠️ 警告: 发现 {len(missing_rule_pairs)} 种未收录的状态组合: {missing_rule_pairs}", file=sys.stderr)

    print(f"  ✓ 成功完成 {len(metrics_map)} 名员工的全月工时指标核算（共包含 {len(workdays_config)} 个工作日，{len(weekend_cols)} 个非工作日列）")
    return metrics_map, daily_map, all_raw_eids, workdays_config, weekend_cols, max_col_total


# ============================================================
# 3. 构建全量与分表工作簿
# ============================================================
def build_attendance_workbook(
    template_path: Path,
    roster_map: dict[str, dict[str, Any]],
    metrics_map: dict[str, dict[str, Any]],
    daily_map: dict[tuple[str, str], dict[str, Any]],
    all_raw_eids: set[str],
    workdays_config: list[tuple[int, date, str]],
    weekend_cols: set[int],
    max_col: int,
) -> tuple[openpyxl.Workbook, dict[str, int]]:
    print("\n🏗️  [阶段 3/6] 构建静态标准 Excel 工作簿...")

    wb = openpyxl.load_workbook(str(template_path))
    bj_assigned: dict[str, list[dict[str, Any]]] = {a: [] for a in AREA_ORDER}
    removed_non_bj = []
    removed_unmatched = []
    focus_id_set = {f[0] for f in FOCUS_LIST}

    # 1) 重点关注固定人员分配
    for fid, fname, fbiz in FOCUS_LIST:
        fid_norm = norm_emp_id(fid)
        if fid == "110641":
            # 业务明确确认: 110641 先空着数据，保留坑位
            bj_assigned["重点关注"].append({
                "eid": fid,
                "name": fname,
                "biz": fbiz,
                "dept": "",
                "att_type": "",
                "G_val": "-",
                "F_val": "-",
                "H_val": 0,
                "is_empty_slot": True,
            })
            continue

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
            "is_empty_slot": False,
        })

    # 2) 其他员工归属与过滤
    for eid in sorted(all_raw_eids):
        eid_norm = norm_emp_id(eid)
        if eid in focus_id_set or eid_norm in focus_id_set:
            continue
        if eid in EXCLUDED_EIDS or eid_norm in EXCLUDED_EIDS:
            removed_non_bj.append((eid, metrics_map.get(eid, {}).get("name", ""), "特殊名单排除(高管/指定)"))
            continue

        if eid_norm in roster_map:
            r_info = roster_map[eid_norm]
            biz = r_info["biz"]
            if biz in EXCLUDED_BIZS:
                removed_non_bj.append((eid, metrics_map.get(eid, {}).get("name", ""), f"{biz}(业务排除)"))
                continue

            if r_info["is_bj"]:
                target_area = r_info.get("target_area")
                if not target_area:
                    if biz in AREA_ORDER:
                        target_area = biz
                    elif biz in ["电竞与平台业务"]:
                        target_area = "游戏业务"
                    elif biz in ["体外业务(鲲鹏/通识)"]:
                        target_area = "集团职能"
                    else:
                        target_area = "集团职能"

                m = metrics_map.get(eid, {})
                bj_assigned[target_area].append({
                    "eid": eid,
                    "name": m.get("name") or r_info.get("name", ""),
                    "biz": biz,
                    "dept": r_info["dept"],
                    "att_type": m.get("att_type") or r_info.get("att_type", ""),
                    "G_val": m.get("G_val", "-"),
                    "F_val": m.get("H_val", "-"),
                    "H_val": m.get("compensate", 0),
                    "is_empty_slot": False,
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
    # 第 7 行 (D 考勤状态行) 的基础样式与行高
    styles_d = []
    for c in range(1, 10):
        cell = ws_full.cell(7 + 5, c)
        styles_d.append({
            "font": Font(name="微软雅黑", size=9.0, bold=False, color="FF000000"),
            "alignment": Alignment(horizontal="left" if c == 9 else "center", vertical="center"),
            "border": copy(cell.border),
            "fill": copy(cell.fill),
        })
    base_col_styles.append({
        "cells": styles_d,
        "height": ws_full.row_dimensions[7 + 5].height,
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
        set_cell(ws_full, 4, col_idx, w_name)
        c4.font = FONT_WEEKDAY
        c4.alignment = Alignment(horizontal="center", vertical="center")
        c5 = ws_full.cell(5, col_idx)
        set_cell(ws_full, 5, col_idx, date(dt.year, dt.month, dt.day))
        c5.font = FONT_DATE
        c5.number_format = "m/d;@"
        c5.alignment = Alignment(horizontal="center", vertical="center")
        ws_full.column_dimensions[get_column_letter(col_idx)].width = 11.17

    # 动态写入周末/假期列表头
    for col_idx in weekend_cols:
        for r in range(1, 3):
            ws_full.cell(r, col_idx).fill = FILL_NONE
            ws_full.cell(r, col_idx).border = Border()
        set_cell(ws_full, 3, col_idx, None)
        ws_full.cell(3, col_idx).fill = FILL_WEEKEND_LIGHT
        ws_full.cell(3, col_idx).border = Border()

        c4 = ws_full.cell(4, col_idx)
        set_cell(ws_full, 4, col_idx, "周末/假期")
        c4.font = FONT_WEEKEND_HEADER
        c4.fill = FILL_WEEKEND_LIGHT
        c4.alignment = Alignment(horizontal="center", vertical="center")
        c4.border = Border()

        c5 = ws_full.cell(5, col_idx)
        set_cell(ws_full, 5, col_idx, None)
        c5.fill = FILL_WEEKEND_LIGHT
        c5.border = Border()

        ws_full.merge_cells(start_row=4, end_row=5, start_column=col_idx, end_column=col_idx)
        ws_full.column_dimensions[get_column_letter(col_idx)].width = 9.17

    apply_rich_text_legends(ws_full)

    # 写入全量表数据
    cursor = 6
    section_ranges: dict[str, tuple[int, int]] = {}

    for area in AREA_ORDER:
        emps = bj_assigned[area]
        if not emps:
            continue

        ws_full.row_dimensions[cursor].height = r6_snap["height"]
        set_cell(ws_full, cursor, 1, area)
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
            is_empty_slot = emp.get("is_empty_slot", False)

            for off in range(7):
                row_num = cursor + off
                ws_full.row_dimensions[row_num].height = base_col_styles[off]["height"]
                b_side = None
                if off in [1, 3, 5]:
                    b_side = BORDER_THIN_GRAY
                elif off == 6:
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
                        bottom=b_side if off in [1, 3, 5, 6] else None,
                    )
                    cell.border = b

                for col_idx in range(10, max_col + 1):
                    cell = ws_full.cell(row_num, col_idx)
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                    if col_idx in weekend_cols:
                        cell.border = Border(left=None, right=None, top=None, bottom=b_side if off == 6 else None)
                        cell.fill = FILL_WEEKEND_LIGHT
                    elif col_idx == max_col:
                        cell.border = Border(left=None, right=BORDER_MEDIUM_BLACK, top=None, bottom=b_side)
                        cell.fill = FILL_NONE
                    else:
                        cell.border = Border(left=None, right=None, top=None, bottom=b_side)
                        cell.fill = FILL_NONE

            # 基础信息
            set_cell(ws_full, cursor, 1, emp["eid"])
            set_cell(ws_full, cursor, 2, emp["name"])
            set_cell(ws_full, cursor, 3, emp["biz"])
            set_cell(ws_full, cursor, 4, emp["att_type"])
            set_cell(ws_full, cursor, 5, emp["dept"])

            f_disp = emp["F_val"]
            if f_disp != "-" and isinstance(f_disp, (int, float)):
                f_disp = round(float(f_disp), 2)
                ws_full.cell(cursor, 6).number_format = "0.00"

            g_disp = emp["G_val"]
            if g_disp != "-" and isinstance(g_disp, (int, float)):
                g_disp = round(float(g_disp), 2)
                ws_full.cell(cursor, 7).number_format = "0.00"

            set_cell(ws_full, cursor, 6, f_disp)
            set_cell(ws_full, cursor, 7, g_disp)

            # G - F > 0.5 标红预警
            is_g_red = False
            if f_disp != "-" and g_disp != "-":
                try:
                    if (float(g_disp) - float(f_disp)) > 0.5:
                        is_g_red = True
                except (ValueError, TypeError):
                    pass

            g_font = FONT_IN_OUT_RED if is_g_red else FONT_IN_OUT_BLACK
            for r_off in range(7):
                ws_full.cell(cursor + r_off, 7).font = copy(g_font)

            set_cell(ws_full, cursor, 8, emp["H_val"])
            set_cell(ws_full, cursor, 9, "A（签到/签退）")
            set_cell(ws_full, cursor + 2, 9, "B（人脸）")
            set_cell(ws_full, cursor + 4, 9, "C（因公外出）")
            set_cell(ws_full, cursor + 6, 9, "D（考勤状态）")
            ws_full.cell(cursor + 6, 9).alignment = Alignment(horizontal="left", vertical="center")

            # 每日打卡明细 (如果是空坑位如 110641，则填空)
            for col_idx, dt, _ in workdays_config:
                if is_empty_slot:
                    c_in = ws_full.cell(cursor, col_idx)
                    set_cell(ws_full, cursor, col_idx, "--:--")
                    c_in.font = FONT_IN_OUT_GRAY

                    c_out = ws_full.cell(cursor + 1, col_idx)
                    set_cell(ws_full, cursor + 1, col_idx, "--:--")
                    c_out.font = FONT_IN_OUT_GRAY

                    c_fe = ws_full.cell(cursor + 2, col_idx)
                    set_cell(ws_full, cursor + 2, col_idx, "--:--")
                    c_fe.font = FONT_FACE

                    c_fl = ws_full.cell(cursor + 3, col_idx)
                    set_cell(ws_full, cursor + 3, col_idx, "--:--")
                    c_fl.font = FONT_FACE

                    c_vo = ws_full.cell(cursor + 4, col_idx)
                    set_cell(ws_full, cursor + 4, col_idx, "--:--")
                    c_vo.font = FONT_OUTING

                    c_ve = ws_full.cell(cursor + 5, col_idx)
                    set_cell(ws_full, cursor + 5, col_idx, "--:--")
                    c_ve.font = FONT_OUTING

                    c_d = ws_full.cell(cursor + 6, col_idx)
                    set_cell(ws_full, cursor + 6, col_idx, "")
                    c_d.fill = FILL_NONE
                    c_d.font = FONT_IN_OUT_BLACK
                    continue

                dt_str = f"{dt.year:04d}-{dt.month:02d}-{dt.day:02d}"
                d_rec = daily_map.get((eid, dt_str), {})

                face_early_str = format_time_str(d_rec.get("l_early"))
                face_late_str = format_time_str(d_rec.get("m_late"), is_out=True)

                din_str = format_time_str(d_rec.get("d_in"))
                c_in = ws_full.cell(cursor, col_idx)
                set_cell(ws_full, cursor, col_idx, din_str)
                c_in.font = determine_in_out_font(din_str, face_early_str)

                eout_str = format_time_str(d_rec.get("e_out"), is_out=True)
                c_out = ws_full.cell(cursor + 1, col_idx)
                set_cell(ws_full, cursor + 1, col_idx, eout_str)
                c_out.font = determine_in_out_font(eout_str, face_late_str, is_out=True)

                c_fe = ws_full.cell(cursor + 2, col_idx)
                set_cell(ws_full, cursor + 2, col_idx, face_early_str)
                c_fe.font = FONT_FACE

                c_fl = ws_full.cell(cursor + 3, col_idx)
                set_cell(ws_full, cursor + 3, col_idx, face_late_str)
                c_fl.font = FONT_FACE

                c_vo = ws_full.cell(cursor + 4, col_idx)
                set_cell(ws_full, cursor + 4, col_idx, format_time_str(d_rec.get("v_in")))
                c_vo.font = FONT_OUTING

                c_ve = ws_full.cell(cursor + 5, col_idx)
                set_cell(ws_full, cursor + 5, col_idx, format_time_str(d_rec.get("w_out"), is_out=True))
                c_ve.font = FONT_OUTING

                c_d = ws_full.cell(cursor + 6, col_idx)
                status_text = get_attendance_status(d_rec.get("f_am", ""), d_rec.get("g_pm", ""))
                set_cell(ws_full, cursor + 6, col_idx, status_text)
                c_d.fill = FILL_NONE
                if status_text == "[出差]":
                    c_d.font = FONT_STATUS_TRAVEL
                elif status_text == "【全天请假】":
                    c_d.font = FONT_STATUS_LEAVE_FULL
                elif status_text in ["【上午请假】", "【下午请假】"]:
                    c_d.font = FONT_STATUS_LEAVE_HALF
                else:
                    c_d.font = FONT_IN_OUT_BLACK

                fam = str(d_rec.get("f_am", "")).strip()
                gpm = str(d_rec.get("g_pm", "")).strip()
                if fam == "已考勤补签" or (eid, dt_str, "in") in CONFIRMED_YELLOW_HIGHLIGHTS:
                    c_in.fill = FILL_HIGHLIGHT_YELLOW
                if gpm == "已考勤补签" or (eid, dt_str, "out") in CONFIRMED_YELLOW_HIGHLIGHTS:
                    c_out.fill = FILL_HIGHLIGHT_YELLOW

            for c in range(1, 9):
                ws_full.merge_cells(start_row=cursor, end_row=cursor + 6, start_column=c, end_column=c)
            ws_full.merge_cells(start_row=cursor, end_row=cursor + 1, start_column=9, end_column=9)
            ws_full.merge_cells(start_row=cursor + 2, end_row=cursor + 3, start_column=9, end_column=9)
            ws_full.merge_cells(start_row=cursor + 4, end_row=cursor + 5, start_column=9, end_column=9)

            cursor += 7

        section_ranges[area] = (start_row, cursor - 1)

    # 复制到 7 个业务分表
    def copy_rows(src_ws, dst_ws, start_r, end_r, target_start):
        for offset in range(end_r - start_r + 1):
            s_row = start_r + offset
            d_row = target_start + offset
            dst_ws.row_dimensions[d_row].height = src_ws.row_dimensions[s_row].height
            for c in range(1, max_col + 1):
                s_cell = src_ws.cell(s_row, c)
                d_cell = dst_ws.cell(d_row, c)
                d_cell.value = s_cell.value
                d_cell.font = copy(s_cell.font)
                d_cell.fill = copy(s_cell.fill)
                d_cell.border = copy(s_cell.border)
                d_cell.alignment = copy(s_cell.alignment)
                d_cell.number_format = s_cell.number_format

        for m in src_ws.merged_cells.ranges:
            if m.min_row >= start_r and m.max_row <= end_r:
                top_off = m.min_row - start_r
                bot_off = m.max_row - start_r
                dst_ws.merge_cells(
                    start_row=target_start + top_off,
                    end_row=target_start + bot_off,
                    start_column=m.min_col,
                    end_column=m.max_col,
                )

    for area in AREA_ORDER:
        if area not in wb.sheetnames:
            continue
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
            set_cell(ws_biz, 4, col_idx, w_name)
            c4.font = FONT_WEEKDAY
            c4.alignment = Alignment(horizontal="center", vertical="center")
            c5 = ws_biz.cell(5, col_idx)
            set_cell(ws_biz, 5, col_idx, date(dt.year, dt.month, dt.day))
            c5.font = FONT_DATE
            c5.number_format = "m/d;@"
            c5.alignment = Alignment(horizontal="center", vertical="center")
            ws_biz.column_dimensions[get_column_letter(col_idx)].width = 11.17

        for col_idx in weekend_cols:
            for r in range(1, 3):
                ws_biz.cell(r, col_idx).fill = FILL_NONE
                ws_biz.cell(r, col_idx).border = Border()
            set_cell(ws_biz, 3, col_idx, None)
            ws_biz.cell(3, col_idx).fill = FILL_WEEKEND_LIGHT
            c4 = ws_biz.cell(4, col_idx)
            set_cell(ws_biz, 4, col_idx, "周末/假期")
            c4.font = FONT_WEEKEND_HEADER
            c4.fill = FILL_WEEKEND_LIGHT
            c4.alignment = Alignment(horizontal="center", vertical="center")
            c5 = ws_biz.cell(5, col_idx)
            set_cell(ws_biz, 5, col_idx, None)
            c5.fill = FILL_WEEKEND_LIGHT
            c5.border = Border()
            ws_biz.merge_cells(start_row=4, end_row=5, start_column=col_idx, end_column=col_idx)
            ws_biz.column_dimensions[get_column_letter(col_idx)].width = 9.17

        # 写入第 6 行区域大标题
        ws_biz.row_dimensions[6].height = r6_snap["height"]
        set_cell(ws_biz, 6, 1, area)
        ws_biz.cell(6, 1).font = copy(r6_snap["font"])
        ws_biz.cell(6, 1).fill = copy(r6_snap["fill"])
        ws_biz.cell(6, 1).alignment = copy(r6_snap["alignment"])
        ws_biz.cell(6, 1).border = copy(r6_snap["border"])
        for c in range(2, max_col + 1):
            ws_biz.cell(6, c).border = Border(bottom=BORDER_MEDIUM_BLACK)
            ws_biz.cell(6, c).fill = copy(r6_snap["fill"])
        ws_biz.merge_cells(start_row=6, end_row=6, start_column=1, end_column=max_col)

        if area in section_ranges:
            sr, er = section_ranges[area]
            copy_rows(ws_full, ws_biz, sr, er, 7)
        apply_rich_text_legends(ws_biz)

    # 规范 Tab 顺序
    ordered_sheets = []
    current_sheets = {s.title: s for s in wb.worksheets}
    for name in TARGET_SHEET_ORDER:
        if name in current_sheets:
            ordered_sheets.append(current_sheets[name])
    wb._sheets = ordered_sheets  # type: ignore

    # 规范冻结窗格与视图比例 (全量 J6, 分表 J7)
    for ws_each in wb.worksheets:
        ws_each.sheet_view.zoomScale = 100
        ws_each.sheet_view.zoomScaleNormal = 100
        for sv in ws_each.views.sheetView:
            sv.zoomScale = 100
            sv.zoomScaleNormal = 100
            sv.topLeftCell = "A1"
            if sv.selection:
                for sel in sv.selection:
                    sel.activeCell = "A5"
                    sel.sqref = "A5"
            else:
                sv.selection = [Selection(activeCell="A5", sqref="A5")]

        active_c = "J6" if ws_each.title == "全量" else "J7"
        ws_each.freeze_panes = active_c
        for sv in ws_each.views.sheetView:
            sv.zoomScale = 100
            sv.zoomScaleNormal = 100
            sv.topLeftCell = "A1"
            sv.selection = [Selection(activeCell=active_c, sqref=active_c)]

        ws_each.conditional_formatting = ConditionalFormattingList()

    sheet_counts = {a: len(bj_assigned[a]) for a in AREA_ORDER}
    return wb, sheet_counts


# ============================================================
# 4. 安全分页与高质量 PDF 导出
# ============================================================
def export_pdf_applescript(src_xlsx: Path, sheet_name: str, target_pdf: Path, max_col: int) -> None:
    wb = openpyxl.load_workbook(str(src_xlsx), rich_text=True)
    for name in list(wb.sheetnames):
        if name != sheet_name:
            del wb[name]
    ws = wb[sheet_name]

    last_row = ws.max_row
    end_col_letter = get_column_letter(max_col)

    ws.print_title_rows = "1:5"
    ws.print_area = f"A1:{end_col_letter}{last_row}"
    ps = ws.page_setup
    pm = ws.page_margins
    ps.orientation = "landscape"
    ps.paperSize = 1  # Letter
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
    target_pages = max(1, math.ceil((last_row - 5) / 105))
    current_start = 6
    for page_index in range(1, target_pages):
        remaining_pages = target_pages - page_index + 1
        target_row = current_start + math.ceil((last_row - current_start + 1) / remaining_pages)
        candidates = [r for r in range(current_start + 1, min(target_row, last_row) + 1)
                      if ws.cell(r, 1).value is not None]
        if not candidates:
            break
        next_start = candidates[-1]
        ws.row_breaks.append(Break(id=next_start - 1))
        current_start = next_start

    temp_xlsx = src_xlsx.parent / "_pdf_temp_input.xlsx"
    temp_pdf = src_xlsx.parent / "_pdf_temp_output.pdf"

    for p in [temp_xlsx, temp_pdf]:
        if p.exists():
            with contextlib.suppress(OSError):
                p.unlink()

    wb.save(str(temp_xlsx))
    wb.close()

    x_str = str(temp_xlsx.resolve())
    p_str = str(temp_pdf.resolve())

    applescript = f'''
tell application "Microsoft Excel"
    set display alerts to false
    open POSIX file "{x_str}"
    delay 0.8
    set wb to active workbook
    save workbook as wb filename "{p_str}" file format PDF file format
    delay 0.8
    close wb saving no
    delay 0.3
end tell
'''
    res = subprocess.run(["osascript"], input=applescript, capture_output=True, text=True, timeout=120)
    if temp_xlsx.exists():
        with contextlib.suppress(OSError):
            temp_xlsx.unlink()

    if res.returncode != 0 or not temp_pdf.exists():
        raise RuntimeError(f"PDF 导出失败 ({sheet_name}): {res.stderr.strip()}")

    if target_pdf.exists():
        with contextlib.suppress(OSError):
            target_pdf.unlink()

    try:
        shutil.move(str(temp_pdf), str(target_pdf))
    except OSError as e:
        raise RuntimeError(f"移动 PDF 失败: {e}") from e

    print(f"  ✓ PDF 导出成功: {target_pdf.name} ({target_pdf.stat().st_size / 1024:.1f} KB)")


# ============================================================
# 主执行入口
# ============================================================
def main():
    print("=" * 70)
    print("【2026年09月 考勤月报端到端全自动交付】启动")
    print("=" * 70)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. 读取花名册 (动态表头自适应)
    roster_map = load_roster_dynamic(PRIMARY_ROSTER_FILE, SUPPLEMENT_ROSTER_FILE)

    # 2. 原生考勤核算
    metrics_map, daily_map, all_raw_eids, workdays_config, weekend_cols, max_col = calculate_attendance_engine(
        SRC_DATA_FILE, RULES_FILE
    )

    # 3. 构建 Excel
    wb, counts = build_attendance_workbook(
        TEMPLATE_FILE,
        roster_map,
        metrics_map,
        daily_map,
        all_raw_eids,
        workdays_config,
        weekend_cols,
        max_col,
    )

    # 4. 保存唯一 Excel 文件 (不生成“最新”后缀)
    excel_filename = "考勤数据+排名-2026年0901-0930- v1.0.xlsx"
    out_excel = OUTPUT_DIR / excel_filename
    wb.save(out_excel)
    wb.close()
    print(f"\n💾 [阶段 4/6] 交付 Excel 已生成: {out_excel.name} ({out_excel.stat().st_size / 1024:.1f} KB)")

    # 5. 导出双 PDF
    pdf_full = OUTPUT_DIR / "全量_考勤数据+排名-2026年0901-0930- v1.0.pdf"
    pdf_focus = OUTPUT_DIR / "重点关注_考勤数据+排名-2026年0901-0930- v1.0.pdf"

    if sys.platform == "darwin":
        print("\n📄 [阶段 5/6] 导出全量与重点关注 PDF...")
        export_pdf_applescript(out_excel, "全量", pdf_full, max_col)
        export_pdf_applescript(out_excel, "重点关注", pdf_focus, max_col)

    print("\n🎉 [阶段 6/6] 2026年09月 考勤月报交付全部顺利完成！")
    print(f"  • Excel: {out_excel}")
    print(f"  • 全量 PDF: {pdf_full}")
    print(f"  • 重点关注 PDF: {pdf_focus}")
    print("\n各业务分表人员统计:")
    for a in AREA_ORDER:
        print(f"  - {a}: {counts.get(a, 0)} 人")
    print(f"  - 全量总计: {sum(counts.values())} 人")


if __name__ == "__main__":
    main()
