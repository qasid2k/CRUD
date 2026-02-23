from sqlmodel import create_engine, Session
from dotenv import load_dotenv
import os

load_dotenv()

# Check if full URL is provided first
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Build connection string from individual components
    db_user = os.getenv("DB_USER", "asterisk")
    db_password = os.getenv("DB_PASSWORD", "asterisk")
    db_host = os.getenv("DB_HOST", "database")
    db_port = os.getenv("DB_PORT", "3306")
    db_name = os.getenv("DB_NAME", "asterisk")
    DATABASE_URL = f"mysql+mysqlconnector://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"

engine = create_engine(DATABASE_URL, echo=True)


def get_session():
    """Dependency function to get database session"""
    with Session(engine) as session:
        yield session
