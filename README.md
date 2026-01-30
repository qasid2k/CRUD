# Asterisk CRUD & Queue Management System

A full-stack application for managing Asterisk database records and monitoring real-time queue status.

## Project Structure

- **`/backend`**: FastAPI application handling database CRUD operations and AMI integration.
- **`/frontend_v3`**: React + TypeScript frontend for data visualization and management.

---

## 🚀 Backend Functionality (FastAPI)

The backend serves as a robust API layer connecting the frontend to the Asterisk database and the Asterisk Management Interface (AMI).

- **Dynamic CRUD Engine**: Automatically generates API endpoints for any database table defined in the SQLModel schema.
- **Database Integration**: Built with **SQLModel** (SQLAlchemy + Pydantic) for seamless MariaDB/MySQL interactions.
- **Dynamic Schema Discovery**: Provides metadata about table structures to allow the frontend to build forms dynamically.
- **Real-time Queue Monitoring**: Integrates with **Asterisk AMI** to fetch live updates on call queues, including member status, penalty levels, and hold times.
- **CORS Enabled**: Configured to securely communicate with the React-based frontend.

## 🎨 Frontend Functionality (React + TypeScript)

A modern, responsive dashboard built to provide an intuitive interface for managing Asterisk configurations.

- **Queue Dashboard**:
    - Real-time visualization of Asterisk queue statuses.
    - Displays agent availability, active calls, and queue statistics.
    - Categorizes agents by penalty levels and priority tiers.
- **Universal Table Browser**:
    - A flexible UI for browsing any database table.
    - **Adaptive Forms**: Automatically generates Create/Update forms based on the backend schema.
    - **Pagination & Filtering**: Efficiently handles large datasets.
- **Interactive UI Components**:
    - **Toast Notifications**: Instant feedback for user actions (Success/Error).
    - **Modal-based Editing**: Clean workflow for updating records without leaving the page.
    - **Sidebar Navigation**: Quick switching between the dashboard and data management views.
- **Built with Vite**: Optimized for lightning-fast development and production performance.

---

## 🛠️ Technology Stack

- **Backend**: Python, FastAPI, SQLModel, SQLAlchemy, Pydantic, MySQL/MariaDB.
- **Frontend**: React 18, TypeScript, Vite, CSS (Standard/Modern), Lucide React (Icons).
- **Communication**: RESTful API, Axios.
