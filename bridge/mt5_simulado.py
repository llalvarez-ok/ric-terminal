"""MetaTrader 5 simulado, para desarrollar y probar el puente sin Windows.

Imita el subconjunto de la API de MetaTrader5 que usa ric_bridge.py, con las
mismas constantes, nombres de campos y códigos de respuesta. Los precios son
un paseo aleatorio: sirve para probar la mecánica, no para analizar mercado.
"""

from __future__ import annotations

import os
import random
import threading
import time
from types import SimpleNamespace

import numpy as np

# Constantes con los mismos valores que la librería oficial.
ORDER_TYPE_BUY = 0
ORDER_TYPE_SELL = 1
ORDER_TYPE_BUY_LIMIT = 2
ORDER_TYPE_SELL_LIMIT = 3
ORDER_TYPE_BUY_STOP = 4
ORDER_TYPE_SELL_STOP = 5

TRADE_ACTION_DEAL = 1
TRADE_ACTION_PENDING = 5
TRADE_ACTION_SLTP = 6
TRADE_ACTION_MODIFY = 7
TRADE_ACTION_REMOVE = 8

ORDER_TIME_GTC = 0
ORDER_FILLING_FOK = 0
ORDER_FILLING_IOC = 1
ORDER_FILLING_RETURN = 2

POSITION_TYPE_BUY = 0
POSITION_TYPE_SELL = 1

DEAL_ENTRY_IN = 0
DEAL_ENTRY_OUT = 1

TRADE_RETCODE_REQUOTE = 10004
TRADE_RETCODE_PLACED = 10008
TRADE_RETCODE_DONE = 10009
TRADE_RETCODE_INVALID = 10013
TRADE_RETCODE_INVALID_VOLUME = 10014
TRADE_RETCODE_INVALID_PRICE = 10015
TRADE_RETCODE_INVALID_STOPS = 10016
TRADE_RETCODE_NO_MONEY = 10019
TRADE_RETCODE_PRICE_CHANGED = 10020
TRADE_RETCODE_INVALID_FILL = 10030
TRADE_RETCODE_POSITION_CLOSED = 10036

TIMEFRAME_M1 = 1
TIMEFRAME_M5 = 5
TIMEFRAME_M15 = 15
TIMEFRAME_M30 = 30
TIMEFRAME_H1 = 16385
TIMEFRAME_H4 = 16388
TIMEFRAME_D1 = 16408
TIMEFRAME_W1 = 32769

_SECONDS = {
    TIMEFRAME_M1: 60,
    TIMEFRAME_M5: 300,
    TIMEFRAME_M15: 900,
    TIMEFRAME_M30: 1800,
    TIMEFRAME_H1: 3600,
    TIMEFRAME_H4: 14400,
    TIMEFRAME_D1: 86400,
    TIMEFRAME_W1: 604800,
}

# Hora del servidor del bróker: GMT+2, como la mayoría de los brókers de MT5.
SERVER_OFFSET = 2 * 3600

# nombre: (descripción, ruta, dígitos, contrato, precio inicial, spread en puntos, divisa de ganancia)
_CATALOGO = {
    "EURUSD": ("Euro vs US Dollar", "Forex\\Majors\\EURUSD", 5, 100000, 1.0850, 8, "USD"),
    "GBPUSD": ("Great Britain Pound vs US Dollar", "Forex\\Majors\\GBPUSD", 5, 100000, 1.2700, 10, "USD"),
    "USDJPY": ("US Dollar vs Japanese Yen", "Forex\\Majors\\USDJPY", 3, 100000, 151.20, 10, "JPY"),
    "AUDUSD": ("Australian Dollar vs US Dollar", "Forex\\Majors\\AUDUSD", 5, 100000, 0.6550, 9, "USD"),
    "USDCAD": ("US Dollar vs Canadian Dollar", "Forex\\Majors\\USDCAD", 5, 100000, 1.3650, 12, "CAD"),
    "USDCHF": ("US Dollar vs Swiss Franc", "Forex\\Majors\\USDCHF", 5, 100000, 0.8800, 12, "CHF"),
    "XAUUSD": ("Gold vs US Dollar", "Metals\\XAUUSD", 2, 100, 2650.00, 20, "USD"),
    "XAGUSD": ("Silver vs US Dollar", "Metals\\XAGUSD", 3, 5000, 31.200, 25, "USD"),
    "XPTUSD": ("Platinum vs US Dollar", "Metals\\XPTUSD", 2, 100, 980.00, 300, "USD"),
    "XCUUSD": ("Copper vs US Dollar", "Metals\\XCUUSD", 4, 1000, 4.3500, 40, "USD"),
    "BTCUSD": ("Bitcoin vs US Dollar", "Crypto\\BTCUSD", 2, 1, 81000.00, 2000, "USD"),
    "ETHUSD": ("Ethereum vs US Dollar", "Crypto\\ETHUSD", 2, 1, 2360.00, 150, "USD"),
}

