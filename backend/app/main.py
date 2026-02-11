# Triggering reload
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .crud import routes as crud_routes
from .crud import cdr_routes
from .crud import service as crud_service
from .crud import cdr_service


# ---------------------------------------------------------------------------
# Background scheduler – refreshes CDR aggregation cache every hour
# ---------------------------------------------------------------------------
import asyncio

_scheduler_task = None

async def _hourly_cdr_refresh():
    """Background loop that refreshes CDR cache every 60 minutes."""
    while True:
        await asyncio.sleep(3600)  # 1 hour
        try:
            cdr_service.refresh_aggregation()
        except Exception as e:
            print(f"[CDR Scheduler] Error during refresh: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle for the FastAPI application."""
    global _scheduler_task
    # Startup: launch the hourly CDR refresh task
    _scheduler_task = asyncio.create_task(_hourly_cdr_refresh())
    print("[CDR Scheduler] Hourly aggregation task started.")
    yield
    # Shutdown: cancel the background task
    if _scheduler_task:
        _scheduler_task.cancel()
        print("[CDR Scheduler] Hourly aggregation task stopped.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Asterisk CRUD API", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include main CRUD routes under /api
app.include_router(crud_routes.router, tags=["CRUD"], prefix="/api")

# Include CDR report routes under /api
app.include_router(cdr_routes.router, tags=["CDR Reports"], prefix="/api")


@app.get("/")
async def read_root():
    """Root endpoint - returns API info and available tables."""
    return {
        "message": "Asterisk CRUD API is running",
        "tables": crud_service.get_available_tables(),
    }
