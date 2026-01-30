import asyncio
import os
import re
import traceback
import json
from dotenv import load_dotenv
from sqlmodel import Session, text
from ..database import engine

load_dotenv()

# AMI Configuration
AMI_HOST = os.getenv("AMI_HOST", "127.0.0.1")
AMI_PORT = int(os.getenv("AMI_PORT", 5038))
AMI_USER = os.getenv("AMI_USER", "admin")
AMI_PASS = os.getenv("AMI_PASS", "amp111")

class QueueStatusManager:
    """Manages real-time queue status from Asterisk AMI."""
    
    def __init__(self):
        self.queues = {}

    def _get_db_member_names(self):
        """Fetch member names directly from database with robust extension-level mapping."""
        names_map = {} # interface -> name
        ext_map = {}   # extension -> name
        try:
            with Session(engine) as session:
                # Query queue_members table
                result = session.execute(text("SELECT interface, membername FROM queue_members"))
                for row in result:
                    interface, name = str(row[0] or ""), str(row[1] or "")
                    if interface and name:
                        names_map[interface] = name
                        # Extract the numeric extension part (e.g. 104 from Local/104@ctx)
                        digits = re.findall(r'\d+', interface)
                        if digits:
                            ext_map[digits[0]] = name
        except Exception:
            pass
        return names_map, ext_map

    async def get_queue_status(self):
        """
        Connects to AMI and parses 'QueueStatus' and 'Status' for call correlation.
        """
        writer = None
        try:
            # Fetch names from DB first for overrides
            db_names, ext_names = self._get_db_member_names()

            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(AMI_HOST, AMI_PORT), timeout=5
            )
            
            # Read banner
            await reader.readline()

            # 1. Login
            login_cmd = f"Action: Login\r\nUsername: {AMI_USER}\r\nSecret: {AMI_PASS}\r\n\r\n"
            writer.write(login_cmd.encode())
            await writer.drain()
            await self._read_until_delimiter(reader)

            # 2. Get Channel Status (to correlate calls)
            writer.write(b"Action: Status\r\n\r\n")
            await writer.drain()
            
            channel_map = {}
            while True:
                block = await self._read_until_delimiter(reader)
                event = self._parse_block(block)
                if event.get("Event") == "StatusComplete": break
                if event.get("Event") == "Status":
                    chan = event.get("Channel", "")
                    p_num = event.get("ConnectedLineNum") or event.get("CallerIDNum")
                    p_name = event.get("ConnectedLineName") or event.get("CallerIDName")
                    if p_num and p_num != "<unknown>":
                        channel_map[chan] = {
                            "num": p_num,
                            "name": p_name if p_name and p_name != "<unknown>" else ""
                        }

            # 3. Get Queue Status
            writer.write(b"Action: QueueStatus\r\n\r\n")
            await writer.drain()

            queues_data = {}
            while True:
                event_block = await self._read_until_delimiter(reader)
                if not event_block: break
                event = self._parse_block(event_block)
                event_name = event.get("Event")
                
                if event_name == "QueueStatusComplete" or (event.get("Response") == "Success" and "status will follow" in event.get("Message", "")):
                    if event_name == "QueueStatusComplete": break
                    continue

                if event_name == "QueueParams":
                    q_name = event.get("Queue")
                    queues_data[q_name] = {
                        "name": q_name,
                        "strategy": event.get("Strategy", "unknown"),
                        "callsWaiting": int(event.get("Calls", 0)),
                        "answered": int(event.get("Completed", 0)),
                        "abandoned": int(event.get("Abandoned", 0)),
                        "serviceLevel": float(event.get("ServiceLevelPerf", 0)),
                        "members": []
                    }

                if event_name == "QueueMember":
                    q_name = event.get("Queue")
                    if q_name in queues_data:
                        status_code = int(event.get("Status", 0))
                        is_paused = int(event.get("Paused", 0)) == 1
                        
                        if is_paused:
                            status_label = "paused"
                        elif status_code in [1, 6]:
                            status_label = "online"
                        elif status_code in [2, 3, 7, 8]:
                            status_label = "busy"
                        else:
                            status_label = "offline"
                        
                        # Robust field detection (handles different Asterisk versions)
                        interface = event.get("Interface") or event.get("Location") or ""
                        ami_name = event.get("Name") or event.get("MemberName") or ""
                        
                        # Extract extension number
                        digits = re.findall(r'\d+', interface)
                        ext_num = digits[0] if digits else ""
                        if not ext_num:
                            name_digits = re.findall(r'\d+', ami_name)
                            if name_digits: ext_num = name_digits[0]

                        # Match Name (Priority: DB Interface Match > DB Extension Match > AMI Name > Ext Number)
                        member_name = db_names.get(interface) or ext_names.get(ext_num) or ami_name or ext_num

                        connected_party = None
                        for chan, details in channel_map.items():
                            if interface and interface in chan:
                                connected_party = details
                                break

                        queues_data[q_name]["members"].append({
                            "name": member_name,
                            "number": ext_num or "???",
                            "interface": interface,
                            "status": status_label,
                            "penalty": int(event.get("Penalty", 0)),
                            "calls": int(event.get("CallsTaken", 0)),
                            "connectedParty": connected_party
                        })

            # Sort by penalty, then name
            for q_name in queues_data:
                queues_data[q_name]["members"].sort(key=lambda x: (x["penalty"], x["name"]))

            # 4. Log out
            writer.write(b"Action: Logoff\r\n\r\n")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

            return list(queues_data.values())

        except Exception as e:
            if writer: writer.close()
            return {"error": str(e)}

    async def _read_until_delimiter(self, reader):
        content = ""
        while True:
            line = await reader.readline()
            if not line: break
            content += line.decode('utf-8', errors='ignore')
            if content.endswith("\r\n\r\n"): break
        return content

    def _parse_block(self, block):
        data = {}
        for line in block.splitlines():
            if ":" in line:
                parts = line.split(":", 1)
                data[parts[0].strip()] = parts[1].strip()
        return data

queue_manager = QueueStatusManager()
