from app.database import engine
from sqlalchemy import MetaData, Table, inspect

def check_table():
    metadata = MetaData()
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        print(f"Tables found: {tables}")
        
        if 'voicemail_messages' in tables:
            print("\nReflecting voicemail_messages...")
            messages = Table('voicemail_messages', metadata, autoload_with=engine)
            print(f"Columns and Types:")
            for col in messages.columns:
                print(f"  - {col.name}: {col.type}")
            print(f"Primary Keys: {[c.name for c in messages.primary_key.columns]}")
            
            print("\nFetching first record...")
            with Session(engine) as session:
                from sqlalchemy import select
                row = session.execute(select(messages).limit(1)).first()
                if row:
                    print(f"Success: {dict(row._mapping)}")
                else:
                    print("Table is empty, but query successful.")
        else:
            print("\nvoicemail_messages NOT FOUND in table list.")
            # check case insensitive
            for t in tables:
                if t.lower() == 'voicemail_messages':
                    print(f"Found match with different casing: {t}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_table()
