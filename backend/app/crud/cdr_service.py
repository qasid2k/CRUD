"""
CDR (Call Detail Records) Aggregation Service
----------------------------------------------
Queries the Asterisk queue_log table and aggregates call data into:
  - Per-agent, per-date, per-hour heatmaps (call minutes)
  - Summary statistics (total calls, duration, status breakdown)
  - Hourly call volume distribution

Uses in-memory caching with a configurable TTL to avoid hitting the DB on every request.
"""

from __future__ import annotations

import time
import re
from collections import defaultdict
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional

from sqlmodel import Session, text

from ..database import engine


# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------
_cache: Dict[str, Any] = {}
_cache_ts: float = 0.0
CACHE_TTL_SECONDS = 300  # 5 minutes – keeps data fresh without hammering DB


def _is_cache_valid() -> bool:
    return bool(_cache) and (time.time() - _cache_ts < CACHE_TTL_SECONDS)


def invalidate_cache():
    """Force the next request to re-query the database."""
    global _cache, _cache_ts
    _cache = {}
    _cache_ts = 0.0


# ---------------------------------------------------------------------------
# Helper: extract extension number from agent string
# ---------------------------------------------------------------------------
def _ext_from_agent(agent: str) -> str:
    """Turn 'PJSIP/102' or 'pjsip/102' into '102'."""
    digits = re.findall(r"\d+", agent or "")
    return digits[0] if digits else agent or "Unknown"