_lock = threading.RLock()
_state: dict = {}
_last_error = (1, "Success")


def _now() -> int:
    return int(time.time()) + SERVER_OFFSET


def initialize(path: str | None = None, **_kwargs) -> bool:
    with _lock:
        if _state:
            return True
        rnd = random.Random(42)
        symbols = {}
        # Algunos brókers agregan un sufijo (Exness: XAUUSDm). Se puede imitar con RIC_SIM_SUFIJO.
        suffix = os.environ.get("RIC_SIM_SUFIJO", "")
        for base, (desc, path_, digits, contract, price, spread, cur) in _CATALOGO.items():
            name = base + suffix
            point = 10 ** -digits
            symbols[name] = {
                "name": name,
                "description": desc,
                "path": path_,
                "digits": digits,
                "point": point,
                "contract": contract,
                "mid": price,
                "spread": spread,
                "currency_profit": cur,
                "visible": base in ("EURUSD", "XAUUSD"),
                "history": _history(rnd, price, digits),
            }
        _state.update(
            symbols=symbols,
            balance=1000.0,
            positions={},
            orders={},
            deals=[],
            next_ticket=1000,
            rnd=rnd,
            last_tick=time.time(),
            trade_allowed=True,
        )
        return True


def _history(rnd: random.Random, price: float, digits: int) -> list[tuple]:
    # 400 velas diarias que terminan en el precio inicial.
    closes = [price]
    for _ in range(399):
        closes.append(closes[-1] / (1 + rnd.gauss(0, 0.008)))
    closes.reverse()
    start = (_now() // 86400 - 399) * 86400
    out = []
    for i, c in enumerate(closes):
        o = closes[i - 1] if i else c
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.003)))
        lo = min(o, c) * (1 - abs(rnd.gauss(0, 0.003)))
        out.append((start + i * 86400, round(o, digits), round(h, digits), round(lo, digits), round(c, digits)))
    return out


def shutdown() -> None:
    pass


def last_error():
    return _last_error


def _advance() -> None:
    """Mueve los precios según el tiempo transcurrido y aplica SL, TP y pendientes."""
    now = time.time()
    steps = min(50, int((now - _state["last_tick"]) / 0.25))
    if steps <= 0:
        return
    _state["last_tick"] = now
    rnd = _state["rnd"]
    for s in _state["symbols"].values():
        for _ in range(steps):
            s["mid"] *= 1 + rnd.gauss(0, 0.00012)
    _check_triggers()


def _bid_ask(s: dict) -> tuple[float, float]:
    half = s["spread"] * s["point"] / 2
    return round(s["mid"] - half, s["digits"]), round(s["mid"] + half, s["digits"])


def _info(s: dict) -> SimpleNamespace:
    bid, ask = _bid_ask(s)
    return SimpleNamespace(
        name=s["name"],
        description=s["description"],
        path=s["path"],
        digits=s["digits"],
        point=s["point"],
        spread=s["spread"],
        bid=bid,
        ask=ask,
        visible=s["visible"],
        trade_mode=4,  # SYMBOL_TRADE_MODE_FULL
        trade_contract_size=s["contract"],
        trade_tick_size=s["point"],
        trade_tick_value=s["point"] * s["contract"] / (s["mid"] if s["currency_profit"] != "USD" else 1),
        trade_stops_level=10,
        volume_min=0.01,
        volume_max=100.0,
        volume_step=0.01,
        filling_mode=1 | 2,  # FOK e IOC
        currency_base=s["name"][:3],
        currency_profit=s["currency_profit"],
        currency_margin=s["name"][:3],
    )


def terminal_info():
    with _lock:
        if not _state:
            return None
        return SimpleNamespace(
            connected=True,
            trade_allowed=_state["trade_allowed"],
            name="MetaTrader 5 (simulado)",
            company="Simulado",
            path="simulado",
        )


