# 🚀 AsterFlow: Asterisk Management & CDR Analytics

AsterFlow is a high-performance, full-stack management suite for Asterisk PBX systems. It transforms raw database logs and live AMI events into a central command center for call center supervisors and PBX administrators.

---

## 🌟 Key Features

### 📊 Advanced CDR Analytics & Heatmaps
*   **Visual Performance Tracking**: Interactive heatmaps showing agent talk-time and call volume distributed by hour (0-23) and date.
*   **Intelligent Aggregation**: Background service that processes `queue_log` events to calculate precise talk-time and agent metrics.
*   **Status Breakdown**: Detailed summaries of Answered, Abandoned, Busy, and No-Answer calls per agent.

### 📡 Real-time Queue Dashboard
*   **Live Monitoring**: Instant visualization of queue member status (Online, Busy, Paused, Offline) via Asterisk AMI.
*   **Bridge Detection**: See who your agents are currently talking to with live caller-ID and extension correlation.
*   **Supervisor Tools**: Direct integration for **Spy**, **Whisper**, and **Barge** actions to monitor active calls.
*   **Call Recording & Playback**: Automatic fetching of queue recordings from Asterisk with a side-panel browser player.

### 🛠️ Universal Table Browser
*   **Dynamic CRUD Engine**: Automatically generates management interfaces for any Asterisk database table based on backend models.
*   **Adaptive Forms**: Smart Create/Update forms with validation that adjust based on table schema.
*   **Complex Key Support**: Native handling of composite primary keys for Asterisk realtime architecture.

---

## 🛠️ Technology Stack

- **Backend**: Python 3.10+, FastAPI, SQLModel (SQLAlchemy), Pydantic.
- **Real-time**: Asterisk AMI (Manager Interface).
- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS, Lucide React.
- **Voice**: WebRTC (JsSIP) for the integrated softphone.
- **Database**: MariaDB / MySQL.

---

## 🏗️ Architecture & Deployment

AsterFlow is designed for a **Hybrid Deployment**:
*   **Dockerized (Windows/Desktop)**: The Frontend (React) and Backend (FastAPI) run in lightweight Docker containers.
*   **Remote VM (Linux)**: Asterisk PBX and MariaDB Database run on your Linux server (e.g., Ubuntu/Debian/CentOS).

---

## 🚀 Installation & Setup

### 1. Prerequisites
- **Docker Desktop** installed on your workstation.
- **Linux Server** with Asterisk PBX and MariaDB/MySQL installed.

### 2. Configure Environment Variables
Create a file named `.env` in the **root directory** of the project. Copy and paste the template below, replacing the placeholders with your actual VM details:

```ini
# --- VM Global Settings ---
VM_IP=192.168.1.XXX  # The IP of your Linux server

# --- Database Credentials (Remote VM) ---
DB_HOST=${VM_IP}
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=asterisk

# --- Asterisk AMI Credentials ---
AMI_HOST=${VM_IP}
AMI_PORT=5038
AMI_USER=your_ami_user
AMI_PASS=your_ami_password

# --- Frontend Settings ---
VITE_ASTERISK_IP=${VM_IP}

# --- Table Management (Comma separated list of tables to manage) ---
TABLE_NAMES=extensions,ps_endpoints,ps_auths,ps_aors,queue_members,queues,sippeers,queue_log,cdr
```

### 3. Linux VM Configuration
To allow the Docker containers to communicate with your VM:

#### **A. Enable External MariaDB Access**
1.  Edit `/etc/mysql/mariadb.conf.d/50-server.cnf`:
    Change `bind-address = 127.0.0.1` → `bind-address = 0.0.0.0`
2.  Restart MariaDB: `sudo systemctl restart mariadb`
3.  Grant permission: 
    `GRANT ALL PRIVILEGES ON asterisk.* TO 'your_db_user'@'%' IDENTIFIED BY 'your_db_password';`

#### **B. Enable External Asterisk AMI Access**
1.  Edit `/etc/asterisk/manager.conf`:
    ```ini
    [general]
    enabled = yes
    port = 5038
    bindaddr = 0.0.0.0

    [your_ami_user]
    secret = your_ami_password
    read = all
    write = all
    ```
2.  Reload config: `asterisk -rx "manager reload"`

---

### 4. Launch the Application
Run the following command in your project root:
```bash
docker-compose up -d --build
```
*   **Frontend**: [http://localhost](http://localhost)
*   **API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 📞 WebRTC Softphone Setup
The softphone uses Secure WebSockets (**WSS**). Browser security will block the connection to your VM's self-signed certificate by default.

**To fix this:**
1.  Open a new browser tab.
2.  Visit: `https://YOUR_VM_IP:8089/ws`
3.  Click **Advanced** → **Proceed to YOUR_VM_IP (unsafe)**.
4.  Refresh your AsterFlow Dashboard.

---

## 📂 Project Structure
*   **`/backend`**: FastAPI application handling database CRUD, AMI integration, and CDR aggregation.
*   **`/frontend_v3`**: React + TypeScript frontend with Premium Dark/Light UI.
*   **`docker-compose.yml`**: Orchestration file for Docker deployment.

---

## 📝 License
MIT
