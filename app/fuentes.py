"""Historial de un objeto para el gráfico (misma lógica que netlify/lib/api.ts → historialAhledger).

AHledger /v1/prices/{mercado}/{id}?range=24h|7d|30d|90d: 24 h y 7 días por horas,
30 y 90 días por días. Se pasa tal cual, sin rellenar huecos, y con la atribución.
"""

from __future__ import annotations

import re
from datetime import datetime

RANGOS = ("24h", "7d", "30d", "90d")
ATRIBUCION = {"texto": "Prices from AHledger", "url": "https://ahledger.com"}


class ErrorFuente(Exception):
    pass


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _ms(texto):
    try:
        return int(datetime.fromisoformat(str(texto).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def historial_ahledger(http_get, url_tabla: str, item_id: int, rango: str) -> dict:
    m = re.search(r"/pricetable/([a-z0-9.]+)$", url_tabla or "")
    if not m:
        raise ErrorFuente("Mercado de AHledger mal configurado")
    mercado = m.group(1)
    base = {"fuente": "ahledger", "rango": rango, "nombres": ["Compra mínima", "Mediana"], "med7": None,
            "med30": None, "atribucion": ATRIBUCION, "nota": None}
    try:
        r = http_get(f"https://api.ahledger.com/v1/prices/{mercado}/{item_id}?range={rango}")
    except Exception as exc:
        raise ErrorFuente(f"No se pudo consultar AHledger: {exc}") from exc
    if r.status_code == 404:
        return {**base, "paso_ms": None, "puntos": [], "cantidad": [], "ultimo": None, "ventas": None}
    if r.status_code != 200:
        raise ErrorFuente(f"AHledger respondió HTTP {r.status_code}")
    j = r.json()
    if j.get("market") != mercado:
        raise ErrorFuente("AHledger devolvió otro mercado")
    serie = [(s, _ms(s.get("t"))) for s in (j.get("series") or []) if isinstance(s, dict)]
    serie = [(s, t) for s, t in serie if t is not None]
    l = j.get("latest")
    ventas = j.get("sales") or {}
    return {
        **base,
        "paso_ms": 3600_000 if rango in ("24h", "7d") else 86_400_000,
        "puntos": [[t, _num(s.get("min")), _num(s.get("median"))] for s, t in serie],
        "cantidad": [[t, _num(s.get("quantity"))] for s, t in serie],
        "ultimo": None if not l else {
            "hora": l.get("observedAt"), "precio": _num(l.get("minBuyout")), "mediana": _num(l.get("median")),
            "cantidad": _num(l.get("quantity")), "subastas": _num(l.get("auctions")),
            "mediana7d": _num(l.get("median7d")), "mediana30d": _num(l.get("median30d")),
            "mediana90d": _num(l.get("median90d")), "origen": l.get("source") if isinstance(l.get("source"), str) else None,
        },
        "ventas": {"por_dia": ventas["estimatedPerDay"], "dias": ventas.get("windowDays")}
        if isinstance(ventas.get("estimatedPerDay"), (int, float)) else None,
    }


def historial_propio(h: dict | None, rango: str, cantidad: list | None = None) -> dict:
    return {
        "fuente": "propio", "rango": rango, "paso_ms": None, "nombres": ["Compra mínima", "Valor de mercado"],
        "puntos": (h or {}).get("puntos") or [], "cantidad": cantidad or None, "med7": (h or {}).get("med7"),
        "med30": (h or {}).get("med30"), "ultimo": None,
        "nota": "El historial propio se guarda como máximo 60 días." if rango == "90d" else None,
    }
