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
from .queue_status import queue_manager


# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------
_cache: Dict[str, Any] = {}
_cache_ts: float = 0.0
CACHE_TTL_SECONDS = 10  # Reduced for more responsive "dynamic" updates


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
async def _aggregate(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    agent_filter: Optional[str] = None,
    queue_filter: Optional[str] = None,
    all_time: bool = False,
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

    effective_start = start_date
    effective_end = end_date

    # No default "This Week" filter anymore, if not provided it fetches all time
    # (Unbounded start/end)

    if effective_start:
        conditions.append("time >= :start")
        params["start"] = effective_start
    if effective_end:
        # Include the full end day
        conditions.append("time < DATE_ADD(:end, INTERVAL 1 DAY)")
        params["end"] = effective_end
    if agent_filter:
        conditions.append("(agent LIKE :agent_pattern)")
        params["agent_pattern"] = f"%{agent_filter}%"
    if queue_filter:
        conditions.append("(queuename = :queue)")
        params["queue"] = queue_filter

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

    # Initialize with all configured agents or just queue members
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
    # Sets to track discovered entities (Agents, Dates, Queues)
    all_agents: set = set()
    all_dates: set = set()
    all_queues: set = set()
    
    # Map for agent ID -> Name from AMI
    agent_names: Dict[str, str] = {}

    # --- Get base list of agents and queues from AMI ---
    # We do NOT filter this by agent_id, because we want the full list for dropdowns
    try:
        ami_queues = await queue_manager.get_queue_status()
        for q in ami_queues:
            all_queues.add(q["name"])
            
            # Filter agents based on the selected queue
            if not queue_filter:
                # If no queue filter, collect all agents from all queues
                for member in q["members"]:
                    ext = member["number"]
                    if ext and ext not in ("Unknown", "???"):
                        all_agents.add(ext)
                        agent_names[ext] = member["name"]
                        _ = agent_stats[ext]
            elif q["name"] == queue_filter:
                # If a specific queue is selected, ONLY collect agents from that queue
                for member in q["members"]:
                    ext = member["number"]
                    if ext and ext not in ("Unknown", "???"):
                        all_agents.add(ext)
                        agent_names[ext] = member["name"]
                        _ = agent_stats[ext]

    except Exception as e:
        print(f"Error fetching agents/queues from AMI: {e}")

    # --- DISCOVER HISTORICAL/LOGGED OUT AGENTS FROM DB ---
    # This ensures those who aren't in AMI still show in the list
    try:
        with Session(engine) as session:
            # 1. Get from queue_members table (static/dynamic logged in members)
            mq = "SELECT interface, queue_name FROM queue_members"
            mp = {}
            if queue_filter:
                mq += " WHERE queue_name = :q"
                mp = {"q": queue_filter}
            
            res_m = session.execute(text(mq), mp)
            for row in res_m:
                ext = _ext_from_agent(str(row[0]))
                if ext and ext not in ("Unknown", "???"):
                    all_agents.add(ext)
                    _ = agent_stats[ext]
                    if row[1]: all_queues.add(str(row[1]))

            # 2. Get from queue_log table (those who had activity but might be logged out/deleted)
            lq = "SELECT DISTINCT agent, queuename FROM queue_log WHERE agent NOT IN ('NONE', '')"
            lp = {}
            if queue_filter:
                lq += " AND queuename = :q"
                lp = {"q": queue_filter}
            
            res_l = session.execute(text(lq), lp)
            for row in res_l:
                ext = _ext_from_agent(str(row[0]))
                if ext and ext not in ("Unknown", "???"):
                    all_agents.add(ext)
                    _ = agent_stats[ext]
                    if row[1]: all_queues.add(str(row[1]))

            # 3. Pull names from ps_endpoints for all discovered agents without names
            missing_names = [a for a in all_agents if a not in agent_names]
            if missing_names:
                res_n = session.execute(
                    text("SELECT id, callerid FROM ps_endpoints WHERE id IN :ids"),
                    {"ids": tuple(missing_names)}
                )
                for row in res_n:
                    if row[1]: agent_names[row[0]] = str(row[1])

    except Exception as e:
        print(f"Error discovering historical agents from DB: {e}")

    # hourly_volume[hour] = count of events (CONNECT / COMPLETEAGENT / COMPLETECALLER)
    hourly_volume: Dict[int, int] = defaultdict(int)

    # Note: all_dates and all_queues are initialized at the top 
    # to preserve data from the discovery phase.

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
            dt = datetime.strptime(ts_str[:19], "%Y-%m-%d %H:%M:%S")
        except (ValueError, IndexError):
            continue

        date_str = dt.strftime("%Y-%m-%d")
        hour = dt.hour
        all_dates.add(date_str)
        if row[2]: # queuename
            all_queues.add(str(row[2]))

        if ext and ext != "Unknown":
            all_agents.add(ext)
            # Ensure stats entry exists
            if ext not in agent_stats:
                agent_stats[ext] = {
                    "total_calls": 0,
                    "total_duration_sec": 0,
                    "answered": 0,
                    "abandoned": 0,
                    "no_answer": 0,
                    "busy": 0,
                    "failed": 0,
                }

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
                agent_stats[ext]["total_calls"] += 1
                agent_stats[ext]["abandoned"] += 1
            # Count in hourly volume too
            hourly_volume[hour] += 1

        elif event == "RINGNOANSWER":
            if ext and ext != "Unknown":
                agent_stats[ext]["total_calls"] += 1
                agent_stats[ext]["no_answer"] += 1

        elif event in ("BUSY",):
            if ext and ext != "Unknown":
                agent_stats[ext]["total_calls"] += 1
                agent_stats[ext]["busy"] += 1

    # -----------------------------------------------------------------------
    # Build sorted output (Fill in missing dates to ensure a continuous timeline)
    # -----------------------------------------------------------------------
    if not all_dates and not (start_date and end_date):
        # Even if no data, we might want to return the shell for "This Week"
        pass 

    # Determine the date window to display
    if all_time:
        range_start = min(all_dates or [date.today().isoformat()])
        range_end = max(all_dates or [date.today().isoformat()])
    else:
        # Use whatever was applied to the SQL query (defaults to This Week)
        range_start = effective_start if effective_start else min(all_dates or [date.today().isoformat()])
        range_end = effective_end if effective_end else max(all_dates or [date.today().isoformat()])

    try:
        start_dt = date.fromisoformat(range_start)
        end_dt = date.fromisoformat(range_end)
    except Exception:
        start_dt = date.today()
        end_dt = date.today()

    sorted_dates = []
    curr = start_dt
    while curr <= end_dt:
        sorted_dates.append(curr.isoformat())
        curr += timedelta(days=1)

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
        "agent_names": agent_names,
        "queues": sorted(all_queues),
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
        "agent_names": {},
        "queues": [],
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
async def get_cdr_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    queue: Optional[str] = None,
    all_time: bool = False,
) -> Dict[str, Any]:
    """Return aggregated CDR data, using cache when available."""
    cache_key = f"summary:{start_date}:{end_date}:{queue}:{all_time}"

    if _is_cache_valid() and cache_key in _cache:
        return _cache[cache_key]

    global _cache_ts
    data = await _aggregate(start_date=start_date, end_date=end_date, queue_filter=queue, all_time=all_time)
    _cache[cache_key] = data
    _cache_ts = time.time()
    return data


async def get_agent_report(
    agent_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    queue: Optional[str] = None,
    all_time: bool = False,
) -> Dict[str, Any]:
    """Return CDR data filtered for a specific agent."""
    return await _aggregate(
        start_date=start_date,
        end_date=end_date,
        agent_filter=agent_id,
        queue_filter=queue,
        all_time=all_time,
    )


async def get_time_range_report(start_date: str, end_date: str, queue: Optional[str] = None, all_time: bool = False) -> Dict[str, Any]:
    """Return CDR data for a specific date range."""
    return await get_cdr_summary(start_date=start_date, end_date=end_date, queue=queue, all_time=all_time)


async def refresh_aggregation():
    """Called by the scheduler to pre-warm the cache."""
    invalidate_cache()
    # Pre-warm with last 30 days
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=30)).isoformat()
    await get_cdr_summary(start_date=start, end_date=end)
    print(f"[CDR] Cache refreshed at {datetime.now().isoformat()}")