def account_info():
    with _lock:
        if not _state:
            return None
        _advance()
        profit = sum(_pos_profit(p) for p in _state["positions"].values())
        margin = sum(_margin(p["symbol"], p["volume"]) for p in _state["positions"].values())
        equity = _state["balance"] + profit
        return SimpleNamespace(
            login=12345678,
            server="Simulado-Demo",
            company="Simulado",
            name="Cuenta simulada",
            currency="USD",
            leverage=200,
            balance=round(_state["balance"], 2),
            equity=round(equity, 2),
            profit=round(profit, 2),
            margin=round(margin, 2),
            margin_free=round(equity - margin, 2),
            margin_level=round(equity / margin * 100, 2) if margin else 0.0,
            trade_allowed=True,
            trade_expert=True,
        )


def symbols_get(group: str | None = None):
    with _lock:
        return tuple(_info(s) for s in _state["symbols"].values())


def symbol_info(symbol: str):
    with _lock:
        _advance()
        s = _state["symbols"].get(symbol)
        return _info(s) if s else None


def symbol_info_tick(symbol: str):
    with _lock:
        _advance()
        s = _state["symbols"].get(symbol)
        if not s:
            return None
        bid, ask = _bid_ask(s)
        return SimpleNamespace(time=_now(), bid=bid, ask=ask, last=0.0, volume=0, time_msc=_now() * 1000)


def symbol_select(symbol: str, enable: bool = True) -> bool:
    with _lock:
        s = _state["symbols"].get(symbol)
        if not s:
            return False
        s["visible"] = enable
        return True


_RATES_DTYPE = np.dtype(
    [
        ("time", "<i8"),
        ("open", "<f8"),
        ("high", "<f8"),
        ("low", "<f8"),
        ("close", "<f8"),
        ("tick_volume", "<u8"),
        ("spread", "<i4"),
        ("real_volume", "<u8"),
    ]
)


