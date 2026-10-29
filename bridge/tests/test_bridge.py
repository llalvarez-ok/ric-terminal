"""Pruebas del puente contra el MT5 simulado: python -m pytest bridge/tests"""

import importlib
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

AQUI = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AQUI))

import ric_bridge as rb  # noqa: E402

TOKEN = "x" * 32
H = {"x-ric-token": TOKEN}


@pytest.fixture()
def env(tmp_path):
    import mt5_simulado

    mt5 = importlib.reload(mt5_simulado)
    bridge = rb.Bridge(mt5, "prueba", None, {"max_riesgo_pct": 2.0, "max_lotes": 5}, tmp_path)
    assert bridge.connect()
    client = TestClient(rb.create_app(bridge, TOKEN))
    return mt5, bridge, client


def cid():
    return uuid.uuid4().hex


def test_redondeo_de_volumen():
    assert rb.round_volume(0.29, 0.01, 0.01) == 0.29
    assert rb.round_volume(0.2999, 0.01, 0.01) == 0.29
    assert rb.round_volume(0.004, 0.01, 0.01) == 0.0
    assert rb.round_volume(1.26, 0.1, 0.1) == 1.2


def test_niveles():
    assert rb.validate_levels("compra", 100, 99, 102, 0.1) == []
    assert "obligatorio" in rb.validate_levels("compra", 100, 0, None, 0.1)[0]
    assert "debajo" in rb.validate_levels("compra", 100, 101, None, 0.1)[0]
    assert "arriba" in rb.validate_levels("venta", 100, 99, None, 0.1)[0]
    assert "cerca" in rb.validate_levels("compra", 100, 99.95, None, 0.1)[0]
    assert rb.validate_pending_price("compra", "limite", 99, 100, 100.1) == []
    assert rb.validate_pending_price("compra", "limite", 101, 100, 100.1)
    assert rb.validate_pending_price("venta", "stop", 99, 100, 100.1) == []


def test_tope_por_minuto():
    lim = rb.RateLimiter(2)
    assert lim.allow(0) and lim.allow(1)
    assert not lim.allow(2)
    assert lim.allow(61.5)


def test_token_obligatorio(env):
    _, _, client = env
    assert client.get("/estado").status_code == 401
    assert client.get("/estado", headers={"x-ric-token": "malo"}).status_code == 401
    r = client.get("/estado", headers=H)
    assert r.status_code == 200
    assert r.json()["balance"] == 1000.0


def test_calculo_por_riesgo(env):
    mt5, _, client = env
    tick = mt5.symbol_info_tick("XAUUSD")
    sl = round(tick.ask - 5, 2)  # 5 USD por onza; 1 lote = 100 onzas → 500 USD por lote
    r = client.post("/calcular", headers=H, json={"symbol": "XAUUSD", "lado": "compra", "sl": sl, "riesgo_pct": 1}).json()
    assert r["errores"] == []
    assert r["volumen"] == 0.02  # 1 % de 1000 = 10 USD → 0,02 lotes
    assert r["riesgo"] == pytest.approx(10, rel=0.05)


def test_orden_sin_sl_rechazada(env):
    _, _, client = env
    r = client.post("/orden", headers=H, json={"client_id": cid(), "symbol": "EURUSD", "lado": "compra", "volumen": 0.01, "sl": 0})
    assert r.json()["ok"] is False
    assert "obligatorio" in r.json()["mensaje"]


def test_orden_que_supera_el_riesgo_rechazada(env):
    mt5, _, client = env
    tick = mt5.symbol_info_tick("XAUUSD")
    r = client.post("/orden", headers=H, json={"client_id": cid(), "symbol": "XAUUSD", "lado": "compra",
                                               "volumen": 1, "sl": round(tick.ask - 5, 2)}).json()
    assert r["ok"] is False
    assert "riesgo" in r["mensaje"]


