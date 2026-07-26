# -*- coding: utf-8 -*-
"""Build fictional Nordix org seed from hierarchy shape of private Structa data.
Does NOT copy real FIOs or company names.
"""
from __future__ import annotations

import hashlib
import json
import random
import uuid
from pathlib import Path

SRC = Path(r"D:/projects/OrgStructure/data/org-from-vacation-2026.json")
OUT_JS = Path(r"D:/projects/structa-demo/assets/js/seed-demo.js")
OUT_JSON = Path(r"D:/projects/structa-demo/data/nordix-demo.json")

COMPANY_MAP = {
    "Вирту Финтех": "Axiom FinTech",
    'ООО "ВИРТУ СИСТЕМС"': 'ООО «НОРДИКС СИСТЕМС»',
    "ООО «ВИРТУ СИСТЕМС»": "ООО «НОРДИКС СИСТЕМС»",
    'ООО "КОММ КЛАУД"': 'ООО «КЛАУДКОР»',
    "ООО «КОММ КЛАУД»": "ООО «КЛАУДКОР»",
}

LAST = [
    "Орлов", "Белов", "Сорокин", "Тихонов", "Лебедев", "Гордеев", "Макаров",
    "Новиков", "Фролов", "Киселев", "Егоров", "Савельев", "Лапин", "Жуков",
    "Комаров", "Беляев", "Тарасов", "Морозов", "Власов", "Семенов", "Данилов",
    "Громов", "Панин", "Зуев", "Карпов", "Мишин", "Родионов", "Анисимов",
]
FIRST_M = ["Артём", "Илья", "Кирилл", "Роман", "Павел", "Денис", "Максим", "Егор", "Никита", "Андрей"]
FIRST_F = ["Алина", "Мария", "Екатерина", "Дарья", "Полина", "Ольга", "Анна", "Виктория", "София", "Юлия"]
PATR_M = ["Александрович", "Сергеевич", "Дмитриевич", "Андреевич", "Игоревич", "Николаевич"]
PATR_F = ["Александровна", "Сергеевна", "Дмитриевна", "Андреевна", "Игоревна", "Николаевна"]

PASSWORD_HASH = hashlib.sha256(b"demo123").hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4()}"


def fake_fio(rng: random.Random, female_bias: float = 0.45) -> tuple[str, bool]:
    female = rng.random() < female_bias
    last = rng.choice(LAST)
    if female and not last.endswith("а"):
        # simple feminize for common -ов/-ев/-ин
        if last.endswith(("ов", "ев", "ёв", "ин")):
            last = last + "а"
    first = rng.choice(FIRST_F if female else FIRST_M)
    patr = rng.choice(PATR_F if female else PATR_M)
    return f"{last} {first} {patr}", female


def walk_depts(node: dict, fn):
    fn(node)
    for c in node.get("children") or []:
        walk_depts(c, fn)


def transform(src: dict) -> dict:
    rng = random.Random(20260726)
    id_map: dict[str, str] = {}

    def remap_tree(node: dict) -> dict:
        nid = new_id("dep")
        id_map[node["id"]] = nid
        name = COMPANY_MAP.get(node.get("name", ""), node.get("name", ""))
        # keep department names (generic org labels)
        children = [remap_tree(c) for c in (node.get("children") or [])]
        employees = []
        for e in node.get("employees") or []:
            eid = new_id("emp")
            id_map[e["id"]] = eid
            fio, _ = fake_fio(rng)
            mat = bool(e.get("maternityLeave"))
            if mat and "(Декрет)" not in fio:
                fio = fio + " (Декрет)"
            employees.append(
                {
                    "id": eid,
                    "managerId": e.get("managerId"),  # remap later
                    "fio": fio,
                    "role": e.get("role") or "Специалист",
                    "level": e.get("level") or "Middle",
                    "hireDate": "",
                    "phone": "",
                    "email": "",
                    "employmentForm": e.get("employmentForm") or "Трудовой договор",
                    "personType": e.get("personType") or "ФЛ",
                    "maternityLeave": mat,
                    "notes": "",
                }
            )
        return {
            "id": nid,
            "name": name,
            "children": children,
            "employees": employees,
        }

    companies = [remap_tree(c) for c in src.get("companies") or []]

    def fix_managers(node: dict):
        for e in node.get("employees") or []:
            mid = e.get("managerId")
            e["managerId"] = id_map.get(mid) if mid else None
        for c in node.get("children") or []:
            fix_managers(c)

    for co in companies:
        fix_managers(co)

    return {
        "meta": {
            "name": "StructaData",
            "version": 3,
            "source": "nordix-demo-synthetic",
            "passwordHash": PASSWORD_HASH,
            "demo": True,
            "disclaimer": "Fictional company Nordix / Axiom / CloudCore. No real employer data.",
        },
        "companies": companies,
    }


def main():
    src = json.loads(SRC.read_text(encoding="utf-8"))
    data = transform(src)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_JS.write_text(
        "window.VACATION_SEED = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    # counts
    n_emp = 0

    def count(n):
        nonlocal n_emp
        n_emp += len(n.get("employees") or [])
        for c in n.get("children") or []:
            count(c)

    for co in data["companies"]:
        count(co)
        print(co["name"])
    print("employees", n_emp)
    print("wrote", OUT_JS)


if __name__ == "__main__":
    main()
