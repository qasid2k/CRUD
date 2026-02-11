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

### 🛠️ Universal Table Browser
*   **Dynamic CRUD Engine**: Automatically generates management interfaces for any Asterisk database table based on backend models.
*   **Adaptive Forms**: Smart Create/Update forms with validation that adjust based on table schema.
*   **Complex Key Support**: Native handling of composite primary keys for Asterisk realtime architecture.

---

## 🚀 Technical Architecture

### Backend (FastAPI + SQLModel)
*   **Asynchronous Engine**: Built for high concurrency and real-time event handling.
*   **Background Scheduler**: Integrated Cache Refresh system that pre-calculates CDR aggregates every hour.
*   **Multi-Layer Caching**: Tiered in-memory caching to ensure sub-second response times for heavy analytic queries.

### Frontend (React + Vite)
*   **Modern UI/UX**: Premium dark/light theme support with sleek animations.
*   **Live Updates**: Automatic dashboard refresh cycles to keep data synchronized with the backend state.
*   **Responsive Design**: Optimized for both high-resolution workstations and tablet monitoring.

---

## 🛠️ Technology Stack

- **Backend**: Python 3.10+, FastAPI, SQLModel, SQLAlchemy, Pydantic, MySQL/MariaDB.
- **Real-time**: Asterisk AMI (Manager Interface).
- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS (Modern Utility System), Lucide React.
- **Management**: Axios, Asyncio.

---

## 📂 Project Structure

- **`/backend`**: FastAPI application handling database CRUD, AMI integration, and CDR aggregation logic.
- **`/frontend_v3`**: React + TypeScript frontend optimized for speed and visual clarity.

---

## 🎨 Design Aesthetics
AsterFlow follows a **Rich Aesthetic** philosophy:
- **Glassmorphism**: Subtle translucent backgrounds with backdrop-filters.
- **Dynamic Heatmaps**: Color-coded performance intensity (Green → Yellow → Red).
- **Responsive Layout**: Sidebar-based navigation for a professional dashboard experience.

---

## 📝 License
[Insert License Here - e.g., MIT]
