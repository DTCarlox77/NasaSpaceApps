# -*- coding: utf-8 -*-
"""Genera backend/docs/catalogo-indicadores.md y backend/docs/catalogo-indicadores.json.
Uso (desde backend/): python3 tools/build_catalog.py [--blocks 1,2,3]
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import catalog_data as D  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
VERSION = 1
DATE = "2026-11-14"

LEVEL_ES = {"critical": "🔴 Crítico", "caution": "🟡 Precaución", "normal": "🟢 Normal", "unrated": "⚪ Sin evaluar"}
ESC_ES = {"self_care": "Autocuidado", "crew": "Tripulación", "flight_surgeon": "Flight surgeon",
          "behavioral_health": "Salud conductual (confidencial)"}
BASIS_ES = {"source": "Fuente", "source_adapted": "Fuente adaptada", "design_rule": "Regla de diseño",
            "pending_source": "Pendiente de fuente"}
VTYPE_ES = {"simple": "simple", "composite": "compuesto", "boolean": "sí/no", "scale": "escala", "catalog": "catálogo"}
SENS_ES = {"standard": "Estándar", "confidential": "**Confidencial**"}
INPUT_ES = {"manual": "manual", "camera": "foto (cámara)", "wearable": "pulsera", "sensor": "sensor (simulado)",
            "slider": "deslizador", "questionnaire": "cuestionario", "minigame": "minijuego", "clicks": "clics"}
OPS = {"lt": "<", "lte": "≤", "gt": ">", "gte": "≥", "eq": "=", "in": "∈", "has_any": "incluye", "between": "entre"}
BLOCK_TITLE = {
    1: "Bloque 1 · MVP: signos vitales, glucosa, sueño, radiación y CO₂",
    2: "Bloque 2 · MVP: bienestar (confidencial)",
    3: "Bloque 3 · Resto: masa, ejercicio, visión, síntomas y hábitat",
}


def render_value(v):
    if v is True:
        return "sí"
    if v is False:
        return "no"
    if isinstance(v, list):
        if sorted(v) == sorted(D.RED_FLAGS):
            return "alguna señal de alarma (`red_flag`)"
        if sorted(v) == sorted(D.INFECTION_LIKE):
            return "algún síntoma tipo infección"
        if len(v) > 8:
            return "otro síntoma del catálogo (lista completa en el JSON)"
        return ", ".join(f"`{x}`" for x in v)
    return str(v)


def render_when(w, top=True):
    if "field" in w:
        op = w["op"]
        if op == "between":
            return f"`{w['field']}` entre {w['value'][0]} y {w['value'][1]}"
        if op == "has_any":
            return f"`{w['field']}` incluye {render_value(w['value'])}"
        if op == "eq":
            return f"`{w['field']}` = {render_value(w['value'])}"
        return f"`{w['field']}` {OPS[op]} {render_value(w['value'])}"
    key = "any" if "any" in w else "all"
    items = w[key]
    if not items:
        return "en otro caso"
    sep = " o " if key == "any" else " y "
    s = sep.join(render_when(x, False) for x in items)
    return s if top or len(items) == 1 else f"({s})"


def used_sources(ind):
    ids = []
    for r in ind["rules"]:
        for s in r["source_ids"]:
            if s not in ids:
                ids.append(s)
    for s in ind.get("extra_sources", []):
        if s not in ids:
            ids.append(s)
    return ids


def to_json(ind):
    out = {
        "code": ind["code"], "name": ind["name"], "unit": ind["unit"], "value_type": ind["value_type"],
        "components": ind["components"], "derived_fields": ind["derived_fields"],
        "hazards": ind["hazards"], "body_zone": ind["body_zone"], "input_methods": ind["input_methods"],
        "sensitivity": ind["sensitivity"], "rules_version": VERSION,
    }
    if "direction" in ind:
        out["direction"] = ind["direction"]
    out["guide"] = ind["guide"]
    out["rules"] = ind["rules"]
    out["sources"] = [{"id": s, "title": D.SOURCES[s][0], "url": D.SOURCES[s][1]} for s in used_sources(ind)]
    if ind.get("notes"):
        out["notes"] = ind["notes"]
    return out


def ficha(ind):
    L = []
    L.append(f"### `{ind['code']}` · {ind['name']}")
    comps = ", ".join(
        f"`{c['name']}`" + (f" ({c['unit']})" if c.get("unit") else "") + (" *contexto*" if c["role"] == "context" else "")
        for c in ind["components"])
    L.append("")
    L.append("| Campo | Valor |")
    L.append("|---|---|")
    L.append(f"| Unidad · tipo | {ind['unit']} · {VTYPE_ES[ind['value_type']]} |")
    L.append(f"| Componentes | {comps} |")
    if ind["derived_fields"]:
        L.append("| Campos derivados (los calcula el motor) | " +
                 "<br>".join(f"`{d['name']}`: {d['how']}" for d in ind["derived_fields"]) + " |")
    L.append(f"| Peligro(s) RIDGE | {', '.join(D.HAZARDS[h] for h in ind['hazards'])} |")
    L.append(f"| Zona del cuerpo | `{ind['body_zone']}` ({D.BODY_ZONES[ind['body_zone']]}) |")
    L.append(f"| Entrada | {', '.join(INPUT_ES[i] for i in ind['input_methods'])} |")
    L.append(f"| Sensibilidad | {SENS_ES[ind['sensitivity']]} |")
    L.append("")
    g = ind["guide"]
    L.append("**Las 5 preguntas del reto**")
    L.append("")
    L.append(f"1. **¿Se puede medir en el espacio? ¿Cómo?** {g['measurable']}")
    L.append(f"2. **¿Por qué es necesario?** {g['why']}")
    L.append(f"3. **¿Cómo lo afectan los peligros?** {g['hazard_effect']}")
    L.append(f"4. **¿Cuándo requiere a la tripulación o al flight surgeon?** {g['when_to_escalate']}")
    L.append(f"5. **¿Qué acciones previenen lo crítico?** {g['prevention']}")
    L.append("")
    L.append("**Umbrales** (se evalúan en orden; gana la primera regla que se cumple)")
    L.append("")
    L.append("| # | Nivel | Condición | Recomendación al astronauta | Escalamiento | Base | Fuentes |")
    L.append("|---|---|---|---|---|---|---|")
    for i, r in enumerate(ind["rules"], 1):
        basis = BASIS_ES[r["basis"]]
        if r.get("note"):
            basis += f" — {r['note']}"
        srcs = ", ".join(f"[{s}]({D.SOURCES[s][1]})" for s in r["source_ids"])
        L.append(f"| {i} | {LEVEL_ES[r['level']]} | {render_when(r['when'])} | {r['recommendation']} | "
                 f"{ESC_ES[r['escalation']]} | {basis} | {srcs} |")
    if ind.get("notes"):
        L.append("")
        for n in ind["notes"]:
            L.append(f"> {n}")
    L.append("")
    return "\n".join(L)


def build(blocks):
    inds = [i for i in D.INDICATORS if i["block"] in blocks]
    md = []
    md.append("# Catálogo de indicadores · umbrales, reglas y fuentes")
    md.append("")
    md.append(f"> Versión de reglas **v{VERSION}** · {DATE} · Autor: persona B (rama `backend`).  ")
    md.append("> Archivo **generado** por `backend/tools/build_catalog.py` desde `backend/tools/catalog_data.py`. No editar a mano: cambiar los datos y regenerar.  ")
    md.append("> **Apoyo a la decisión, no diagnóstico.** Los textos al astronauta describen el valor y la acción; nunca nombran una enfermedad.  ")
    md.append("> Datos de demo: sintéticos (`synthetic = true`).")
    md.append("")
    md.append(f"Bloques incluidos en esta versión: {', '.join(str(b) for b in sorted(blocks))}.")
    md.append("")
    md.append("## 1. Cómo leer este catálogo")
    md.append("")
    md.append("**Niveles del semáforo:** `normal`, `caution` (precaución), `critical` y `unrated` (sin evaluar: medición no válida o sin línea base todavía).")
    md.append("")
    md.append("**Orden de reglas:** cada indicador tiene una lista ordenada de la más grave a la menos grave. El motor evalúa en orden y **gana la primera que se cumple**. La última regla tiene `when: {\"all\": []}` (grupo vacío = siempre verdadero) y actúa como valor por defecto.")
    md.append("")
    md.append("**Campo ausente:** si una condición usa un campo que no viene en la lectura (por ejemplo, `avg_7d` sin historial), esa condición es **falsa**. Así una regla nunca se dispara por falta de datos.")
    md.append("")
    md.append("**Escalamiento** (de menor a mayor):")
    md.append("")
    md.append("| Valor | Significado |")
    md.append("|---|---|")
    md.append("| `self_care` | Solo el astronauta: guía de autocuidado. |")
    md.append("| `crew` | Se notifica al oficial médico de a bordo (físico, no confidencial). |")
    md.append("| `flight_surgeon` | Se envía a Tierra con `compute_deliver_at`. Si el nivel es `critical`, **también** se notifica a la tripulación a bordo, porque Tierra llega con retraso. |")
    md.append("| `behavioral_health` | Solo para indicadores confidenciales. Va únicamente a `behavioral_health`, **nunca** a la tripulación ni a `admin`. |")
    md.append("")
    md.append("**Base de cada regla (`basis`):**")
    md.append("")
    md.append("| Valor | Significado |")
    md.append("|---|---|")
    md.append("| `source` | El número sale tal cual de la fuente citada. |")
    md.append("| `source_adapted` | El número sale de la fuente, pero el nivel, la población o el contexto los adaptamos nosotros (se explica en la nota). |")
    md.append("| `design_rule` | Regla de diseño **sin fuente directa**: configurable desde el panel y pendiente de validar con el flight surgeon o con salud conductual. |")
    md.append("| `pending_source` | Falta fuente. No se carga como activa. |")
    md.append("")
    md.append("## 2. Cambios necesarios en el evaluador (`src/engine`)")
    md.append("")
    md.append("`src/engine/triage.js` hoy soporta `eq`, `in` y `has_any`. El catálogo necesita además **`lt`, `lte`, `gt`, `gte` y `between`**, y grupos **anidados** `any`/`all`. Se agrega `src/engine/conditions.js` (incluido junto a este documento) con todos los operadores; `triage.js` puede importar `evalCondition` de ahí para que el triaje y el semáforo usen **el mismo evaluador** en el dispositivo y en el servidor.")
    md.append("")
    md.append("| Operador | Tipo de `value` | Ejemplo |")
    md.append("|---|---|---|")
    md.append("| `eq` | cualquiera | `{\"field\":\"fasting\",\"op\":\"eq\",\"value\":true}` |")
    md.append("| `in` | lista | `{\"field\":\"period\",\"op\":\"in\",\"value\":[\"sleep\"]}` |")
    md.append("| `has_any` | lista (el campo también es lista) | `{\"field\":\"symptoms\",\"op\":\"has_any\",\"value\":[\"chest_pain\"]}` |")
    md.append("| `lt` / `lte` / `gt` / `gte` | número | `{\"field\":\"systolic\",\"op\":\"gt\",\"value\":180}` |")
    md.append("| `between` | `[min, max]` inclusivo | `{\"field\":\"value\",\"op\":\"between\",\"value\":[36.1,37.9]}` |")
    md.append("")
    md.append("**Campos derivados:** algunas reglas usan campos que no vienen del dispositivo (`ratio_to_baseline`, `adverse_z_3d`, `consecutive_nights_le_6h`, etc.). Los calcula el motor (persona B) a partir del historial antes de evaluar las reglas. Cada ficha dice cómo se calcula cada uno.")
    md.append("")
    md.append("## 3. Catálogos compartidos (para los seeds)")
    md.append("")
    md.append("**Peligros (`hazards`)**")
    md.append("")
    md.append("| Código | RIDGE |")
    md.append("|---|---|")
    for k, v in D.HAZARDS.items():
        md.append(f"| `{k}` | {v} |")
    md.append("")
    md.append("**Zonas del cuerpo (`body_zones`)**")
    md.append("")
    md.append("| Código | Zona |")
    md.append("|---|---|")
    for k, v in D.BODY_ZONES.items():
        md.append(f"| `{k}` | {v} |")
    md.append("")
    md.append("**Síntomas (`symptoms`)** — se usan en `SYMPTOM` y como contexto en otros indicadores.")
    md.append("")
    md.append("| Código | Texto | Zona | Señal de alarma |")
    md.append("|---|---|---|---|")
    for k, (t, z, rf) in D.SYMPTOMS.items():
        md.append(f"| `{k}` | {t} | `{z}` | {'sí' if rf else ''} |")
    md.append("")
    md.append("## 4. Resumen")
    md.append("")
    md.append("| Bloque | Código | Indicador | Unidad | Peligro | Zona | Sensibilidad | Reglas sin fuente directa |")
    md.append("|---|---|---|---|---|---|---|---|")
    for i in inds:
        n_design = sum(1 for r in i["rules"] if r["basis"] in ("design_rule", "pending_source"))
        md.append(f"| {i['block']} | `{i['code']}` | {i['name']} | {i['unit']} | "
                  f"{', '.join(D.HAZARDS[h] for h in i['hazards'])} | `{i['body_zone']}` | {SENS_ES[i['sensitivity']]} | {n_design} |")
    md.append("")
    md.append("## 5. Fichas")
    md.append("")
    for b in sorted(blocks):
        md.append(f"## {BLOCK_TITLE[b]}")
        md.append("")
        for i in inds:
            if i["block"] == b:
                md.append(ficha(i))
    md.append("## 6. Reglas de diseño y pendientes de fuente")
    md.append("")
    md.append("Estas reglas no tienen un número publicado detrás. Quedan configurables desde el panel (con auditoría) y deben revisarse con un profesional antes de usarse fuera de la demo.")
    md.append("")
    md.append("| Indicador | Regla | Condición | Nota |")
    md.append("|---|---|---|---|")
    for i in inds:
        for n, r in enumerate(i["rules"], 1):
            if r["basis"] in ("design_rule", "pending_source"):
                md.append(f"| `{i['code']}` | #{n} | {render_when(r['when'])} | {r.get('note', '')} |")
    md.append("")
    md.append("**Otros pendientes**")
    md.append("")
    for i in inds:
        for n in i.get("notes", []):
            if "pendiente" in n.lower():
                md.append(f"- `{i['code']}`: {n}")
    md.append("")
    md.append("## 7. Fuentes")
    md.append("")
    md.append("Todas las URL se verificaron el 14-nov-2026. NASA no respalda entidades que no son del gobierno de EE. UU.; las fuentes no gubernamentales se citan como referencia clínica.")
    md.append("")
    ids = []
    for i in inds:
        for s in used_sources(i):
            if s not in ids:
                ids.append(s)
    for s in ids:
        md.append(f"- `{s}` — [{D.SOURCES[s][0]}]({D.SOURCES[s][1]})")
    md.append("")
    md.append("## 8. Reglas como datos (JSON por indicador)")
    md.append("")
    md.append("Mismo contenido que `backend/docs/catalogo-indicadores.json` (que además trae los catálogos de peligros, zonas y síntomas). Forma acordada + campos agregados: `basis`, `note`, `guide` (las 5 preguntas), `derived_fields`, `rules_version` y `notes`.")
    md.append("")
    for i in inds:
        md.append(f"### `{i['code']}`")
        md.append("")
        md.append("```json")
        md.append(json.dumps(to_json(i), ensure_ascii=False, indent=2))
        md.append("```")
        md.append("")

    full = {
        "catalog_version": VERSION, "generated_at": DATE, "blocks": sorted(blocks),
        "hazards": [{"code": k, "name": v} for k, v in D.HAZARDS.items()],
        "body_zones": [{"code": k, "name": v} for k, v in D.BODY_ZONES.items()],
        "symptoms": [{"code": k, "label": t, "body_zone": z, "red_flag": rf} for k, (t, z, rf) in D.SYMPTOMS.items()],
        "indicators": [to_json(i) for i in inds],
    }
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "catalogo-indicadores.md").write_text("\n".join(md), encoding="utf-8")
    (DOCS / "catalogo-indicadores.json").write_text(json.dumps(full, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(inds)} indicadores, {sum(len(i['rules']) for i in inds)} reglas, {len(ids)} fuentes")


if __name__ == "__main__":
    blocks = {1, 2, 3}
    if len(sys.argv) > 2 and sys.argv[1] == "--blocks":
        blocks = {int(x) for x in sys.argv[2].split(",")}
    # Validaciones básicas
    for i in D.INDICATORS:
        for r in i["rules"]:
            assert r["level"] in LEVEL_ES, (i["code"], r)
            assert r["escalation"] in ESC_ES, (i["code"], r)
            assert r["basis"] in BASIS_ES, (i["code"], r)
            for s in r["source_ids"]:
                assert s in D.SOURCES, (i["code"], s)
            if i["sensitivity"] == "confidential":
                assert r["escalation"] in ("self_care", "behavioral_health", "flight_surgeon"), (i["code"], r)
                assert r["escalation"] != "crew", i["code"]
        assert i["rules"][-1]["when"] == {"all": []}, f"{i['code']}: falta regla por defecto"
        for h in i["hazards"]:
            assert h in D.HAZARDS
        assert i["body_zone"] in D.BODY_ZONES
    build(blocks)
