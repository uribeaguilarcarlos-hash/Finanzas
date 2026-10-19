import json
import shutil
from pathlib import Path
from app.server import (
    list_statements,
    get_statement_detail,
    get_statement_diff,
    audit_statement_vs_concentrado,
    CONCENTRADO_PATH,
)

STATIC_DIR = Path(__file__).resolve().parent / "app" / "static"
DATA_DIR = STATIC_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "detail").mkdir(parents=True, exist_ok=True)
(DATA_DIR / "diff").mkdir(parents=True, exist_ok=True)
(DATA_DIR / "concentrado").mkdir(parents=True, exist_ok=True)


def main():
    print("Exporting static JSON bundle for Azure Static Web Apps...")
    stmts_payload = list_statements()
    statements = stmts_payload["statements"]

    with open(DATA_DIR / "statements.json", "w", encoding="utf-8") as f:
        json.dump(stmts_payload, f, ensure_ascii=False)

    ref_history_map = {}

    # Export details, default diffs, and concentrado overview for each statement
    for s in statements:
        raw_date = s["raw_date"]
        detail = get_statement_detail(raw_date, search=None, customer_for=None, only_extra_charges=False)
        with open(DATA_DIR / "detail" / f"{raw_date}.json", "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False)

        for item in detail["master_items"]:
            rno = item["ref_no"]
            ref_history_map.setdefault(rno, []).append({
                "stmt_date": s["stmt_date"],
                **item,
            })

        diff = get_statement_diff(raw_date, compare_to=None)
        with open(DATA_DIR / "diff" / f"{raw_date}.json", "w", encoding="utf-8") as f:
            json.dump(diff, f, ensure_ascii=False)

        conc = audit_statement_vs_concentrado(raw_date)
        with open(DATA_DIR / "concentrado" / f"{raw_date}.json", "w", encoding="utf-8") as f:
            json.dump(conc, f, ensure_ascii=False)

    # Sort each ref history chronologically (oldest to newest)
    for rno, hist in ref_history_map.items():
        hist.sort(key=lambda x: x["raw_date"])

    with open(DATA_DIR / "ref_history.json", "w", encoding="utf-8") as f:
        json.dump(ref_history_map, f, ensure_ascii=False)

    # Copy Concentrado Excel to static/data so it can be downloaded directly on Static Web App
    if CONCENTRADO_PATH.exists():
        shutil.copy2(CONCENTRADO_PATH, DATA_DIR / CONCENTRADO_PATH.name)

    # Also copy frontend entry files to root so Azure Static Web Apps works whether app_location is "/" or "app/static"
    root_dir = Path(__file__).resolve().parent
    for fname in ("index.html", "styles.css", "app.js", "logo.png", "staticwebapp.config.json"):
        src = STATIC_DIR / fname
        if src.exists():
            shutil.copy2(src, root_dir / fname)

    print(f"Done! Exported {len(statements)} statements and {len(ref_history_map)} reference histories to {DATA_DIR}")


if __name__ == "__main__":
    main()