def test_orden_ejecutada_y_cerrada(env, tmp_path):
    mt5, bridge, client = env
    tick = mt5.symbol_info_tick("EURUSD")
    body = {"client_id": cid(), "symbol": "EURUSD", "lado": "venta", "volumen": 0.05,
            "sl": round(tick.bid + 0.0030, 5), "tp": round(tick.bid - 0.0060, 5)}
    r = client.post("/orden", headers=H, json=body).json()
    assert r["ok"], r
    again = client.post("/orden", headers=H, json=body).json()
    assert again.get("duplicada") is True
    pos = client.get("/posiciones", headers=H).json()["posiciones"]
    assert len(pos) == 1 and pos[0]["lado"] == "venta" and pos[0]["de_ric"]
    m = client.post("/modificar", headers=H, json={"ticket": pos[0]["ticket"], "sl": round(tick.bid + 0.0020, 5)}).json()
    assert m["ok"], m
    c = client.post("/cerrar", headers=H, json={"ticket": pos[0]["ticket"]}).json()
    assert c["ok"], c
    assert client.get("/posiciones", headers=H).json()["posiciones"] == []
    eventos = [e["evento"] for e in client.get("/diario", headers=H).json()]
    assert eventos == ["orden_enviada", "orden_resultado", "modificacion", "cierre"]


def test_pendiente_y_cancelacion(env):
    mt5, _, client = env
    tick = mt5.symbol_info_tick("XAGUSD")
    r = client.post("/orden", headers=H, json={"client_id": cid(), "symbol": "XAGUSD", "lado": "compra", "tipo": "limite",
                                               "precio": round(tick.ask * 0.99, 3), "volumen": 0.01,
                                               "sl": round(tick.ask * 0.98, 3)}).json()
    assert r["ok"] and r["codigo"] == 10008, r
    pend = client.get("/posiciones", headers=H).json()["pendientes"]
    assert len(pend) == 1 and pend[0]["tipo"] == "limite"
    assert client.post("/cancelar", headers=H, json={"ticket": pend[0]["ticket"]}).json()["ok"]


def test_pausa_y_algo_trading(env):
    mt5, _, client = env
    tick = mt5.symbol_info_tick("EURUSD")
    body = lambda: {"client_id": cid(), "symbol": "EURUSD", "lado": "compra", "volumen": 0.01, "sl": round(tick.ask - 0.003, 5)}
    client.post("/pausa", headers=H, json={"pausado": True})
    assert "pausa" in client.post("/orden", headers=H, json=body()).json()["mensaje"]
    client.post("/pausa", headers=H, json={"pausado": False})
    mt5._set_trade_allowed(False)
    assert "Algo Trading" in client.post("/orden", headers=H, json=body()).json()["mensaje"]
    mt5._set_trade_allowed(True)
    assert client.post("/orden", headers=H, json=body()).json()["ok"]


def test_cerrar_todo(env):
    mt5, _, client = env
    for sym, dist in (("EURUSD", 0.003), ("XAUUSD", 5)):
        t = mt5.symbol_info_tick(sym)
        client.post("/orden", headers=H, json={"client_id": cid(), "symbol": sym, "lado": "compra", "volumen": 0.01,
                                               "sl": round(t.ask - dist, 5)})
    r = client.post("/cerrar-todo", headers=H).json()
    assert r["ok"] and r["pausado"] and len(r["resultados"]) == 2
    assert client.get("/posiciones", headers=H).json()["posiciones"] == []


def test_tope_de_ordenes(env):
    mt5, bridge, client = env
    bridge.limiter = rb.RateLimiter(2)
    t = mt5.symbol_info_tick("EURUSD")
    res = [client.post("/orden", headers=H, json={"client_id": cid(), "symbol": "EURUSD", "lado": "compra", "volumen": 0.01,
                                                  "sl": round(t.ask - 0.003, 5)}).json() for _ in range(3)]
    assert [r["ok"] for r in res] == [True, True, False]
    assert "por minuto" in res[2]["mensaje"]


def test_velas_y_cotizaciones(env):
    _, _, client = env
    v = client.get("/velas", headers=H, params={"symbol": "XAUUSD", "tf": "H1", "n": 100}).json()
    assert len(v) == 100 and v[-1]["time"] > v[0]["time"]
    q = client.get("/cotizaciones", headers=H, params={"symbols": "EURUSD,XAUUSD,NOEXISTE"}).json()
    assert [x["symbol"] for x in q] == ["EURUSD", "XAUUSD"]
    assert q[0]["ask"] > q[0]["bid"]
