# ClassMate (Frontend + Integrated Backend)

This folder contains the React frontend and the Flask backend used by ClassMate.

## Quick Structure

- `src/`: React app source code.
- `src/ClassMate-Backend/`: Flask backend source code.
- `docs/`: Deployment and solution documentation.
- `src/ClassMate-Backend/docs/`: Backend-specific guides.
- `sfu-server/`: SFU support server files.
- `deploy-backend.ps1`, `deploy-frontend.ps1`, `setup-db.ps1`: Deployment and setup scripts.

## Where To Work

- UI and pages: `src/`
- Shared React utilities: `src/components/`, `src/hooks/`, `src/utils/`
- API routes and backend logic: `src/ClassMate-Backend/*Routes.py`
- Database setup and models: `src/ClassMate-Backend/db.py`, `src/ClassMate-Backend/models.py`

## Documentation

- Main docs index: `docs/README.md`
- Backend docs index: `src/ClassMate-Backend/docs/README.md`

## Run Locally

Frontend:

1. `npm install`
2. `npm run dev`

Backend (from `src/ClassMate-Backend/`):

1. `pip install -r requirements.txt`
2. `python app.py`
