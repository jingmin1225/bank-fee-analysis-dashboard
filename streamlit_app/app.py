import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

APP_TITLE = "BAM Documentation Manager"
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "bam_docs.db"

ENTITY_TYPES = ["Company", "Account", "Signer", "Authority", "Other"]
DOC_CATEGORIES = [
    "Certificate of Incorporation",
    "Balance Sheet",
    "Personal ID",
    "Board Resolution",
    "Account Agreement",
    "MoA / AoA",
    "PoA",
    "Other",
]
CONDITION_FIELDS = [
    "Bank",
    "Country of Company",
    "Country of Account",
    "Account Type",
    "Request Type",
]
OPERATORS = ["is equal to", "is not equal to", "is in list"]
STATUSES = ["Available", "WillExpireSoon", "Expired", "Missing"]
ROLES = ["admin", "treasurer", "document_manager", "individual"]


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.utcnow().isoformat()


def parse_json(text: str, fallback):
    try:
        return json.loads(text) if text else fallback
    except json.JSONDecodeError:
        return fallback


def to_json(data) -> str:
    return json.dumps(data, ensure_ascii=True)


def add_months(d: date, months: int) -> date:
    year = d.year + ((d.month - 1 + months) // 12)
    month = ((d.month - 1 + months) % 12) + 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_groups (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_group_members (
                user_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                PRIMARY KEY (user_id, group_id)
            );

            CREATE TABLE IF NOT EXISTS request_types (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                mapped_entity_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_types (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                category TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                is_sensitive INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documentation_rules (
                id TEXT PRIMARY KEY,
                request_type_id TEXT NOT NULL,
                rank INTEGER NOT NULL,
                conditions TEXT NOT NULL,
                required_documents TEXT NOT NULL,
                company_ownership TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_managers (
                id TEXT PRIMARY KEY,
                conditions TEXT NOT NULL,
                assigned_users TEXT NOT NULL,
                assigned_user_groups TEXT NOT NULL,
                notification_template_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                country TEXT,
                company_group TEXT,
                account_nature TEXT,
                currency TEXT,
                source TEXT NOT NULL,
                metadata TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY,
                request_type_id TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                bank TEXT,
                country_of_company TEXT,
                country_of_account TEXT,
                account_type TEXT,
                company_ownership TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entity_documents (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                document_type_id TEXT NOT NULL,
                file_name TEXT,
                file_url TEXT,
                file_path TEXT,
                issuance_date TEXT NOT NULL,
                expiration_date TEXT,
                comment TEXT,
                uploaded_by TEXT,
                uploaded_at TEXT NOT NULL,
                last_updated_by TEXT,
                last_updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_requirements (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                document_type_id TEXT NOT NULL,
                is_mandatory INTEGER NOT NULL,
                document_status TEXT NOT NULL,
                assigned_document_manager_id TEXT,
                latest_document_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_logs (
                id TEXT PRIMARY KEY,
                recipient_user_id TEXT,
                notification_template_id TEXT,
                sent_at TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                request_id TEXT,
                document_requirement_ids TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_integrations (
                id TEXT PRIMARY KEY,
                connection_name TEXT NOT NULL,
                authorization_url TEXT,
                api_base_url TEXT NOT NULL,
                client_id TEXT,
                client_secret TEXT,
                scope TEXT,
                auth_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_sync_at TEXT
            );
            """
        )


def seed_data():
    with get_conn() as conn:
        has_users = conn.execute("SELECT COUNT(1) AS c FROM users").fetchone()["c"]
        if has_users:
            return

        t = now_iso()
        users = [
            (new_id(), "admin@bam.local", "System Admin", "admin", 1, t, t),
            (new_id(), "treasurer@bam.local", "Marie Treasurer", "treasurer", 1, t, t),
            (new_id(), "manager@bam.local", "Sophie Manager", "document_manager", 1, t, t),
            (new_id(), "signer@bam.local", "Jean Dupont", "individual", 1, t, t),
        ]
        conn.executemany(
            "INSERT INTO users (id, email, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            users,
        )

        groups = [
            (new_id(), "Treasury Ops", t),
            (new_id(), "KYC Team", t),
        ]
        conn.executemany("INSERT INTO user_groups (id, name, created_at) VALUES (?, ?, ?)", groups)

        request_types = [
            (new_id(), "Account Opening", "Required docs for new accounts", "Account", t, t),
            (new_id(), "Account Closing", "Documents for closure", "Account", t, t),
            (new_id(), "Change in Signers", "Signer update package", "Signer", t, t),
            (new_id(), "KYC", "KYC periodic review", "Company", t, t),
            (new_id(), "Company Name Change", "Name change set", "Company", t, t),
        ]
        conn.executemany(
            "INSERT INTO request_types (id, name, description, mapped_entity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            request_types,
        )

        doc_types = [
            (new_id(), "Certificate of Incorporation", "Company registration", "Certificate of Incorporation", "Company", 0, t, t),
            (new_id(), "Annual Balance Sheet", "Most recent balance sheet", "Balance Sheet", "Company", 0, t, t),
            (new_id(), "Passport Copy", "Government ID", "Personal ID", "Signer", 1, t, t),
            (new_id(), "Board Resolution", "Authorizing resolution", "Board Resolution", "Authority", 0, t, t),
            (new_id(), "Bank Account Agreement", "Signed account agreement", "Account Agreement", "Account", 0, t, t),
        ]
        conn.executemany(
            "INSERT INTO document_types (id, name, description, category, entity_type, is_sensitive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            doc_types,
        )

        entities = [
            (new_id(), "CMP-100", "BAM Holdings SA", "Company", "France", "BAM Group", "", "EUR", "Manual", "{}", t, t),
            (new_id(), "ACC-200", "BAM Main EUR", "Account", "France", "BAM Group", "Operating", "EUR", "Manual", "{}", t, t),
            (new_id(), "ACC-201", "BAM USD Reserve", "Account", "United States", "BAM Group", "Reserve", "USD", "Manual", "{}", t, t),
            (new_id(), "SGN-300", "Jean Dupont", "Signer", "France", "BAM Group", "", "", "Manual", "{}", t, t),
            (new_id(), "AUT-400", "Corporate Secretary", "Authority", "France", "BAM Group", "", "", "Manual", "{}", t, t),
        ]
        conn.executemany(
            "INSERT INTO entities (id, code, name, entity_type, country, company_group, account_nature, currency, source, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            entities,
        )


def fetch_all(query: str, params=()):
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def fetch_one(query: str, params=()):
    with get_conn() as conn:
        row = conn.execute(query, params).fetchone()
    return dict(row) if row else None


def execute(query: str, params=()):
    with get_conn() as conn:
        conn.execute(query, params)


def compute_status(expiration_date_raw: str | None) -> str:
    if not expiration_date_raw:
        return "Available"
    try:
        exp = date.fromisoformat(expiration_date_raw)
    except ValueError:
        return "Available"

    days_left = (exp - date.today()).days
    if days_left < 0:
        return "Expired"
    if days_left <= 30:
        return "WillExpireSoon"
    return "Available"


def pick_latest_document(entity_id: str, document_type_id: str):
    return fetch_one(
        """
        SELECT * FROM entity_documents
        WHERE entity_id = ? AND document_type_id = ?
        ORDER BY datetime(uploaded_at) DESC
        LIMIT 1
        """,
        (entity_id, document_type_id),
    )


def evaluate_condition(condition: dict, context: dict) -> bool:
    field_map = {
        "Bank": "bank",
        "Country of Company": "country_of_company",
        "Country of Account": "country_of_account",
        "Account Type": "account_type",
        "Request Type": "request_type_name",
    }
    key = field_map.get(condition.get("field"))
    if not key:
        return True
    current_value = (context.get(key) or "").strip()
    operator = condition.get("operator")
    raw_value = (condition.get("value") or "").strip()

    if operator == "is equal to":
        return current_value == raw_value
    if operator == "is not equal to":
        return current_value != raw_value
    if operator == "is in list":
        values = [x.strip() for x in raw_value.split(",") if x.strip()]
        return current_value in values
    return True


def match_rule_for_request(req_row: dict):
    request_type = fetch_one("SELECT * FROM request_types WHERE id = ?", (req_row["request_type_id"],))
    if not request_type:
        return None

    rules = fetch_all(
        "SELECT * FROM documentation_rules WHERE request_type_id = ? ORDER BY rank ASC, created_at ASC",
        (req_row["request_type_id"],),
    )
    context = {
        "bank": req_row.get("bank") or "",
        "country_of_company": req_row.get("country_of_company") or "",
        "country_of_account": req_row.get("country_of_account") or "",
        "account_type": req_row.get("account_type") or "",
        "request_type_name": request_type["name"],
    }
    for rule in rules:
        conditions = parse_json(rule["conditions"], [])
        if all(evaluate_condition(c, context) for c in conditions):
            return rule
    return None


def choose_entity_for_requirement(request_row: dict, required_entity_type: str):
    req_entity = fetch_one("SELECT * FROM entities WHERE id = ?", (request_row["entity_id"],))
    if req_entity and req_entity["entity_type"] == required_entity_type:
        return req_entity

    if req_entity and req_entity.get("company_group"):
        candidate = fetch_one(
            """
            SELECT * FROM entities
            WHERE entity_type = ? AND company_group = ?
            ORDER BY code ASC
            LIMIT 1
            """,
            (required_entity_type, req_entity["company_group"]),
        )
        if candidate:
            return candidate

    return fetch_one(
        "SELECT * FROM entities WHERE entity_type = ? ORDER BY code ASC LIMIT 1",
        (required_entity_type,),
    )


def manager_matches(manager_conditions: dict, document_type_id: str, entity: dict | None) -> bool:
    doc_ids = manager_conditions.get("documentTypeIds") or []
    if doc_ids and document_type_id not in doc_ids:
        return False

    company_ids = manager_conditions.get("companyIds") or []
    if company_ids and entity and entity["entity_type"] == "Company" and entity["id"] not in company_ids:
        return False

    company_groups = manager_conditions.get("companyGroups") or []
    if company_groups and entity and entity.get("company_group") not in company_groups:
        return False

    account_natures = manager_conditions.get("accountNature") or []
    if account_natures and entity and entity.get("account_nature") not in account_natures:
        return False

    account_ccy = manager_conditions.get("accountCurrency") or []
    if account_ccy and entity and entity.get("currency") not in account_ccy:
        return False

    return True


def find_assigned_manager(document_type_id: str, entity: dict | None):
    managers = fetch_all("SELECT * FROM document_managers ORDER BY created_at DESC")
    for manager in managers:
        conditions = parse_json(manager["conditions"], {})
        if manager_matches(conditions, document_type_id, entity):
            return manager
    return None


def regenerate_requirements_for_request(request_id: str):
    request_row = fetch_one("SELECT * FROM requests WHERE id = ?", (request_id,))
    if not request_row:
        return

    execute("DELETE FROM document_requirements WHERE request_id = ?", (request_id,))

    rule = match_rule_for_request(request_row)
    if not rule:
        return

    required_docs = parse_json(rule["required_documents"], [])
    for row in required_docs:
        entity_type = row.get("entityType") or "Company"
        doc_type_id = row.get("documentTypeId")
        if not doc_type_id:
            continue

        entity = choose_entity_for_requirement(request_row, entity_type)
        if not entity:
            continue

        latest_doc = pick_latest_document(entity["id"], doc_type_id)
        status = "Missing" if not latest_doc else compute_status(latest_doc.get("expiration_date"))
        manager = find_assigned_manager(doc_type_id, entity)

        req_id = new_id()
        ts = now_iso()
        execute(
            """
            INSERT INTO document_requirements (
                id, request_id, entity_type, entity_id, document_type_id,
                is_mandatory, document_status, assigned_document_manager_id,
                latest_document_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req_id,
                request_id,
                entity_type,
                entity["id"],
                doc_type_id,
                1 if row.get("isMandatory", True) else 0,
                status,
                manager["id"] if manager else None,
                latest_doc["id"] if latest_doc else None,
                ts,
                ts,
            ),
        )


def refresh_requirement_statuses():
    requirements = fetch_all("SELECT * FROM document_requirements")
    for requirement in requirements:
        latest_doc = None
        if requirement.get("latest_document_id"):
            latest_doc = fetch_one("SELECT * FROM entity_documents WHERE id = ?", (requirement["latest_document_id"],))

        if not latest_doc:
            latest_doc = pick_latest_document(requirement["entity_id"], requirement["document_type_id"])

        status = "Missing" if not latest_doc else compute_status(latest_doc.get("expiration_date"))
        execute(
            """
            UPDATE document_requirements
            SET latest_document_id = ?, document_status = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                latest_doc["id"] if latest_doc else None,
                status,
                now_iso(),
                requirement["id"],
            ),
        )


def role_guard(required_roles):
    user = st.session_state.get("current_user")
    if not user or user["role"] not in required_roles:
        st.warning("You do not have permission to access this page.")
        st.stop()


def sidebar_login():
    st.sidebar.title(APP_TITLE)
    users = fetch_all("SELECT * FROM users WHERE is_active = 1 ORDER BY role, full_name")
    labels = [f"{u['full_name']} ({u['role']})" for u in users]
    chosen = st.sidebar.selectbox("User session", labels)
    user = users[labels.index(chosen)]
    st.session_state["current_user"] = user
    st.sidebar.caption(f"Email: {user['email']}")

    pages = {
        "admin": [
            "Overview",
            "Request Types",
            "Document Types",
            "Documentation Rules",
            "Document Managers",
            "Entities",
            "Requests",
            "Upload Documents",
            "Dashboard",
            "API Integrations",
            "Notifications",
        ],
        "treasurer": ["Overview", "Requests", "Upload Documents", "Dashboard", "Notifications"],
        "document_manager": ["Overview", "Upload Documents", "Dashboard", "Notifications"],
        "individual": ["Overview", "My Sensitive Documents"],
    }

    page = st.sidebar.radio("Navigation", pages[user["role"]])
    return user, page


def render_overview():
    st.title(APP_TITLE)
    st.write(
        "Local Streamlit application for corporate treasury teams to manage compliance documentation for bank account management activities."
    )

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Request Types", len(fetch_all("SELECT id FROM request_types")))
    col2.metric("Document Types", len(fetch_all("SELECT id FROM document_types")))
    col3.metric("Entities", len(fetch_all("SELECT id FROM entities")))
    col4.metric("Open Requirements", len(fetch_all("SELECT id FROM document_requirements WHERE document_status != 'Available'")))

    st.subheader("Status Snapshot")
    rows = fetch_all(
        "SELECT document_status, COUNT(1) AS c FROM document_requirements GROUP BY document_status ORDER BY document_status"
    )
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    else:
        st.info("No document requirements generated yet. Create a request to derive requirements from rules.")


def render_request_types():
    role_guard(["admin"])
    st.header("Request Type Setup")
    with st.form("request_type_form"):
        name = st.text_input("Name")
        description = st.text_area("Description")
        mapped_entity_type = st.selectbox("Mapped Entity Type", ENTITY_TYPES)
        submitted = st.form_submit_button("Create Request Type")
        if submitted and name.strip():
            ts = now_iso()
            execute(
                "INSERT INTO request_types (id, name, description, mapped_entity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (new_id(), name.strip(), description.strip(), mapped_entity_type, ts, ts),
            )
            st.success("Request type created.")
            st.rerun()

    rows = fetch_all("SELECT * FROM request_types ORDER BY name")
    for row in rows:
        with st.expander(f"{row['name']} ({row['mapped_entity_type']})"):
            new_desc = st.text_area("Description", value=row.get("description") or "", key=f"rt_desc_{row['id']}")
            new_entity = st.selectbox("Mapped Entity Type", ENTITY_TYPES, index=ENTITY_TYPES.index(row["mapped_entity_type"]), key=f"rt_map_{row['id']}")
            c1, c2 = st.columns(2)
            if c1.button("Save", key=f"rt_save_{row['id']}"):
                execute(
                    "UPDATE request_types SET description = ?, mapped_entity_type = ?, updated_at = ? WHERE id = ?",
                    (new_desc.strip(), new_entity, now_iso(), row["id"]),
                )
                st.success("Updated.")
                st.rerun()
            if c2.button("Delete", key=f"rt_del_{row['id']}"):
                execute("DELETE FROM request_types WHERE id = ?", (row["id"],))
                st.warning("Deleted.")
                st.rerun()


def render_document_types(current_user):
    role_guard(["admin"])
    st.header("Document Type Setup")

    with st.form("document_type_form"):
        name = st.text_input("Name")
        description = st.text_area("Description")
        category = st.selectbox("Category (SWIFT style)", DOC_CATEGORIES)
        entity_type = st.selectbox("Entity Type", ENTITY_TYPES)
        is_sensitive = st.toggle("Sensitive document")
        submitted = st.form_submit_button("Create Document Type")
        if submitted and name.strip():
            ts = now_iso()
            execute(
                "INSERT INTO document_types (id, name, description, category, entity_type, is_sensitive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (new_id(), name.strip(), description.strip(), category, entity_type, 1 if is_sensitive else 0, ts, ts),
            )
            st.success("Document type created.")
            st.rerun()

    rows = fetch_all("SELECT * FROM document_types ORDER BY name")
    for row in rows:
        with st.expander(f"{row['name']} | {row['entity_type']} | {row['category']}"):
            new_desc = st.text_area("Description", value=row.get("description") or "", key=f"dt_desc_{row['id']}")
            new_category = st.selectbox("Category", DOC_CATEGORIES, index=DOC_CATEGORIES.index(row["category"]), key=f"dt_cat_{row['id']}")
            new_entity = st.selectbox("Entity Type", ENTITY_TYPES, index=ENTITY_TYPES.index(row["entity_type"]), key=f"dt_entity_{row['id']}")
            new_sensitive = st.checkbox("Sensitive", value=bool(row["is_sensitive"]), key=f"dt_sensitive_{row['id']}")
            c1, c2 = st.columns(2)
            if c1.button("Save", key=f"dt_save_{row['id']}"):
                execute(
                    "UPDATE document_types SET description = ?, category = ?, entity_type = ?, is_sensitive = ?, updated_at = ? WHERE id = ?",
                    (new_desc.strip(), new_category, new_entity, 1 if new_sensitive else 0, now_iso(), row["id"]),
                )
                st.success("Updated.")
                st.rerun()
            if c2.button("Delete", key=f"dt_del_{row['id']}"):
                execute("DELETE FROM document_types WHERE id = ?", (row["id"],))
                st.warning("Deleted.")
                st.rerun()

    if current_user["role"] != "admin":
        st.caption("Sensitive document metadata is hidden for non-admin users.")


def render_documentation_rules():
    role_guard(["admin"])
    st.header("Documentation Rules Setup")

    request_types = fetch_all("SELECT * FROM request_types ORDER BY name")
    if not request_types:
        st.info("Create request types first.")
        return

    rt_label = st.selectbox("Request Type", [f"{r['name']} ({r['mapped_entity_type']})" for r in request_types])
    request_type = request_types[[f"{r['name']} ({r['mapped_entity_type']})" for r in request_types].index(rt_label)]

    rules = fetch_all(
        "SELECT * FROM documentation_rules WHERE request_type_id = ? ORDER BY rank ASC, created_at ASC",
        (request_type["id"],),
    )

    st.subheader("Existing Rules")
    if not rules:
        st.caption("No rules yet for this request type.")

    for i, rule in enumerate(rules):
        conditions = parse_json(rule["conditions"], [])
        required = parse_json(rule["required_documents"], [])

        with st.expander(f"Rank {rule['rank']} | Rule {rule['id'][:8]}"):
            st.write("Conditions (AND):", conditions or "No conditions")
            st.write("Required Documents:", required or "No required document rows")
            c1, c2, c3 = st.columns(3)
            if c1.button("Move Up", key=f"rule_up_{rule['id']}", disabled=i == 0):
                above = rules[i - 1]
                execute("UPDATE documentation_rules SET rank = ?, updated_at = ? WHERE id = ?", (above["rank"], now_iso(), rule["id"]))
                execute("UPDATE documentation_rules SET rank = ?, updated_at = ? WHERE id = ?", (rule["rank"], now_iso(), above["id"]))
                st.rerun()
            if c2.button("Move Down", key=f"rule_dn_{rule['id']}", disabled=i == len(rules) - 1):
                below = rules[i + 1]
                execute("UPDATE documentation_rules SET rank = ?, updated_at = ? WHERE id = ?", (below["rank"], now_iso(), rule["id"]))
                execute("UPDATE documentation_rules SET rank = ?, updated_at = ? WHERE id = ?", (rule["rank"], now_iso(), below["id"]))
                st.rerun()
            if c3.button("Delete", key=f"rule_del_{rule['id']}"):
                execute("DELETE FROM documentation_rules WHERE id = ?", (rule["id"],))
                st.warning("Rule deleted.")
                st.rerun()

    st.subheader("Create / Update Rule")
    edit_options = ["Create New"] + [f"Rank {r['rank']} - {r['id'][:8]}" for r in rules]
    choice = st.selectbox("Edit target", edit_options)

    selected_rule = None
    if choice != "Create New":
        selected_rule = rules[edit_options.index(choice) - 1]

    default_conditions = parse_json(selected_rule["conditions"], []) if selected_rule else [{"field": "Bank", "operator": "is equal to", "value": ""}]
    cond_df = pd.DataFrame(default_conditions)
    cond_df = cond_df.reindex(columns=["field", "operator", "value"])

    st.caption("Condition Builder (AND logic)")
    edited_cond_df = st.data_editor(
        cond_df,
        width="stretch",
        num_rows="dynamic",
        column_config={
            "field": st.column_config.SelectboxColumn(options=CONDITION_FIELDS),
            "operator": st.column_config.SelectboxColumn(options=OPERATORS),
            "value": st.column_config.TextColumn(help="For list operator, use comma-separated values"),
        },
        key=f"conditions_editor_{selected_rule['id'] if selected_rule else 'new'}",
    )

    doc_types = fetch_all("SELECT * FROM document_types ORDER BY name")
    doc_type_map = {d["name"]: d["id"] for d in doc_types}
    doc_name_by_id = {d["id"]: d["name"] for d in doc_types}

    default_required = []
    if selected_rule:
        for item in parse_json(selected_rule["required_documents"], []):
            default_required.append(
                {
                    "entityType": item.get("entityType", "Company"),
                    "documentType": doc_name_by_id.get(item.get("documentTypeId"), ""),
                    "isMandatory": bool(item.get("isMandatory", True)),
                    "checkExpiration": bool(item.get("checkExpiration", False)),
                    "expirationDelayMonths": int(item.get("expirationDelayMonths") or 0),
                }
            )
    if not default_required:
        default_required = [
            {
                "entityType": "Company",
                "documentType": "",
                "isMandatory": True,
                "checkExpiration": False,
                "expirationDelayMonths": 0,
            }
        ]

    req_df = pd.DataFrame(default_required)
    st.caption("Required Document Rows")
    edited_req_df = st.data_editor(
        req_df,
        width="stretch",
        num_rows="dynamic",
        column_config={
            "entityType": st.column_config.SelectboxColumn(options=ENTITY_TYPES),
            "documentType": st.column_config.SelectboxColumn(options=list(doc_type_map.keys())),
            "isMandatory": st.column_config.CheckboxColumn(),
            "checkExpiration": st.column_config.CheckboxColumn(),
            "expirationDelayMonths": st.column_config.NumberColumn(min_value=0, max_value=120, step=1),
        },
        key=f"required_docs_editor_{selected_rule['id'] if selected_rule else 'new'}",
    )

    company_ownership = st.text_input("Company Ownership (optional)", value=selected_rule["company_ownership"] if selected_rule else "")

    if st.button("Save Rule"):
        cleaned_conditions = []
        for _, row in edited_cond_df.fillna("").iterrows():
            if not str(row.get("field", "")).strip():
                continue
            cleaned_conditions.append(
                {
                    "field": str(row.get("field", "")).strip(),
                    "operator": str(row.get("operator", "is equal to")).strip(),
                    "value": str(row.get("value", "")).strip(),
                }
            )

        cleaned_required = []
        for _, row in edited_req_df.fillna("").iterrows():
            doc_name = str(row.get("documentType", "")).strip()
            if not doc_name or doc_name not in doc_type_map:
                continue
            cleaned_required.append(
                {
                    "entityType": str(row.get("entityType", "Company")),
                    "documentTypeId": doc_type_map[doc_name],
                    "isMandatory": bool(row.get("isMandatory", True)),
                    "checkExpiration": bool(row.get("checkExpiration", False)),
                    "expirationDelayMonths": int(row.get("expirationDelayMonths") or 0),
                }
            )

        if not cleaned_required:
            st.error("At least one valid required document row is required.")
        else:
            ts = now_iso()
            if selected_rule:
                execute(
                    """
                    UPDATE documentation_rules
                    SET conditions = ?, required_documents = ?, company_ownership = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (to_json(cleaned_conditions), to_json(cleaned_required), company_ownership.strip(), ts, selected_rule["id"]),
                )
                st.success("Rule updated.")
            else:
                max_rank_row = fetch_one(
                    "SELECT COALESCE(MAX(rank), 0) AS max_rank FROM documentation_rules WHERE request_type_id = ?",
                    (request_type["id"],),
                )
                rank = int(max_rank_row["max_rank"]) + 1
                execute(
                    """
                    INSERT INTO documentation_rules
                    (id, request_type_id, rank, conditions, required_documents, company_ownership, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id(),
                        request_type["id"],
                        rank,
                        to_json(cleaned_conditions),
                        to_json(cleaned_required),
                        company_ownership.strip(),
                        ts,
                        ts,
                    ),
                )
                st.success("Rule created.")
            st.rerun()


def render_document_managers():
    role_guard(["admin"])
    st.header("Documentation Manager Setup")

    users = fetch_all("SELECT * FROM users ORDER BY full_name")
    user_map = {f"{u['full_name']} ({u['role']})": u["id"] for u in users}
    groups = fetch_all("SELECT * FROM user_groups ORDER BY name")
    group_map = {g["name"]: g["id"] for g in groups}
    doc_types = fetch_all("SELECT * FROM document_types ORDER BY name")
    doc_map = {d["name"]: d["id"] for d in doc_types}
    companies = fetch_all("SELECT * FROM entities WHERE entity_type = 'Company' ORDER BY name")

    with st.form("doc_manager_form"):
        selected_doc_names = st.multiselect("Document Types", list(doc_map.keys()))
        selected_company_names = st.multiselect("Company filter", [c["name"] for c in companies])
        company_groups = st.text_input("Company Group filter (comma-separated)")
        account_nature = st.text_input("Account Nature filter (comma-separated)")
        account_currency = st.text_input("Account Currency filter (comma-separated)")

        assigned_users = st.multiselect("Assigned Users", list(user_map.keys()))
        assigned_groups = st.multiselect("Assigned User Groups", list(group_map.keys()))
        notification_template_id = st.text_input("Notification Template ID")

        submitted = st.form_submit_button("Create Assignment")
        if submitted:
            conditions = {
                "documentTypeIds": [doc_map[x] for x in selected_doc_names],
                "companyIds": [c["id"] for c in companies if c["name"] in selected_company_names],
                "companyGroups": [x.strip() for x in company_groups.split(",") if x.strip()],
                "accountNature": [x.strip() for x in account_nature.split(",") if x.strip()],
                "accountCurrency": [x.strip() for x in account_currency.split(",") if x.strip()],
            }
            ts = now_iso()
            execute(
                """
                INSERT INTO document_managers
                (id, conditions, assigned_users, assigned_user_groups, notification_template_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    to_json(conditions),
                    to_json([user_map[x] for x in assigned_users]),
                    to_json([group_map[x] for x in assigned_groups]),
                    notification_template_id.strip() or None,
                    ts,
                    ts,
                ),
            )
            st.success("Assignment created.")
            st.rerun()

    st.subheader("Assignments")
    rows = fetch_all("SELECT * FROM document_managers ORDER BY datetime(created_at) DESC")
    for row in rows:
        conditions = parse_json(row["conditions"], {})
        with st.expander(f"Manager Assignment {row['id'][:8]}"):
            st.json(
                {
                    "conditions": conditions,
                    "assigned_users": parse_json(row["assigned_users"], []),
                    "assigned_user_groups": parse_json(row["assigned_user_groups"], []),
                    "notification_template_id": row.get("notification_template_id"),
                }
            )
            if st.button("Delete", key=f"dm_delete_{row['id']}"):
                execute("DELETE FROM document_managers WHERE id = ?", (row["id"],))
                st.warning("Assignment deleted.")
                st.rerun()


def render_entities():
    role_guard(["admin"])
    st.header("Entities")

    with st.form("entity_form"):
        code = st.text_input("Code")
        name = st.text_input("Name")
        entity_type = st.selectbox("Entity Type", ENTITY_TYPES)
        country = st.text_input("Country")
        company_group = st.text_input("Company Group")
        account_nature = st.text_input("Account Nature")
        currency = st.text_input("Currency")
        source = st.selectbox("Source", ["Manual", "Kyriba", "API"]) 
        submitted = st.form_submit_button("Create Entity")
        if submitted and code.strip() and name.strip():
            ts = now_iso()
            execute(
                """
                INSERT INTO entities
                (id, code, name, entity_type, country, company_group, account_nature, currency, source, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    code.strip(),
                    name.strip(),
                    entity_type,
                    country.strip(),
                    company_group.strip(),
                    account_nature.strip(),
                    currency.strip(),
                    source,
                    "{}",
                    ts,
                    ts,
                ),
            )
            st.success("Entity created.")
            st.rerun()

    rows = fetch_all("SELECT * FROM entities ORDER BY entity_type, code")
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


def render_requests(current_user):
    role_guard(["admin", "treasurer"])
    st.header("Requests")

    request_types = fetch_all("SELECT * FROM request_types ORDER BY name")
    entities = fetch_all("SELECT * FROM entities ORDER BY entity_type, name")
    if not request_types or not entities:
        st.info("Request types and entities are required.")
        return

    rt_labels = [f"{r['name']} ({r['mapped_entity_type']})" for r in request_types]
    entity_labels = [f"{e['code']} | {e['name']} ({e['entity_type']})" for e in entities]

    with st.form("request_form"):
        rt_label = st.selectbox("Request Type", rt_labels)
        entity_label = st.selectbox("Main Entity", entity_labels)
        bank = st.text_input("Bank")
        country_of_company = st.text_input("Country of Company")
        country_of_account = st.text_input("Country of Account")
        account_type = st.text_input("Account Type")
        company_ownership = st.text_input("Company Ownership")
        submitted = st.form_submit_button("Create Request and Derive Requirements")
        if submitted:
            request_type = request_types[rt_labels.index(rt_label)]
            entity = entities[entity_labels.index(entity_label)]
            rid = new_id()
            ts = now_iso()
            execute(
                """
                INSERT INTO requests
                (id, request_type_id, entity_id, bank, country_of_company, country_of_account, account_type, company_ownership, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rid,
                    request_type["id"],
                    entity["id"],
                    bank.strip(),
                    country_of_company.strip(),
                    country_of_account.strip(),
                    account_type.strip(),
                    company_ownership.strip(),
                    current_user["id"],
                    ts,
                    ts,
                ),
            )
            regenerate_requirements_for_request(rid)
            refresh_requirement_statuses()
            st.success("Request created and requirements derived from the highest-ranked matching rule.")
            st.rerun()

    rows = fetch_all(
        """
        SELECT r.id, r.created_at, rt.name AS request_type, e.code AS entity_code, e.name AS entity_name,
               r.bank, r.country_of_company, r.country_of_account, r.account_type
        FROM requests r
        JOIN request_types rt ON rt.id = r.request_type_id
        JOIN entities e ON e.id = r.entity_id
        ORDER BY datetime(r.created_at) DESC
        """
    )
    st.subheader("Existing Requests")
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)

    if rows:
        ids = [row["id"] for row in rows]
        selected = st.selectbox("Rebuild requirements for request", ids)
        if st.button("Recompute from Rules"):
            regenerate_requirements_for_request(selected)
            refresh_requirement_statuses()
            st.success("Requirements refreshed.")
            st.rerun()


def infer_expiration_from_requirements(entity_id: str, document_type_id: str, issuance: date):
    req_rows = fetch_all(
        """
        SELECT * FROM document_requirements
        WHERE entity_id = ? AND document_type_id = ?
        """,
        (entity_id, document_type_id),
    )
    delays = []
    for req in req_rows:
        request_row = fetch_one("SELECT * FROM requests WHERE id = ?", (req["request_id"],))
        if not request_row:
            continue
        rule = match_rule_for_request(request_row)
        if not rule:
            continue
        required_rows = parse_json(rule["required_documents"], [])
        for row in required_rows:
            if row.get("documentTypeId") == document_type_id and row.get("checkExpiration"):
                delays.append(int(row.get("expirationDelayMonths") or 0))
    if not delays:
        return None
    return add_months(issuance, max(delays))


def render_upload_documents(current_user):
    role_guard(["admin", "treasurer", "document_manager"])
    st.header("Document Upload & Enrichment")

    entities = fetch_all("SELECT * FROM entities ORDER BY entity_type, code")
    doc_types = fetch_all("SELECT * FROM document_types ORDER BY name")

    entity_labels = [f"{e['code']} | {e['name']} ({e['entity_type']})" for e in entities]
    doc_labels = [f"{d['name']} ({d['entity_type']})" for d in doc_types]

    with st.form("upload_form", clear_on_submit=True):
        selected_entity_label = st.selectbox("Entity", entity_labels)
        selected_doc_label = st.selectbox("Document Type", doc_labels)
        uploaded_file = st.file_uploader("Upload file (optional)")
        external_url = st.text_input("External URL (optional)")
        issuance_date = st.date_input("Issuance Date", value=date.today())
        auto_calc_exp = st.checkbox("Auto-calculate expiration from matching rule")
        use_expiration_date = st.checkbox("Set explicit expiration date")
        expiration_date = st.date_input("Expiration Date", value=date.today(), disabled=not use_expiration_date)
        comment = st.text_area("Comment (optional)")
        submitted = st.form_submit_button("Save Document")

        if submitted:
            entity = entities[entity_labels.index(selected_entity_label)]
            doc_type = doc_types[doc_labels.index(selected_doc_label)]

            if not uploaded_file and not external_url.strip():
                st.error("Provide either a file upload or external URL.")
                st.stop()

            file_name = None
            file_path = None
            if uploaded_file:
                file_name = uploaded_file.name
                safe_name = f"{uuid.uuid4().hex}_{uploaded_file.name}"
                file_path = str(UPLOAD_DIR / safe_name)
                with open(file_path, "wb") as f:
                    f.write(uploaded_file.read())

            final_expiration = None
            if auto_calc_exp:
                inferred = infer_expiration_from_requirements(entity["id"], doc_type["id"], issuance_date)
                final_expiration = inferred.isoformat() if inferred else None
            elif use_expiration_date:
                final_expiration = expiration_date.isoformat()

            ts = now_iso()
            doc_id = new_id()
            execute(
                """
                INSERT INTO entity_documents
                (id, entity_type, entity_id, document_type_id, file_name, file_url, file_path,
                 issuance_date, expiration_date, comment, uploaded_by, uploaded_at, last_updated_by, last_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc_id,
                    entity["entity_type"],
                    entity["id"],
                    doc_type["id"],
                    file_name,
                    external_url.strip() or None,
                    file_path,
                    issuance_date.isoformat(),
                    final_expiration,
                    comment.strip(),
                    current_user["id"],
                    ts,
                    current_user["id"],
                    ts,
                ),
            )

            execute(
                """
                UPDATE document_requirements
                SET latest_document_id = ?, document_status = ?, updated_at = ?
                WHERE entity_id = ? AND document_type_id = ?
                """,
                (doc_id, compute_status(final_expiration), ts, entity["id"], doc_type["id"]),
            )
            refresh_requirement_statuses()
            st.success("Document saved and requirement statuses refreshed.")

    st.subheader("Entity Documents")
    show_entity = st.selectbox("Filter by entity", ["All"] + entity_labels)
    rows = fetch_all(
        """
        SELECT ed.id, e.code AS entity_code, e.name AS entity_name, ed.file_name, ed.file_url, ed.file_path,
               dt.name AS document_type, dt.category, dt.is_sensitive,
               ed.issuance_date, ed.expiration_date, ed.comment,
               u.full_name AS uploaded_by, ed.uploaded_at
        FROM entity_documents ed
        JOIN entities e ON e.id = ed.entity_id
        JOIN document_types dt ON dt.id = ed.document_type_id
        LEFT JOIN users u ON u.id = ed.uploaded_by
        ORDER BY datetime(ed.uploaded_at) DESC
        """
    )

    if show_entity != "All":
        entity = entities[entity_labels.index(show_entity)]
        rows = [r for r in rows if r["entity_code"] == entity["code"]]

    for row in rows:
        if current_user["role"] in ["treasurer", "document_manager"] and row["is_sensitive"]:
            row["file_name"] = "Hidden (Sensitive)"
            row["file_url"] = "Hidden"
            row["file_path"] = "Hidden"
            row["comment"] = "Hidden"
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


def render_my_sensitive_documents(current_user):
    role_guard(["individual"])
    st.header("My Sensitive Documents")

    signer_entity = fetch_one(
        "SELECT * FROM entities WHERE entity_type = 'Signer' AND name = ? LIMIT 1",
        (current_user["full_name"],),
    )
    if not signer_entity:
        st.warning("No signer entity mapped to your profile yet. Ask an admin to create one with your full name.")
        return

    sensitive_types = fetch_all("SELECT * FROM document_types WHERE is_sensitive = 1 ORDER BY name")
    if not sensitive_types:
        st.info("No sensitive document types configured.")
        return

    labels = [d["name"] for d in sensitive_types]
    with st.form("my_sensitive_upload"):
        doc_name = st.selectbox("Sensitive Document Type", labels)
        uploaded_file = st.file_uploader("Upload file")
        external_url = st.text_input("Or external URL")
        issuance_date = st.date_input("Issuance Date", value=date.today())
        use_expiration_date = st.checkbox("Set expiration date")
        expiration_date = st.date_input("Expiration Date", value=date.today(), disabled=not use_expiration_date)
        comment = st.text_area("Comment")
        submitted = st.form_submit_button("Save")
        if submitted:
            if not uploaded_file and not external_url.strip():
                st.error("Upload file or provide URL.")
                st.stop()
            doc_type = sensitive_types[labels.index(doc_name)]
            file_name = None
            file_path = None
            if uploaded_file:
                file_name = uploaded_file.name
                safe_name = f"{uuid.uuid4().hex}_{uploaded_file.name}"
                file_path = str(UPLOAD_DIR / safe_name)
                with open(file_path, "wb") as f:
                    f.write(uploaded_file.read())

            ts = now_iso()
            doc_id = new_id()
            execute(
                """
                INSERT INTO entity_documents
                (id, entity_type, entity_id, document_type_id, file_name, file_url, file_path,
                 issuance_date, expiration_date, comment, uploaded_by, uploaded_at, last_updated_by, last_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc_id,
                    "Signer",
                    signer_entity["id"],
                    doc_type["id"],
                    file_name,
                    external_url.strip() or None,
                    file_path,
                    issuance_date.isoformat(),
                    expiration_date.isoformat() if use_expiration_date else None,
                    comment.strip(),
                    current_user["id"],
                    ts,
                    current_user["id"],
                    ts,
                ),
            )
            refresh_requirement_statuses()
            st.success("Sensitive document uploaded.")

    rows = fetch_all(
        """
        SELECT ed.file_name, ed.file_url, dt.name AS document_type, dt.category,
               ed.issuance_date, ed.expiration_date, ed.comment, ed.uploaded_at
        FROM entity_documents ed
        JOIN document_types dt ON dt.id = ed.document_type_id
        WHERE ed.entity_id = ? AND dt.is_sensitive = 1
        ORDER BY datetime(ed.uploaded_at) DESC
        """,
        (signer_entity["id"],),
    )
    st.subheader("My Documents")
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


def render_dashboard(current_user):
    role_guard(["admin", "treasurer", "document_manager"])
    st.header("Document Status Dashboard")

    refresh_requirement_statuses()
    rows = fetch_all(
        """
        SELECT dr.id,
               dr.entity_type,
               e.code AS entity_code,
               e.name AS entity_name,
               rt.name AS request_type,
               dt.name AS document_type,
               dt.is_sensitive,
               dr.document_status AS status,
               dr.is_mandatory,
               dr.assigned_document_manager_id,
               ed.expiration_date,
               ed.uploaded_at,
               ed.issuance_date,
               u.full_name AS uploaded_by,
               r.id AS request_id,
               e.company_group
        FROM document_requirements dr
        JOIN requests r ON r.id = dr.request_id
        JOIN request_types rt ON rt.id = r.request_type_id
        JOIN entities e ON e.id = dr.entity_id
        JOIN document_types dt ON dt.id = dr.document_type_id
        LEFT JOIN entity_documents ed ON ed.id = dr.latest_document_id
        LEFT JOIN users u ON u.id = ed.uploaded_by
        ORDER BY e.entity_type, e.code, dt.name
        """
    )

    if current_user["role"] == "document_manager":
        rows = [r for r in rows if r["assigned_document_manager_id"]]

    managers = fetch_all("SELECT * FROM document_managers")
    users = fetch_all("SELECT * FROM users WHERE is_active = 1")
    user_name_by_id = {u["id"]: u["full_name"] for u in users}
    manager_label_by_id = {}
    for manager in managers:
        assigned_users = parse_json(manager["assigned_users"], [])
        assignee_names = [user_name_by_id.get(uid, uid) for uid in assigned_users]
        manager_label_by_id[manager["id"]] = ", ".join(assignee_names) if assignee_names else manager["id"][:8]

    c1, c2, c3, c4 = st.columns(4)
    entity_filter = c1.selectbox("Entity Type", ["All"] + ENTITY_TYPES)
    status_filter = c2.selectbox("Status", ["All"] + STATUSES)
    req_types = sorted(list({r["request_type"] for r in rows}))
    request_filter = c3.selectbox("Request Type", ["All"] + req_types)
    group_filter = c4.selectbox("Company Group", ["All"] + sorted(list({r.get("company_group") or "" for r in rows})))

    filtered = []
    for row in rows:
        if entity_filter != "All" and row["entity_type"] != entity_filter:
            continue
        if status_filter != "All" and row["status"] != status_filter:
            continue
        if request_filter != "All" and row["request_type"] != request_filter:
            continue
        if group_filter != "All" and (row.get("company_group") or "") != group_filter:
            continue

        if current_user["role"] in ["treasurer", "document_manager"] and row["is_sensitive"]:
            row["uploaded_by"] = "Hidden"

        row["assigned_document_manager_id"] = manager_label_by_id.get(
            row.get("assigned_document_manager_id"), ""
        )
        row["notification"] = "Manual/Scheduled"
        row["actions"] = "Upload / View"
        filtered.append(row)

    display_df = pd.DataFrame(filtered)
    if not display_df.empty:
        display_df["is_mandatory"] = display_df["is_mandatory"].map(lambda x: "Yes" if x else "No")

    st.dataframe(
        display_df,
        width="stretch",
        hide_index=True,
        column_config={
            "id": None,
            "assigned_document_manager_id": st.column_config.TextColumn("Document Manager"),
        },
    )

    st.subheader("Trigger Notification")
    if not filtered:
        st.caption("No requirements to notify.")
        return

    requirement_ids = [r["id"] for r in filtered]
    selected_reqs = st.multiselect("Document Requirement IDs", requirement_ids)
    users_for_notification = fetch_all("SELECT * FROM users WHERE is_active = 1 ORDER BY full_name")
    user_labels = [f"{u['full_name']} ({u['role']})" for u in users_for_notification]
    user_target = st.selectbox("Recipient", user_labels)
    trigger_type = st.selectbox("Trigger Type", ["Manual", "Scheduled"])
    template_id = st.text_input("Notification Template ID")

    if st.button("Send Notification") and selected_reqs:
        recipient = users_for_notification[user_labels.index(user_target)]
        request_ids = [r["request_id"] for r in filtered if r["id"] in selected_reqs]
        execute(
            """
            INSERT INTO notification_logs
            (id, recipient_user_id, notification_template_id, sent_at, trigger_type, request_id, document_requirement_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                recipient["id"],
                template_id.strip() or None,
                now_iso(),
                trigger_type,
                request_ids[0] if request_ids else None,
                to_json(selected_reqs),
            ),
        )
        st.success("Notification log recorded.")


def token_for_integration(integration: dict):
    if not integration.get("authorization_url"):
        return None
    payload = {
        "grant_type": "client_credentials",
        "client_id": integration.get("client_id") or "",
        "client_secret": integration.get("client_secret") or "",
    }
    if integration.get("scope"):
        payload["scope"] = integration["scope"]

    response = requests.post(integration["authorization_url"], data=payload, timeout=15)
    response.raise_for_status()
    body = response.json()
    return body.get("access_token")


def render_api_integrations():
    role_guard(["admin"])
    st.header("API Integrations")

    with st.form("api_integration_form"):
        connection_name = st.text_input("Connection Name")
        authorization_url = st.text_input("Authorization URL")
        api_base_url = st.text_input("API Base URL")
        client_id = st.text_input("Client ID")
        client_secret = st.text_input("Client Secret", type="password")
        scope = st.text_input("Scope")
        auth_type = st.selectbox("Authentication Type", ["OAuth2 Client Credentials"])
        submitted = st.form_submit_button("Save Configuration")

        if submitted and connection_name.strip() and api_base_url.strip():
            ts = now_iso()
            execute(
                """
                INSERT INTO api_integrations
                (id, connection_name, authorization_url, api_base_url, client_id, client_secret, scope, auth_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    connection_name.strip(),
                    authorization_url.strip(),
                    api_base_url.strip().rstrip("/"),
                    client_id.strip(),
                    client_secret,
                    scope.strip(),
                    auth_type,
                    ts,
                    ts,
                ),
            )
            st.success("Configuration saved.")
            st.rerun()

    rows = fetch_all("SELECT * FROM api_integrations ORDER BY datetime(created_at) DESC")
    if not rows:
        st.caption("No integration configured yet.")
        return

    labels = [f"{r['connection_name']} | {r['api_base_url']}" for r in rows]
    selected_label = st.selectbox("Select connection", labels)
    integration = rows[labels.index(selected_label)]

    c1, c2 = st.columns(2)
    if c1.button("Test Connection"):
        try:
            token = token_for_integration(integration)
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            url = f"{integration['api_base_url']}/v1/companies"
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            st.success("Connection successful.")
            st.json({"sample_response": resp.json()})
        except Exception as exc:
            st.error(f"Connection failed: {exc}")

    endpoints = {
        "Companies": "/v1/companies",
        "Accounts": "/v1/accounts",
        "Signers": "/v1/signers",
        "Authorities": "/v1/authorities",
    }
    endpoint_label = c2.selectbox("Import Endpoint", list(endpoints.keys()))

    if st.button("Import Entities"):
        try:
            token = token_for_integration(integration)
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            endpoint = endpoints[endpoint_label]
            url = f"{integration['api_base_url']}{endpoint}"
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            payload = resp.json()

            records = payload if isinstance(payload, list) else payload.get("data", [])
            entity_type_map = {
                "Companies": "Company",
                "Accounts": "Account",
                "Signers": "Signer",
                "Authorities": "Authority",
            }
            entity_type = entity_type_map[endpoint_label]
            inserted = 0

            for item in records:
                code = str(item.get("code") or item.get("id") or f"{entity_type[:3].upper()}-{uuid.uuid4().hex[:6]}")
                exists = fetch_one("SELECT id FROM entities WHERE code = ?", (code,))
                if exists:
                    continue
                ts = now_iso()
                execute(
                    """
                    INSERT INTO entities
                    (id, code, name, entity_type, country, company_group, account_nature, currency, source, metadata, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_id(),
                        code,
                        str(item.get("name") or item.get("fullName") or code),
                        entity_type,
                        str(item.get("country") or ""),
                        str(item.get("companyGroup") or ""),
                        str(item.get("accountNature") or ""),
                        str(item.get("currency") or ""),
                        "API",
                        to_json(item),
                        ts,
                        ts,
                    ),
                )
                inserted += 1

            execute(
                "UPDATE api_integrations SET last_sync_at = ?, updated_at = ? WHERE id = ?",
                (now_iso(), now_iso(), integration["id"]),
            )
            st.success(f"Imported {inserted} {endpoint_label.lower()} records.")
        except Exception as exc:
            st.error(f"Import failed: {exc}")


def render_notifications():
    role_guard(["admin", "treasurer", "document_manager"])
    st.header("Notification Logs")
    rows = fetch_all(
        """
        SELECT nl.id, u.full_name AS recipient, nl.notification_template_id, nl.sent_at,
               nl.trigger_type, nl.request_id, nl.document_requirement_ids
        FROM notification_logs nl
        LEFT JOIN users u ON u.id = nl.recipient_user_id
        ORDER BY datetime(nl.sent_at) DESC
        """
    )
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


def main():
    st.set_page_config(page_title=APP_TITLE, layout="wide")
    init_db()
    seed_data()

    current_user, page = sidebar_login()

    if page == "Overview":
        render_overview()
    elif page == "Request Types":
        render_request_types()
    elif page == "Document Types":
        render_document_types(current_user)
    elif page == "Documentation Rules":
        render_documentation_rules()
    elif page == "Document Managers":
        render_document_managers()
    elif page == "Entities":
        render_entities()
    elif page == "Requests":
        render_requests(current_user)
    elif page == "Upload Documents":
        render_upload_documents(current_user)
    elif page == "Dashboard":
        render_dashboard(current_user)
    elif page == "API Integrations":
        render_api_integrations()
    elif page == "Notifications":
        render_notifications()
    elif page == "My Sensitive Documents":
        render_my_sensitive_documents(current_user)


if __name__ == "__main__":
    main()
