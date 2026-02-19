#!/usr/bin/env python3
"""Export SQLite inventions to JSON for Postgres import."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'usaipo-council'))
from usaipo import database as db

conn = db.get_db()
rows = conn.execute('SELECT * FROM inventions ORDER BY id').fetchall()
inventions = []
for row in rows:
    d = dict(row)
    inventions.append(d)
conn.close()

with open(os.path.join(os.path.dirname(__file__), '..', 'data', 'inventions.json'), 'w') as f:
    json.dump(inventions, f, indent=2)
print(f"Exported {len(inventions)} inventions")
