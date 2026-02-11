"""
CDR Report API Routes
---------------------
Exposes endpoints for the CDR reporting frontend:
  /api/cdr/summary         → full aggregated report (heatmap + charts)
  /api/cdr/agent/{agent_id} → filtered report for one agent
  /api/cdr/time_range       → report for a specific date range
  /api/cdr/refresh          → manually trigger cache refresh
"""

from fastapi import APIRouter, Query
from typing import Optional
from . import cdr_service

router = APIRouter(prefix="/cdr", tags=["CDR Reports"])


@router.get("/summary")
async def cdr_summary(
    start: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
):
    """
    Returns aggregated CDR data: heatmap, agent summaries, hourly volume.
    If no dates provided, returns all available data.
    """
    return cdr_service.get_cdr_summary(start_date=start, end_date=end)


@router.get("/agent/{agent_id}")
async def cdr_agent(
    agent_id: str,
    start: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
):
    """Returns CDR data filtered for a specific agent (extension number)."""
    return cdr_service.get_agent_report(agent_id, start_date=start, end_date=end)


@router.get("/time_range")
async def cdr_time_range(
    start: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end: str = Query(..., description="End date (YYYY-MM-DD)"),
):
    """Returns CDR data for a specific date range."""
    return cdr_service.get_time_range_report(start_date=start, end_date=end)


@router.post("/refresh")
async def cdr_refresh():
    """Manually refresh the CDR aggregation cache."""
    cdr_service.refresh_aggregation()
    return {"status": "ok", "message": "CDR cache refreshed"}