def copy_rates_from_pos(symbol: str, timeframe: int, start_pos: int, count: int):
    with _lock:
        _advance()
        s = _state["symbols"].get(symbol)
        if not s or timeframe not in _SECONDS:
            return None
        sec = _SECONDS[timeframe]
        daily = s["history"]
        bid, _ = _bid_ask(s)
        now = _now()
        if sec >= 86400:
            rows = [list(r) for r in daily]
            rows[-1][4] = bid
            rows[-1][2] = max(rows[-1][2], bid)
            rows[-1][3] = min(rows[-1][3], bid)
            if sec == 604800:
                weeks: dict[int, list] = {}
                for r in rows:
                    w = r[0] - (r[0] % 604800)
                    if w not in weeks:
                        weeks[w] = [w, r[1], r[2], r[3], r[4]]
                    else:
                        weeks[w][2] = max(weeks[w][2], r[2])
                        weeks[w][3] = min(weeks[w][3], r[3])
                        weeks[w][4] = r[4]
                rows = list(weeks.values())
        else:
            # Velas intradiarias que terminan en el precio actual.
            rnd = random.Random(hash((symbol, timeframe, now // sec)) & 0xFFFF)
            n = start_pos + count
            closes = [bid]
            for _ in range(n - 1):
                closes.append(closes[-1] / (1 + rnd.gauss(0, 0.0004 * (sec / 300) ** 0.5)))
            closes.reverse()
            t0 = now - now % sec - (n - 1) * sec
            rows = []
            for i, c in enumerate(closes):
                o = closes[i - 1] if i else c
                rows.append([t0 + i * sec, o, max(o, c) * 1.0002, min(o, c) * 0.9998, c])
        rows = rows[max(0, len(rows) - start_pos - count) : len(rows) - start_pos or None]
        out = np.zeros(len(rows), dtype=_RATES_DTYPE)
        for i, r in enumerate(rows):
            out[i] = (r[0], r[1], r[2], r[3], r[4], 100 + i, s["spread"], 0)
        return out


def _price_close(p: dict) -> float:
    bid, ask = _bid_ask(_state["symbols"][p["symbol"]])
    return bid if p["type"] == POSITION_TYPE_BUY else ask


def _pnl(symbol: str, is_buy: bool, volume: float, price_open: float, price_close: float) -> float:
    s = _state["symbols"][symbol]
    diff = (price_close - price_open) if is_buy else (price_open - price_close)
    profit = diff * volume * s["contract"]
    if s["currency_profit"] != "USD":
        profit /= price_close
    return profit


def _pos_profit(p: dict) -> float:
    return _pnl(p["symbol"], p["type"] == POSITION_TYPE_BUY, p["volume"], p["price_open"], _price_close(p))


def _margin(symbol: str, volume: float) -> float:
    s = _state["symbols"][symbol]
    notional = volume * s["contract"] * (1 if s["name"].startswith("USD") else s["mid"])
    return notional / 200


def order_calc_profit(action: int, symbol: str, volume: float, price_open: float, price_close: float):
    with _lock:
        if symbol not in _state["symbols"]:
            return None
        return round(_pnl(symbol, action == ORDER_TYPE_BUY, volume, price_open, price_close), 2)


def order_calc_margin(action: int, symbol: str, volume: float, price: float):
    with _lock:
        if symbol not in _state["symbols"]:
            return None
        return round(_margin(symbol, volume), 2)


def positions_get(symbol: str | None = None, ticket: int | None = None):
    with _lock:
        _advance()
        out = []
        for p in _state["positions"].values():
            if symbol and p["symbol"] != symbol:
                continue
            if ticket and p["ticket"] != ticket:
                continue
            out.append(
                SimpleNamespace(
                    **p,
                    price_current=_price_close(p),
                    profit=round(_pos_profit(p), 2),
                    swap=0.0,
                    time_update=p["time"],
                )
            )
        return tuple(out)


def orders_get(symbol: str | None = None, ticket: int | None = None):
    with _lock:
        _advance()
        out = []
        for o in _state["orders"].values():
            if symbol and o["symbol"] != symbol:
                continue
            if ticket and o["ticket"] != ticket:
                continue
            bid, ask = _bid_ask(_state["symbols"][o["symbol"]])
            out.append(SimpleNamespace(**o, price_current=ask if o["type"] in (2, 4) else bid))
        return tuple(out)


def history_deals_get(date_from, date_to, **_kwargs):
    with _lock:
        return tuple(SimpleNamespace(**d) for d in _state["deals"])


def _ticket() -> int:
    _state["next_ticket"] += 1
    return _state["next_ticket"]


def _result(retcode: int, comment: str, **kw) -> SimpleNamespace:
    base = dict(retcode=retcode, comment=comment, order=0, deal=0, volume=0.0, price=0.0, bid=0.0, ask=0.0, request_id=0)
    base.update(kw)
    return SimpleNamespace(**base)


def order_check(request: dict):
    with _lock:
        return _validate(request) or _result(0, "Done")


def _validate(r: dict):
    s = _state["symbols"].get(r.get("symbol", ""))
    if r["action"] in (TRADE_ACTION_DEAL, TRADE_ACTION_PENDING):
        if not s:
            return _result(TRADE_RETCODE_INVALID, "Invalid request")
        if r.get("volume", 0) < 0.01:
            return _result(TRADE_RETCODE_INVALID_VOLUME, "Invalid volume")
        if r["action"] == TRADE_ACTION_DEAL and r.get("type_filling") not in (ORDER_FILLING_FOK, ORDER_FILLING_IOC):
            return _result(TRADE_RETCODE_INVALID_FILL, "Unsupported filling mode")
        acct = account_info()
        if _margin(s["name"], r["volume"]) > acct.margin_free:
            return _result(TRADE_RETCODE_NO_MONEY, "No money")
    return None


def order_send(request: dict):
    with _lock:
        _advance()
        global _last_error
        r = dict(request)
        bad = _validate(r)
        if bad:
            return bad
        action = r["action"]
        if action == TRADE_ACTION_DEAL:
            s = _state["symbols"][r["symbol"]]
            bid, ask = _bid_ask(s)
            price = ask if r["type"] == ORDER_TYPE_BUY else bid
            if "position" in r:
                p = _state["positions"].get(r["position"])
                if not p:
                    return _result(TRADE_RETCODE_POSITION_CLOSED, "Position doesn't exist")
                return _close(p, price, "cierre manual")
            ticket = _ticket()
            _state["positions"][ticket] = dict(
                ticket=ticket,
                identifier=ticket,
                time=_now(),
                type=r["type"],
                magic=r.get("magic", 0),
                volume=r["volume"],
                price_open=price,
                sl=r.get("sl", 0.0),
                tp=r.get("tp", 0.0),
                symbol=r["symbol"],
                comment=r.get("comment", ""),
            )
            _state["deals"].append(
                dict(ticket=_ticket(), order=ticket, position_id=ticket, time=_now(), type=r["type"], entry=DEAL_ENTRY_IN,
                     volume=r["volume"], price=price, profit=0.0, commission=0.0, swap=0.0, symbol=r["symbol"],
                     magic=r.get("magic", 0), comment=r.get("comment", ""))
            )
            return _result(TRADE_RETCODE_DONE, "Request executed", order=ticket, deal=ticket, volume=r["volume"], price=price, bid=bid, ask=ask)
        if action == TRADE_ACTION_PENDING:
            ticket = _ticket()
            _state["orders"][ticket] = dict(
                ticket=ticket,
                time_setup=_now(),
                type=r["type"],
                magic=r.get("magic", 0),
                volume_initial=r["volume"],
                volume_current=r["volume"],
                price_open=r["price"],
                sl=r.get("sl", 0.0),
                tp=r.get("tp", 0.0),
                symbol=r["symbol"],
                comment=r.get("comment", ""),
            )
            return _result(TRADE_RETCODE_PLACED, "Request placed", order=ticket, volume=r["volume"], price=r["price"])
        if action == TRADE_ACTION_SLTP:
            p = _state["positions"].get(r.get("position"))
            if not p:
                return _result(TRADE_RETCODE_POSITION_CLOSED, "Position doesn't exist")
            p["sl"], p["tp"] = r.get("sl", 0.0), r.get("tp", 0.0)
            return _result(TRADE_RETCODE_DONE, "Request executed")
        if action == TRADE_ACTION_REMOVE:
            if _state["orders"].pop(r.get("order"), None) is None:
                return _result(TRADE_RETCODE_INVALID, "Invalid request")
            return _result(TRADE_RETCODE_DONE, "Request executed")
        _last_error = (-2, "Invalid arguments")
        return None


def _close(p: dict, price: float, reason: str):
    profit = _pnl(p["symbol"], p["type"] == POSITION_TYPE_BUY, p["volume"], p["price_open"], price)
    _state["balance"] += profit
    del _state["positions"][p["ticket"]]
    deal = _ticket()
    _state["deals"].append(
        dict(ticket=deal, order=deal, position_id=p["ticket"], time=_now(), type=1 - p["type"], entry=DEAL_ENTRY_OUT,
             volume=p["volume"], price=price, profit=round(profit, 2), commission=0.0, swap=0.0, symbol=p["symbol"],
             magic=p["magic"], comment=reason)
    )
    return _result(TRADE_RETCODE_DONE, "Request executed", order=deal, deal=deal, volume=p["volume"], price=price)


def _check_triggers() -> None:
    for p in list(_state["positions"].values()):
        price = _price_close(p)
        buy = p["type"] == POSITION_TYPE_BUY
        if p["sl"] and ((buy and price <= p["sl"]) or (not buy and price >= p["sl"])):
            _close(p, price, "[sl]")
        elif p["tp"] and ((buy and price >= p["tp"]) or (not buy and price <= p["tp"])):
            _close(p, price, "[tp]")
    for o in list(_state["orders"].values()):
        bid, ask = _bid_ask(_state["symbols"][o["symbol"]])
        t, px = o["type"], o["price_open"]
        hit = (
            (t == ORDER_TYPE_BUY_LIMIT and ask <= px)
            or (t == ORDER_TYPE_SELL_LIMIT and bid >= px)
            or (t == ORDER_TYPE_BUY_STOP and ask >= px)
            or (t == ORDER_TYPE_SELL_STOP and bid <= px)
        )
        if hit:
            del _state["orders"][o["ticket"]]
            ticket = o["ticket"]
            _state["positions"][ticket] = dict(
                ticket=ticket, identifier=ticket, time=_now(), type=0 if t in (2, 4) else 1, magic=o["magic"],
                volume=o["volume_current"], price_open=ask if t in (2, 4) else bid, sl=o["sl"], tp=o["tp"],
                symbol=o["symbol"], comment=o["comment"],
            )


def _set_trade_allowed(value: bool) -> None:
    """Solo para pruebas: simula el botón Algo Trading de MT5."""
    _state["trade_allowed"] = value


def _shift(symbol: str, factor: float) -> None:
    """Solo para pruebas: mueve el precio de un símbolo."""
    with _lock:
        _state["symbols"][symbol]["mid"] *= factor
        _check_triggers()
