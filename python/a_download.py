from rich import print
import re
from natsort import natsorted
from pathlib import Path
import pandas as pd
import psycopg
from dotenv import load_dotenv
import os
from utils.cache import cache
import requests
from typing import Literal

load_dotenv()


@cache
def get(symbol: str, doc_type: Literal["pdf", "docx"]):
    return requests.get(f"https://documents.un.org/api/symbol/access?s={symbol}&l=en&t={doc_type}")

def get_ppb_symbols(symbol):
    with psycopg.connect(os.getenv("DATABASE_URL")) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT document_symbol FROM digitallibrary.documents WHERE document_symbol LIKE %s", (f"{symbol} (Sect. %", ))
            rows = cur.fetchall()
    return natsorted([row[0] for row in rows])

def download_budget_docs(symbol, year):
    inputs = [
        (f"ppb{year}", get_ppb_symbols(symbol)),
    ]
    for (name, symbols) in inputs:
        print(symbols)
        doc_dir = Path(f"../data/downloads/{name}")
        doc_dir.mkdir(parents=True, exist_ok=True)
        for doc_symbol in symbols:
            for doc_type in ("pdf", "docx",):
                doc_symbol = re.sub(r"/Part .", "", doc_symbol)
                res = get(doc_symbol, doc_type)
                safe_symbol = doc_symbol.replace("/", "_")
                path = doc_dir / f"{safe_symbol}.{doc_type}"
                path.write_bytes(res.content)
                print(f"Saved {path}")