# ---------------------------------------------------------------------------
# Core aggregation – runs a single SQL query, processes in Python
# ---------------------------------------------------------------------------
def _aggregate(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    agent_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Query queue_log and build aggregation structures.

    queue_log events of interest:
      - CONNECT        : call was answered (data1 = hold time in seconds)
      - COMPLETEAGENT  : agent hung up  (data1 = hold sec, data2 = talk sec)
      - COMPLETECALLER : caller hung up (data1 = hold sec, data2 = talk sec)
      - ABANDON        : caller abandoned before answer
      - ENTERQUEUE     : caller entered the queue
      - RINGNOANSWER   : agent phone rang but no answer
    """

    # Build the WHERE clause
    conditions = ["1=1"]
    params: Dict[str, Any] = {}

    if start_date:
        conditions.append("time >= :start")
        params["start"] = start_date
    if end_date:
        # Include the full end day
        conditions.append("time < DATE_ADD(:end, INTERVAL 1 DAY)")
        params["end"] = end_date
    if agent_filter:
        conditions.append("(agent LIKE :agent_pattern)")
        params["agent_pattern"] = f"%{agent_filter}%"

    where = " AND ".join(conditions)

    query = text(f"""
        SELECT time, callid, queuename, agent, event,
               data1, data2, data3, data4, data5
        FROM queue_log
        WHERE {where}
        ORDER BY time ASC
    """)

    rows: list = []
    try:
        with Session(engine) as session:
            result = session.execute(query, params)
            rows = result.fetchall()
    except Exception as e:
        print(f"CDR aggregation DB error: {e}")
        return _empty_result()

    # -----------------------------------------------------------------------
    # Process rows into structures
    # -----------------------------------------------------------------------

    # heatmap[agent_ext][date_str][hour] = total_minutes (float)
    heatmap: Dict[str, Dict[str, Dict[int, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )

    # agent_stats[agent_ext] = { total_calls, total_duration, answered, abandoned, ... }
    agent_stats: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "total_calls": 0,
            "total_duration_sec": 0,
            "answered": 0,
            "abandoned": 0,
            "no_answer": 0,
            "busy": 0,
            "failed": 0,
        }
    )

    # hourly_volume[hour] = count of events (CONNECT / COMPLETEAGENT / COMPLETECALLER)
    hourly_volume: Dict[int, int] = defaultdict(int)

    # all dates seen (for building complete date axis)
    all_dates: set = set()
    all_agents: set = set()

    for row in rows:
        ts_str = str(row[0])  # time
        event = str(row[4] or "").upper()
        agent_raw = str(row[3] or "")
        data1 = str(row[5] or "")
        data2 = str(row[6] or "")

        # Skip system-level events with no agent
        if agent_raw.upper() in ("NONE", ""):
            # But count ABANDON events even with NONE agent
            if event == "ABANDON":
                pass  # we'll attribute to queue rather than agent
            else:
                continue

        ext = _ext_from_agent(agent_raw)

        # Parse timestamp
        try:
            if "." in ts_str:
                dt = datetime.strptime(ts_str[:19], "%Y-%m-%d %H:%M:%S")
            else:
                dt = datetime.strptime(ts_str[:19], "%Y-%m-%d %H:%M:%S")
        except (ValueError, IndexError):
            continue

        date_str = dt.strftime("%Y-%m-%d")
        hour = dt.hour
        all_dates.add(date_str)

        if ext and ext != "Unknown":
            all_agents.add(ext)

        # ---- Handle specific events ----
        if event in ("COMPLETEAGENT", "COMPLETECALLER"):
            # data2 = talk time in seconds
            try:
                talk_sec = int(data2)
            except (ValueError, TypeError):
                talk_sec = 0

            talk_min = talk_sec / 60.0
            heatmap[ext][date_str][hour] += talk_min
            agent_stats[ext]["total_calls"] += 1
            agent_stats[ext]["total_duration_sec"] += talk_sec
            agent_stats[ext]["answered"] += 1
            hourly_volume[hour] += 1

        elif event == "CONNECT":
            # A connect event (call answered) – we count it for hourly volume
            hourly_volume[hour] += 1

        elif event == "ABANDON":
            # Caller abandoned
            if ext and ext != "Unknown":
                agent_stats[ext]["abandoned"] += 1
            # Count in hourly volume too
            hourly_volume[hour] += 1

        elif event == "RINGNOANSWER":
            if ext and ext != "Unknown":
                agent_stats[ext]["no_answer"] += 1

        elif event in ("BUSY",):
            if ext and ext != "Unknown":
                agent_stats[ext]["busy"] += 1

    # -----------------------------------------------------------------------
    # Build sorted output
    # -----------------------------------------------------------------------
    sorted_dates = sorted(all_dates)
    sorted_agents = sorted(all_agents)

    # Build heatmap data: list of {agent, date, hours: {0..23: minutes}, total_minutes}
    heatmap_data = []
    for agent_ext in sorted_agents:
        for d in sorted_dates:
            hours_data = {}
            total_min = 0.0
            for h in range(24):
                val = round(heatmap[agent_ext][d][h], 1)
                hours_data[str(h)] = val
                total_min += val
            heatmap_data.append({
                "agent": agent_ext,
                "date": d,
                "hours": hours_data,
                "total_minutes": round(total_min, 1),
            })

    # Agent summary list
    agent_summary = []
    for ext in sorted_agents:
        s = agent_stats[ext]
        agent_summary.append({
            "agent": ext,
            "total_calls": s["total_calls"],
            "total_duration_sec": s["total_duration_sec"],
            "total_duration_min": round(s["total_duration_sec"] / 60.0, 1),
            "answered": s["answered"],
            "abandoned": s["abandoned"],
            "no_answer": s["no_answer"],
            "busy": s["busy"],
            "failed": s["failed"],
        })

    # Hourly volume list (0..23)
    hourly_data = [{"hour": h, "calls": hourly_volume.get(h, 0)} for h in range(24)]

    return {
        "agents": sorted_agents,
        "dates": sorted_dates,
        "heatmap": heatmap_data,
        "agent_summary": agent_summary,
        "hourly_volume": hourly_data,
        "total_records": len(rows),
        "generated_at": datetime.now().isoformat(),
    }


def _empty_result() -> Dict[str, Any]:
    return {
        "agents": [],
        "dates": [],
        "heatmap": [],
        "agent_summary": [],
        "hourly_volume": [{"hour": h, "calls": 0} for h in range(24)],
        "total_records": 0,
        "generated_at": datetime.now().isoformat(),
    }


# ---------------------------------------------------------------------------
# Public API (used by routes)
# ---------------------------------------------------------------------------
def get_cdr_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Return aggregated CDR data, using cache when available."""
    cache_key = f"summary:{start_date}:{end_date}"

    if _is_cache_valid() and cache_key in _cache:
        return _cache[cache_key]

    global _cache_ts
    data = _aggregate(start_date=start_date, end_date=end_date)
    _cache[cache_key] = data
    _cache_ts = time.time()
    return data


def get_agent_report(
    agent_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Return CDR data filtered for a specific agent."""
    return _aggregate(
        start_date=start_date,
        end_date=end_date,
        agent_filter=agent_id,
    )


def get_time_range_report(start_date: str, end_date: str) -> Dict[str, Any]:
    """Return CDR data for a specific date range."""
    return get_cdr_summary(start_date=start_date, end_date=end_date)


def refresh_aggregation():
    """Called by the scheduler to pre-warm the cache."""
    invalidate_cache()
    # Pre-warm with last 30 days
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=30)).isoformat()
    get_cdr_summary(start_date=start, end_date=end)
    print(f"[CDR] Cache refreshed at {datetime.now().isoformat()}")
