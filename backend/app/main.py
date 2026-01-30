from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .crud import routes as crud_routes
from .crud import service as crud_service


app = FastAPI(title="Asterisk CRUD API")

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


@app.get("/")
async def read_root():
    """Root endpoint - returns API info and available tables."""
    return {
        "message": "Asterisk CRUD API is running",
        "tables": crud_service.get_available_tables(),
    }
