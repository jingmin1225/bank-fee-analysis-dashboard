# BAM Documentation Manager (Streamlit)

Local Streamlit web app for treasury compliance documentation management.

## Run locally

```bash
cd streamlit_app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

The app uses:
- SQLite DB at `streamlit_app/data/bam_docs.db`
- Uploaded files at `streamlit_app/uploads/`

Demo user sessions are pre-seeded in the sidebar:
- `System Admin` (`admin`)
- `Marie Treasurer` (`treasurer`)
- `Sophie Manager` (`document_manager`)
- `Jean Dupont` (`individual`)
