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
    """Manages real-time queue status from Asterisk AMI with persistent connection."""
    
    def __init__(self):
        self.reader = None
        self.writer = None
        self.lock = asyncio.Lock()
        self._last_data = []

    def _get_db_member_names(self):
        """Fetch member names directly from database."""
        names_map = {} # interface -> name
        ext_map = {}   # extension -> name
        try:
            with Session(engine) as session:
                result = session.execute(text("SELECT interface, membername FROM queue_members"))
                for row in result:
                    interface, name = str(row[0] or ""), str(row[1] or "")
                    if interface and name:
                        names_map[interface] = name
                        digits = re.findall(r'\d+', interface)
                        if digits: ext_map[digits[0]] = name
        except Exception:
            pass
        return names_map, ext_map

    async def _ensure_connected(self):
        """Maintains a persistent session. Logs in if disconnected."""
        if self.writer:
            try:
                # Check connection with a Ping
                self.writer.write(b"Action: Ping\r\n\r\n")
                await asyncio.wait_for(self.writer.drain(), timeout=2.0)
                resp = await asyncio.wait_for(self._read_until_delimiter(self.reader), timeout=2.0)
                if "Response: Success" in resp or "Pong" in resp:
                    print("AMI: Persistent connection reused successfully.")
                    return
            except Exception:
                try: self.writer.close()
                except: pass
                self.writer = None

        # Reconnect
        self.reader, self.writer = await asyncio.wait_for(
            asyncio.open_connection(AMI_HOST, AMI_PORT), timeout=5
        )
        await self.reader.readline() # banner
        
        # LOGIN with Events: Off to avoid buffer filling up with unsolicited events
        login_cmd = (
            f"Action: Login\r\n"
            f"Username: {AMI_USER}\r\n"
            f"Secret: {AMI_PASS}\r\n"
            f"Events: off\r\n\r\n"
        )
        self.writer.write(login_cmd.encode())
        await self.writer.drain()
        await self._read_until_delimiter(self.reader)
        print("AMI: NEW session established (Events: Off).")

    async def get_queue_status(self):
        """
        Connects to AMI and parses 'QueueStatus' and 'Status' for call correlation.
        Uses a persistent connection to prevent Login/Logoff spam.
        """
        async with self.lock:
            try:
                await self._ensure_connected()
                
                # Fetch names from DB first for overrides
                db_names, ext_names = self._get_db_member_names()

                # Get Channel Status (to correlate calls)
                self.writer.write(b"Action: Status\r\n\r\n")
                await self.writer.drain()
                
                channel_map = {}
                while True:
                    block = await self._read_until_delimiter(self.reader)
                    event = self._parse_block(block)
                    if event.get("Event") == "StatusComplete": break
                    if event.get("Event") == "Status":
                        chan = event.get("Channel", "")
                        p_num = event.get("ConnectedLineNum") or event.get("CallerIDNum")
                        p_name = event.get("ConnectedLineName") or event.get("CallerIDName")
                        if p_num and p_num != "<unknown>":
                            channel_map[chan.lower()] = {
                                "num": p_num,
                                "name": p_name if p_name and p_name != "<unknown>" else "",
                                "application": event.get("Application", ""),
                                "data": event.get("Data", ""),
                                "state": event.get("ChannelStateDesc", ""),
                                # For a channel PJSIP/102-xxx, the "Other side" is usually ConnectedLine
                                # but if that's empty, we check the other way.
                                "connected_line": event.get("ConnectedLineNum", ""),
                                "caller_id": event.get("CallerIDNum", "")
                            }

                # Get Queue Status
                self.writer.write(b"Action: QueueStatus\r\n\r\n")
                await self.writer.drain()

                queues_data = {}
                while True:
                    event_block = await self._read_until_delimiter(self.reader)
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
                            
                            interface = event.get("Interface") or event.get("Location") or ""
                            ami_name = event.get("Name") or event.get("MemberName") or ""
                            
                            digits = re.findall(r'\d+', interface)
                            ext_num = digits[0] if digits else ""
                            if not ext_num:
                                name_digits = re.findall(r'\d+', ami_name)
                                if name_digits: ext_num = name_digits[0]

                            member_name = db_names.get(interface) or ext_names.get(ext_num) or ami_name or ext_num

                            connected_party = None
                            spy_status = None # If someone is spying on THIS member
                            
                            for chan_key, details in channel_map.items():
                                # Check for bridged call (talking to)
                                # We check if the interface (e.g. PJSIP/102) is inside the channel name (e.g. pjsip/102-00001)
                                if interface and interface.lower() in chan_key:
                                    # Regular call logic - ignore ChanSpy
                                    if details.get("application") != "ChanSpy":
                                        # Use the logic: If I am PJSIP/102, I want to show the OTHER person.
                                        # Usually, ConnectedLineNum is the other person.
                                        other_num = details.get("connected_line")
                                        if not other_num or other_num == ext_num or other_num == "<unknown>":
                                            other_num = details.get("caller_id") # Fallback
                                        
                                        # If we still only find ourselves, we keep the original p_num as last resort
                                        connected_party = {
                                            "num": other_num if other_num and other_num != ext_num else details.get("num"),
                                            "name": details.get("name") if other_num != details.get("num") else ""
                                        }
                                
                                # Check for Spy Logic: Is Supervisor 104 spying on THIS interface?
                                if details.get("application") == "ChanSpy":
                                    spy_data = details.get("data", "")
                                    if interface and interface in spy_data:
                                        # This specific member is being spied on!
                                        # Extract who is spying
                                        spyer_num = details.get("num", "Unknown")
                                        if not spyer_num or spyer_num == "<unknown>":
                                            spyer_match = re.search(r'/(?:extension-)?(\d+)', chan_key)
                                            spyer_num = spyer_match.group(1) if spyer_match else "Supervisor"
                                        
                                        # Parse mode based on flags
                                        mode = "Listen"
                                        if 'w' in spy_data.lower(): mode = "Whisper"
                                        elif 'b' in spy_data: mode = "Barge" # b or B
                                        elif 'd' in spy_data.lower(): mode = "Interactive Spy"
                                        
                                        spy_status = {
                                            "spyer": spyer_num,
                                            "mode": mode
                                        }

                            queues_data[q_name]["members"].append({
                                "name": member_name,
                                "number": ext_num or "???",
                                "interface": interface,
                                "status": status_label,
                                "penalty": int(event.get("Penalty", 0)),
                                "calls": int(event.get("CallsTaken", 0)),
                                "connectedParty": connected_party,
                                "spyStatus": spy_status
                            })

                for q_name in queues_data:
                    queues_data[q_name]["members"].sort(key=lambda x: (x["penalty"], x["name"]))

                return list(queues_data.values())

            except asyncio.TimeoutError:
                # Cleanup on timeout
                if self.writer: 
                    try: self.writer.close()
                    except: pass
                self.writer = None
                print(f"AMI Error: Connection timeout to {AMI_HOST}:{AMI_PORT}")
                return []
            except Exception as e:
                # Cleanup on error
                if self.writer: 
                    try: self.writer.close()
                    except: pass
                self.writer = None
                print(f"AMI Error: {e}")
                traceback.print_exc()
                return []

    async def perform_spy_action(self, supervisor_ext: str, target_interface: str, mode: str):
        """
        Triggers a ChanSpy operation via AMI Originate.
        mode: 'spy' (Listen), 'whisper' (Whisper), 'barge' (Barge)
        """
        async with self.lock:
            try:
                await self._ensure_connected()
                
                # ChanSpy options:
                # q: quiet (no beep)
                # d: DTMF interactive mode (4=Listen, 5=Whisper, 6=Barge)
                options = "dq" 
                
                # We originate a call from the Supervisor to the ChanSpy application
                # The target is the member's interface (e.g. PJSIP/101)
                
                # NOTE: Channel should be the Supervisor's actual device channel
                # We assume PJSIP or what's in DB. For simplicity, we use Local/EXT@from-internal if possible,
                # but direct PJSIP/EXT is more common for system phones.
                supervisor_chan = f"PJSIP/{supervisor_ext}" 
                
                print(f"DEBUG: Spy Action Triggered - Supervisor: {supervisor_chan}, Target: {target_interface}, Mode: {mode}")
                
                action = (
                    f"Action: Originate\r\n"
                    f"Channel: {supervisor_chan}\r\n"
                    f"Application: ChanSpy\r\n"
                    f"Data: {target_interface},{options}\r\n"
                    f"CallerID: \"Spy: {target_interface}\" <{supervisor_ext}>\r\n"
                    f"Variable: VAR1=SpyAction\r\n"
                    f"Async: true\r\n\r\n"
                )
                
                self.writer.write(action.encode())
                await self.writer.drain()
                
                # We wait a bit for the response to be read correctly
                resp = await asyncio.wait_for(self._read_until_delimiter(self.reader), timeout=3.0)
                print(f"DEBUG: AMI Spy Response: {resp.strip()}")
                
                if "Success" in resp or "Queued" in resp:
                    return {"status": "success", "message": f"Spy {mode} initiated for {target_interface}"}
                else:
                    return {"status": "error", "message": f"AMI error: {resp.strip()}"}

            except Exception as e:
                print(f"ERROR: Spy Action failed: {e}")
                traceback.print_exc()
                self.writer = None
                return {"status": "error", "message": str(e)}

    async def _read_until_delimiter(self, reader):
        content = ""
        while True:
            try:
                line = await reader.readline()
                if not line: break
                content += line.decode('utf-8', errors='ignore')
                if content.endswith("\r\n\r\n"): break
            except Exception:
                break
        return content

    def _parse_block(self, block):
        data = {}
        for line in block.splitlines():
            if ":" in line:
                parts = line.split(":", 1)
                data[parts[0].strip()] = parts[1].strip()
        return data

queue_manager = QueueStatusManager()
