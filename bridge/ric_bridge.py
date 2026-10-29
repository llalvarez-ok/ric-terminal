"""Puente entre RIC Terminal y una cuenta de MetaTrader 5.

Corre en la misma PC que el MT5, uno por cuenta (Exness, BlackBull...):

    python ric_bridge.py --cuenta exness --terminal "C:\\Program Files\\MetaTrader 5 EXNESS\\terminal64.exe" --puerto 8701

El MT5 tiene que estar abierto, con la sesión iniciada y el botón
"Algo Trading" activado. El puente escucha solo en 127.0.0.1 y pide el token
de RIC_BRIDGE_TOKEN en cada pedido.

Reglas que aplica antes de mandar cualquier orden, venga de donde venga:
- Stop loss obligatorio y del lado correcto del precio.
- Riesgo máximo por operación (pérdida en el SL contra el balance).
- Lotes máximos por orden.
- Tope de órdenes por minuto, para frenar un bucle que se dispare por error.
- Pausa general (botón de pánico).
Todo pedido y toda respuesta se anotan en el diario (diario/<cuenta>/AAAA-MM.jsonl).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import secrets
import sys
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

AQUI = Path(__file__).resolve().parent

DEFAULT_CONFIG = {
    "max_riesgo_pct": 2.0,
    "max_lotes": 5.0,
    "max_ordenes_por_minuto": 10,
    "desvio_puntos": 20,
    "magic": 261029,
    "huso_servidor_horas": None,  # None: se calcula con la hora de los ticks
}

TIMEFRAMES = {"M1": "TIMEFRAME_M1", "M5": "TIMEFRAME_M5", "M15": "TIMEFRAME_M15", "M30": "TIMEFRAME_M30",
              "H1": "TIMEFRAME_H1", "H4": "TIMEFRAME_H4", "D1": "TIMEFRAME_D1", "W1": "TIMEFRAME_W1"}

OK_CODES = {10008, 10009, 10010}  # PLACED, DONE, DONE_PARTIAL
RETRY_PRICE = {10004, 10020, 10021}  # REQUOTE, PRICE_CHANGED, PRICE_OFF
INVALID_FILL = 10030

# Mensajes en castellano para los códigos de respuesta más comunes.
RETCODES = {
    10004: "Recotización: el precio cambió",
    10006: "El bróker rechazó la orden",
    10007: "Orden cancelada",
    10008: "Orden pendiente colocada",
    10009: "Orden ejecutada",
    10010: "Ejecutada en parte",
    10013: "Pedido inválido",
    10014: "Volumen inválido",
    10015: "Precio inválido",
    10016: "Stops inválidos (SL o TP demasiado cerca o del lado equivocado)",
    10017: "Operatoria deshabilitada para este símbolo",
    10018: "Mercado cerrado",
    10019: "Fondos insuficientes",
    10020: "El precio cambió",
    10021: "Sin cotización para procesar el pedido",
    10024: "Demasiados pedidos",
    10026: "El servidor deshabilitó el trading automático",
    10027: "El trading automático está deshabilitado en el MT5 (botón Algo Trading)",
    10030: "Modo de ejecución no soportado",
    10031: "Sin conexión con el servidor del bróker",
    10036: "La posición ya está cerrada",
}


# ----------------------------------------------------------------------------
# Reglas puras (se prueban sin MT5)
# ----------------------------------------------------------------------------


def round_volume(volume: float, step: float, vmin: float) -> float:
    """Redondea hacia abajo al paso del símbolo, para no pasarse del riesgo."""
    steps = math.floor(volume / step + 1e-6)
    v = round(steps * step, 8)
    return v if v >= vmin - 1e-9 else 0.0


def validate_levels(side: str, entry: float, sl: float, tp: float | None, min_dist: float) -> list[str]:
    errors = []
    if not sl or sl <= 0:
        errors.append("El stop loss es obligatorio.")
        return errors
    if side == "compra":
        if sl >= entry:
            errors.append("En una compra el SL tiene que estar debajo del precio de entrada.")
        if tp and tp <= entry:
            errors.append("En una compra el TP tiene que estar arriba del precio de entrada.")
    else:
        if sl <= entry:
            errors.append("En una venta el SL tiene que estar arriba del precio de entrada.")
        if tp and tp >= entry:
            errors.append("En una venta el TP tiene que estar debajo del precio de entrada.")
    if not errors and abs(entry - sl) < min_dist:
        errors.append(f"El SL está demasiado cerca: el bróker pide al menos {min_dist:g} de distancia.")
    if not errors and tp and abs(tp - entry) < min_dist:
        errors.append(f"El TP está demasiado cerca: el bróker pide al menos {min_dist:g} de distancia.")
    return errors


def validate_pending_price(side: str, kind: str, price: float, bid: float, ask: float) -> list[str]:
    if kind == "mercado":
        return []
    if not price or price <= 0:
        return ["Falta el precio de la orden pendiente."]
    ref = ask if side == "compra" else bid
    above = price > ref
    want_above = (side == "compra" and kind == "stop") or (side == "venta" and kind == "limite")
    if above != want_above:
        where = "arriba" if want_above else "debajo"
        name = {"limite": "límite", "stop": "stop"}[kind]
        return [f"Una {side} {name} va {where} del precio actual ({ref:g})."]
    return []


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.times: deque[float] = deque()

    def allow(self, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        while self.times and now - self.times[0] > 60:
            self.times.popleft()
        if len(self.times) >= self.per_minute:
            return False
        self.times.append(now)
        return True


# ----------------------------------------------------------------------------
# Pedidos
# ----------------------------------------------------------------------------


class OrdenIn(BaseModel):
    client_id: str = Field(min_length=6, max_length=64)
    symbol: str
    lado: Literal["compra", "venta"]
    tipo: Literal["mercado", "limite", "stop"] = "mercado"
    volumen: float = Field(gt=0)
    precio: float | None = None
    sl: float
    tp: float | None = None
    origen: Literal["manual", "automatica"] = "manual"
    nota: str | None = Field(default=None, max_length=500)


class CalculoIn(BaseModel):
    symbol: str
    lado: Literal["compra", "venta"]
    tipo: Literal["mercado", "limite", "stop"] = "mercado"
    precio: float | None = None
    sl: float
    tp: float | None = None
    riesgo_pct: float | None = Field(default=None, gt=0)
    riesgo_monto: float | None = Field(default=None, gt=0)
    volumen: float | None = Field(default=None, gt=0)


class ModificarIn(BaseModel):
    ticket: int
    sl: float = Field(gt=0)
    tp: float | None = None


class TicketIn(BaseModel):
    ticket: int
    volumen: float | None = Field(default=None, gt=0)  # cierre parcial


class PausaIn(BaseModel):
    pausado: bool


# ----------------------------------------------------------------------------
# Puente
# ----------------------------------------------------------------------------


class Bridge:
    def __init__(self, mt5, cuenta: str, terminal: str | None, config: dict, diario_dir: Path):
        self.mt5 = mt5
        self.cuenta = cuenta
        self.terminal = terminal
        self.config = {**DEFAULT_CONFIG, **config}
        self.lock = threading.RLock()
        self.limiter = RateLimiter(int(self.config["max_ordenes_por_minuto"]))
        self.pausado = False
        self.sent: dict[str, dict] = {}  # client_id -> respuesta, para no duplicar
        self.diario_dir = diario_dir / cuenta
        self.diario_dir.mkdir(parents=True, exist_ok=True)
        self.prev_close: dict[str, tuple[int, float]] = {}
        self.server_offset = 0

    # --- conexión ---------------------------------------------------------

    def connect(self) -> bool:
        with self.lock:
            if self.mt5.terminal_info() is not None:
                return True
            kwargs = {"path": self.terminal} if self.terminal else {}
            ok = self.mt5.initialize(**kwargs)
            if ok:
                self._calibrate_offset()
            return bool(ok)

    def _calibrate_offset(self) -> None:
        if self.config.get("huso_servidor_horas") is not None:
            self.server_offset = int(float(self.config["huso_servidor_horas"]) * 3600)
            return
        # MT5 informa la hora del servidor del bróker como si fuera UTC.
        # La diferencia contra la hora real, redondeada a 30 min, es el huso.
        info = self.mt5.symbols_get()
        for s in info or []:
            tick = self.mt5.symbol_info_tick(s.name)
            if tick and tick.time:
                diff = tick.time - time.time()
                if abs(diff) < 15 * 3600:
                    self.server_offset = int(round(diff / 1800) * 1800)
                    return

    def require(self):
        if not self.connect():
            raise HTTPException(503, f"No hay conexión con el MT5 de {self.cuenta}: {self.mt5.last_error()}")

    # --- diario -----------------------------------------------------------

    def log(self, evento: str, **data: Any) -> None:
        now = datetime.now(timezone.utc)
        line = {"ts": now.isoformat(timespec="milliseconds"), "cuenta": self.cuenta, "evento": evento, **data}
        path = self.diario_dir / f"{now:%Y-%m}.jsonl"
        with self.lock, path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False, default=str) + "\n")

    def read_log(self, n: int) -> list[dict]:
        files = sorted(self.diario_dir.glob("*.jsonl"))[-2:]
        lines: list[str] = []
        for f in files:
            lines.extend(f.read_text(encoding="utf-8").splitlines())
        return [json.loads(x) for x in lines[-n:]]

    # --- lectura ----------------------------------------------------------

    def estado(self) -> dict:
        self.require()
        with self.lock:
            a = self.mt5.account_info()
            t = self.mt5.terminal_info()
        if a is None:
            raise HTTPException(503, "El MT5 está abierto pero sin sesión iniciada.")
        return {
            "cuenta": self.cuenta,
            "login": a.login,
            "servidor": a.server,
            "empresa": a.company,
            "moneda": a.currency,
            "apalancamiento": a.leverage,
            "balance": a.balance,
            "equity": a.equity,
            "resultado_abierto": a.profit,
            "margen": a.margin,
            "margen_libre": a.margin_free,
            "nivel_margen": a.margin_level,
            "algo_trading": bool(t.trade_allowed) and bool(a.trade_expert),
            "pausado": self.pausado,
            "config": self.config,
        }

    def simbolos(self, q: str) -> list[dict]:
        self.require()
        with self.lock:
            items = self.mt5.symbols_get() or ()
        q = q.upper().strip()
        out = []
        for s in items:
            if q and q not in s.name.upper() and q not in (s.description or "").upper():
                continue
            out.append({"symbol": s.name, "descripcion": s.description, "ruta": s.path, "visible": bool(s.visible)})
        return out[:300]

    def _prev_close(self, symbol: str) -> float | None:
        today = int(time.time() // 86400)
        hit = self.prev_close.get(symbol)
        if hit and hit[0] == today:
            return hit[1]
        rates = self.mt5.copy_rates_from_pos(symbol, self.mt5.TIMEFRAME_D1, 1, 1)
        if rates is None or len(rates) == 0:
            return None
        value = float(rates[-1]["close"])
        self.prev_close[symbol] = (today, value)
        return value

    def cotizaciones(self, symbols: list[str]) -> list[dict]:
        self.require()
        out = []
        with self.lock:
            for sym in symbols:
                info = self.mt5.symbol_info(sym)
                if info is None:
                    continue
                if not info.visible:
                    self.mt5.symbol_select(sym, True)
                tick = self.mt5.symbol_info_tick(sym)
                if tick is None:
                    continue
                prev = self._prev_close(sym)
                out.append({
                    "symbol": sym,
                    "descripcion": info.description,
                    "bid": tick.bid,
                    "ask": tick.ask,
                    "spread": round((tick.ask - tick.bid) / info.point) if info.point else None,
                    "digitos": info.digits,
                    "punto": info.point,
                    "cierre_anterior": prev,
                    "variacion": (tick.bid / prev - 1) if prev else None,
                    "hora": tick.time - self.server_offset,
                })
        return out

    def velas(self, symbol: str, tf: str, n: int) -> list[dict]:
        self.require()
        if tf not in TIMEFRAMES:
            raise HTTPException(400, "Marco de tiempo inválido")
        with self.lock:
            self.mt5.symbol_select(symbol, True)
            rates = self.mt5.copy_rates_from_pos(symbol, getattr(self.mt5, TIMEFRAMES[tf]), 0, min(max(n, 10), 5000))
        if rates is None:
            raise HTTPException(404, f"Sin velas para {symbol}")
        off = self.server_offset if tf not in ("D1", "W1") else 0
        return [
            {"time": int(r["time"]) - off, "open": float(r["open"]), "high": float(r["high"]),
             "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])}
            for r in rates
        ]

    def posiciones(self) -> list[dict]:
        self.require()
        with self.lock:
            items = self.mt5.positions_get() or ()
        return [
            {"ticket": p.ticket, "symbol": p.symbol, "lado": "compra" if p.type == 0 else "venta",
             "volumen": p.volume, "precio_apertura": p.price_open, "precio_actual": p.price_current,
             "sl": p.sl or None, "tp": p.tp or None, "resultado": p.profit, "swap": p.swap,
             "hora": p.time - self.server_offset, "de_ric": p.magic == self.config["magic"], "comentario": p.comment}
            for p in items
        ]

    def pendientes(self) -> list[dict]:
        self.require()
        names = {2: ("compra", "limite"), 3: ("venta", "limite"), 4: ("compra", "stop"), 5: ("venta", "stop")}
        with self.lock:
            items = self.mt5.orders_get() or ()
        out = []
        for o in items:
            lado, tipo = names.get(o.type, ("?", "?"))
            out.append({"ticket": o.ticket, "symbol": o.symbol, "lado": lado, "tipo": tipo,
                        "volumen": o.volume_current, "precio": o.price_open, "precio_actual": o.price_current,
                        "sl": o.sl or None, "tp": o.tp or None, "hora": o.time_setup - self.server_offset,
                        "de_ric": o.magic == self.config["magic"]})
        return out

    def historial(self, dias: int) -> list[dict]:
        self.require()
        hasta = datetime.now() + timedelta(days=1)
        desde = hasta - timedelta(days=dias + 1)
        with self.lock:
            deals = self.mt5.history_deals_get(desde, hasta) or ()
        return [
            {"ticket": d.ticket, "posicion": d.position_id, "symbol": d.symbol, "lado": "compra" if d.type == 0 else "venta",
             "entrada": d.entry == 0, "volumen": d.volume, "precio": d.price, "resultado": d.profit,
             "comision": d.commission, "swap": d.swap, "hora": d.time - self.server_offset, "comentario": d.comment}
            for d in deals
            if d.symbol  # descarta depósitos y retiros
        ]

    # --- cálculo de tamaño --------------------------------------------------

    def _entry(self, side: str, kind: str, price: float | None, tick) -> float:
        if kind == "mercado":
            return tick.ask if side == "compra" else tick.bid
        return float(price or 0)

    def _loss_at_sl(self, symbol: str, side: str, volume: float, entry: float, sl: float) -> float | None:
        action = self.mt5.ORDER_TYPE_BUY if side == "compra" else self.mt5.ORDER_TYPE_SELL
        p = self.mt5.order_calc_profit(action, symbol, volume, entry, sl)
        return None if p is None else abs(float(p))

    def calcular(self, c: CalculoIn) -> dict:
        self.require()
        with self.lock:
            info = self.mt5.symbol_info(c.symbol)
            tick = self.mt5.symbol_info_tick(c.symbol)
            acct = self.mt5.account_info()
            if info is None or tick is None:
                raise HTTPException(404, f"No existe el símbolo {c.symbol} en esta cuenta")
            entry = self._entry(c.lado, c.tipo, c.precio, tick)
            errors = validate_pending_price(c.lado, c.tipo, c.precio or 0, tick.bid, tick.ask)
            errors += validate_levels(c.lado, entry, c.sl, c.tp, info.trade_stops_level * info.point)
            loss_1 = None if errors else self._loss_at_sl(c.symbol, c.lado, 1.0, entry, c.sl)
            volume = c.volumen
            if loss_1 and not volume:
                target = c.riesgo_monto or (acct.balance * (c.riesgo_pct or self.config["max_riesgo_pct"]) / 100)
                volume = round_volume(target / loss_1, info.volume_step, info.volume_min)
                if volume == 0:
                    errors.append(f"Con ese riesgo no llega al lote mínimo ({info.volume_min}). Alejá menos el SL o subí el riesgo.")
            if volume:
                volume = min(volume, info.volume_max)
            loss = loss_1 * volume if loss_1 and volume else None
            gain = None
            if c.tp and volume and not errors:
                action = self.mt5.ORDER_TYPE_BUY if c.lado == "compra" else self.mt5.ORDER_TYPE_SELL
                gain = self.mt5.order_calc_profit(action, c.symbol, volume, entry, c.tp)
            margin = None
            if volume and not errors:
                action = self.mt5.ORDER_TYPE_BUY if c.lado == "compra" else self.mt5.ORDER_TYPE_SELL
                margin = self.mt5.order_calc_margin(action, c.symbol, volume, entry)
        risk_pct = loss / acct.balance * 100 if loss and acct.balance else None
        if risk_pct and risk_pct > self.config["max_riesgo_pct"] + 1e-6:
            errors.append(f"El riesgo ({risk_pct:.2f} %) supera el máximo por operación ({self.config['max_riesgo_pct']} %).")
        if volume and volume > self.config["max_lotes"]:
            errors.append(f"Supera el máximo de {self.config['max_lotes']} lotes por orden.")
        if margin and margin > acct.margin_free:
            errors.append("El margen libre no alcanza para esta orden.")
        return {
            "entrada": entry,
            "volumen": volume,
            "riesgo": loss,
            "riesgo_pct": risk_pct,
            "ganancia_tp": gain,
            "rr": (gain / loss) if gain and loss else None,
            "margen": margin,
            "moneda": acct.currency,
            "volumen_min": info.volume_min,
            "volumen_paso": info.volume_step,
            "errores": errors,
        }

    # --- órdenes ------------------------------------------------------------

    def _filling_modes(self, info) -> list[int]:
        modes = []
        if info.filling_mode & 1:
            modes.append(self.mt5.ORDER_FILLING_FOK)
        if info.filling_mode & 2:
            modes.append(self.mt5.ORDER_FILLING_IOC)
        modes.append(self.mt5.ORDER_FILLING_RETURN)
        return modes

    def _send(self, request: dict, info, refresh_price=None) -> Any:
        """Manda la orden probando los modos de ejecución que acepta el símbolo
        y reintenta una vez si el precio cambió."""
        result = None
        modes = self._filling_modes(info) if request["action"] == self.mt5.TRADE_ACTION_DEAL else [self.mt5.ORDER_FILLING_RETURN]
        for mode in modes:
            request["type_filling"] = mode
            for attempt in range(2):
                result = self.mt5.order_send(request)
                if result is None:
                    return None
                if result.retcode in RETRY_PRICE and refresh_price and attempt == 0:
                    request["price"] = refresh_price()
                    continue
                break
            if result.retcode != INVALID_FILL:
                return result
        return result

    def _outcome(self, result) -> dict:
        if result is None:
            code, msg = self.mt5.last_error()
            return {"ok": False, "codigo": code, "mensaje": f"El MT5 no respondió: {msg}"}
        return {
            "ok": result.retcode in OK_CODES,
            "codigo": result.retcode,
            "mensaje": RETCODES.get(result.retcode, result.comment),
            "detalle_broker": result.comment,
            "ticket": result.order,
            "precio": result.price,
            "volumen": result.volume,
        }

    def orden(self, o: OrdenIn) -> dict:
        self.require()
        with self.lock:
            if o.client_id in self.sent:
                return {**self.sent[o.client_id], "duplicada": True}

            info = self.mt5.symbol_info(o.symbol)
            tick = self.mt5.symbol_info_tick(o.symbol)
            acct = self.mt5.account_info()
            term = self.mt5.terminal_info()
            errors: list[str] = []
            if info is None or tick is None:
                errors.append(f"No existe el símbolo {o.symbol} en esta cuenta.")
            if self.pausado:
                errors.append("El trading está en pausa.")
            if term is not None and not term.trade_allowed:
                errors.append("Activá el botón Algo Trading en el MT5.")
            if not errors:
                calc = self.calcular(CalculoIn(symbol=o.symbol, lado=o.lado, tipo=o.tipo, precio=o.precio,
                                               sl=o.sl, tp=o.tp, volumen=o.volumen))
                errors += calc["errores"]
                if round_volume(o.volumen, info.volume_step, info.volume_min) != round(o.volumen, 8):
                    errors.append(f"El volumen tiene que ser múltiplo de {info.volume_step} y al menos {info.volume_min}.")
            context = {"bid": getattr(tick, "bid", None), "ask": getattr(tick, "ask", None),
                       "balance": getattr(acct, "balance", None), "equity": getattr(acct, "equity", None)}
            if errors:
                out = {"ok": False, "mensaje": " ".join(errors), "errores": errors}
                self.log("orden_rechazada", pedido=o.model_dump(), contexto=context, respuesta=out)
                return out
            if not self.limiter.allow():
                out = {"ok": False, "mensaje": f"Se alcanzó el tope de {self.config['max_ordenes_por_minuto']} órdenes por minuto."}
                self.log("orden_rechazada", pedido=o.model_dump(), contexto=context, respuesta=out)
                return out

            types = {("compra", "mercado"): self.mt5.ORDER_TYPE_BUY, ("venta", "mercado"): self.mt5.ORDER_TYPE_SELL,
                     ("compra", "limite"): self.mt5.ORDER_TYPE_BUY_LIMIT, ("venta", "limite"): self.mt5.ORDER_TYPE_SELL_LIMIT,
                     ("compra", "stop"): self.mt5.ORDER_TYPE_BUY_STOP, ("venta", "stop"): self.mt5.ORDER_TYPE_SELL_STOP}
            market = o.tipo == "mercado"
            request = {
                "action": self.mt5.TRADE_ACTION_DEAL if market else self.mt5.TRADE_ACTION_PENDING,
                "symbol": o.symbol,
                "volume": float(o.volumen),
                "type": types[(o.lado, o.tipo)],
                "price": calc["entrada"],
                "sl": float(o.sl),
                "tp": float(o.tp or 0.0),
                "deviation": int(self.config["desvio_puntos"]),
                "magic": int(self.config["magic"]),
                "comment": f"RIC {o.origen[:4]}",
                "type_time": self.mt5.ORDER_TIME_GTC,
            }

            def refresh():
                t = self.mt5.symbol_info_tick(o.symbol)
                return t.ask if o.lado == "compra" else t.bid

            self.log("orden_enviada", pedido=o.model_dump(), contexto=context, calculo=calc)
            out = self._outcome(self._send(request, info, refresh if market else None))
            out["riesgo"] = calc["riesgo"]
            out["riesgo_pct"] = calc["riesgo_pct"]
            self.sent[o.client_id] = out
            self.log("orden_resultado", client_id=o.client_id, respuesta=out)
            return out

    def cerrar(self, t: TicketIn, motivo: str = "manual") -> dict:
        self.require()
        with self.lock:
            pos = self.mt5.positions_get(ticket=t.ticket)
            if not pos:
                return {"ok": False, "mensaje": "La posición ya no existe."}
            p = pos[0]
            info = self.mt5.symbol_info(p.symbol)
            tick = self.mt5.symbol_info_tick(p.symbol)
            buy = p.type == 0
            volume = min(t.volumen or p.volume, p.volume)
            volume = round_volume(volume, info.volume_step, info.volume_min) or p.volume
            request = {
                "action": self.mt5.TRADE_ACTION_DEAL,
                "symbol": p.symbol,
                "volume": volume,
                "type": self.mt5.ORDER_TYPE_SELL if buy else self.mt5.ORDER_TYPE_BUY,
                "position": p.ticket,
                "price": tick.bid if buy else tick.ask,
                "deviation": int(self.config["desvio_puntos"]),
                "magic": int(self.config["magic"]),
                "comment": "RIC cierre",
                "type_time": self.mt5.ORDER_TIME_GTC,
            }

            def refresh():
                tk = self.mt5.symbol_info_tick(p.symbol)
                return tk.bid if buy else tk.ask

            out = self._outcome(self._send(request, info, refresh))
            self.log("cierre", ticket=t.ticket, volumen=volume, motivo=motivo, resultado_previo=p.profit, respuesta=out)
            return out

    def modificar(self, m: ModificarIn) -> dict:
        self.require()
        with self.lock:
            pos = self.mt5.positions_get(ticket=m.ticket)
            if not pos:
                return {"ok": False, "mensaje": "La posición ya no existe."}
            p = pos[0]
            info = self.mt5.symbol_info(p.symbol)
            side = "compra" if p.type == 0 else "venta"
            # Contra el precio actual: el SL nuevo no puede quedar ya superado.
            errors = validate_levels(side, p.price_current, m.sl, m.tp, info.trade_stops_level * info.point)
            if errors:
                out = {"ok": False, "mensaje": " ".join(errors), "errores": errors}
            else:
                request = {"action": self.mt5.TRADE_ACTION_SLTP, "symbol": p.symbol, "position": p.ticket,
                           "sl": float(m.sl), "tp": float(m.tp or 0.0), "magic": int(self.config["magic"])}
                out = self._outcome(self.mt5.order_send(request))
            self.log("modificacion", ticket=m.ticket, sl=m.sl, tp=m.tp, anterior={"sl": p.sl, "tp": p.tp}, respuesta=out)
            return out

    def cancelar(self, t: TicketIn) -> dict:
        self.require()
        with self.lock:
            out = self._outcome(self.mt5.order_send({"action": self.mt5.TRADE_ACTION_REMOVE, "order": t.ticket}))
            self.log("cancelacion", ticket=t.ticket, respuesta=out)
            return out

    def cerrar_todo(self) -> dict:
        """Botón de pánico: pausa, cancela pendientes y cierra posiciones."""
        self.pausado = True
        self.log("pausa", pausado=True, motivo="cerrar todo")
        results = []
        for o in self.pendientes():
            results.append({"ticket": o["ticket"], "tipo": "pendiente", **self.cancelar(TicketIn(ticket=o["ticket"]))})
        for p in self.posiciones():
            results.append({"ticket": p["ticket"], "tipo": "posicion", **self.cerrar(TicketIn(ticket=p["ticket"]), "cerrar todo")})
        return {"ok": all(r["ok"] for r in results), "resultados": results, "pausado": True}


# ----------------------------------------------------------------------------
# API HTTP
# ----------------------------------------------------------------------------


def create_app(bridge: Bridge, token: str) -> FastAPI:
    app = FastAPI(title=f"RIC bridge · {bridge.cuenta}", docs_url=None, redoc_url=None)

    def auth(x_ric_token: str = Header(default="")):
        if not secrets.compare_digest(x_ric_token, token):
            raise HTTPException(401, "Token inválido")

    deps = [Depends(auth)]

    @app.get("/estado", dependencies=deps)
    def estado():
        return bridge.estado()

    @app.get("/simbolos", dependencies=deps)
    def simbolos(q: str = ""):
        return bridge.simbolos(q)

    @app.get("/cotizaciones", dependencies=deps)
    def cotizaciones(symbols: str = Query("")):
        return bridge.cotizaciones([s for s in symbols.split(",") if s][:60])

    @app.get("/velas", dependencies=deps)
    def velas(symbol: str, tf: str = "H1", n: int = 500):
        return bridge.velas(symbol, tf, n)

    @app.get("/posiciones", dependencies=deps)
    def posiciones():
        return {"posiciones": bridge.posiciones(), "pendientes": bridge.pendientes()}

    @app.get("/historial", dependencies=deps)
    def historial(dias: int = 7):
        return bridge.historial(min(max(dias, 1), 365))

    @app.get("/diario", dependencies=deps)
    def diario(n: int = 200):
        return bridge.read_log(min(max(n, 1), 2000))

    @app.post("/calcular", dependencies=deps)
    def calcular(c: CalculoIn):
        return bridge.calcular(c)

    @app.post("/orden", dependencies=deps)
    def orden(o: OrdenIn):
        return bridge.orden(o)

    @app.post("/cerrar", dependencies=deps)
    def cerrar(t: TicketIn):
        return bridge.cerrar(t)

    @app.post("/modificar", dependencies=deps)
    def modificar(m: ModificarIn):
        return bridge.modificar(m)

    @app.post("/cancelar", dependencies=deps)
    def cancelar(t: TicketIn):
        return bridge.cancelar(t)

    @app.post("/pausa", dependencies=deps)
    def pausa(p: PausaIn):
        bridge.pausado = p.pausado
        bridge.log("pausa", pausado=p.pausado)
        return {"ok": True, "pausado": bridge.pausado}

    @app.post("/cerrar-todo", dependencies=deps)
    def cerrar_todo():
        return bridge.cerrar_todo()

    @app.get("/stream", dependencies=deps)
    async def stream(symbols: str = ""):
        wanted = [s for s in symbols.split(",") if s][:60]

        async def events():
            last: dict[str, tuple] = {}
            n = 0
            while True:
                try:
                    quotes = await asyncio.to_thread(bridge.cotizaciones, wanted)
                    changed = [q for q in quotes if last.get(q["symbol"]) != (q["bid"], q["ask"])]
                    for q in changed:
                        last[q["symbol"]] = (q["bid"], q["ask"])
                    if changed:
                        yield f"event: cotizaciones\ndata: {json.dumps(changed)}\n\n"
                    if n % 4 == 0:  # cuenta y posiciones, cada segundo
                        snap = await asyncio.to_thread(lambda: {
                            "estado": bridge.estado(),
                            "posiciones": bridge.posiciones(),
                            "pendientes": bridge.pendientes(),
                        })
                        yield f"event: cuenta\ndata: {json.dumps(snap, default=str)}\n\n"
                except HTTPException as e:
                    yield f"event: error\ndata: {json.dumps({'mensaje': e.detail})}\n\n"
                    await asyncio.sleep(2)
                except Exception as e:  # noqa: BLE001 - el stream no se corta por un error puntual
                    yield f"event: error\ndata: {json.dumps({'mensaje': str(e)})}\n\n"
                    await asyncio.sleep(2)
                n += 1
                await asyncio.sleep(0.25)

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app


def load_mt5(simulado: bool):
    if simulado:
        sys.path.insert(0, str(AQUI))
        import mt5_simulado as mt5  # noqa: PLC0415

        return mt5
    try:
        import MetaTrader5 as mt5  # noqa: PLC0415
    except ImportError:
        sys.exit("Falta la librería MetaTrader5. Instalala con: pip install -r requirements.txt (solo funciona en Windows).")
    return mt5


def main() -> None:
    ap = argparse.ArgumentParser(description="Puente entre RIC Terminal y MetaTrader 5")
    ap.add_argument("--cuenta", required=True, help="Nombre corto de la cuenta, por ejemplo exness o blackbull")
    ap.add_argument("--terminal", help="Ruta al terminal64.exe de ese MT5")
    ap.add_argument("--puerto", type=int, default=8701)
    ap.add_argument("--config", default=str(AQUI / "config.json"))
    ap.add_argument("--diario", default=str(AQUI / "diario"))
    ap.add_argument("--simulado", action="store_true", help="Usa un MT5 simulado (para probar sin cuenta)")
    args = ap.parse_args()

    token = os.environ.get("RIC_BRIDGE_TOKEN", "")
    if len(token) < 16:
        sys.exit("Definí la variable RIC_BRIDGE_TOKEN (al menos 16 caracteres), la misma que en .env.local de la terminal.")

    config: dict = {}
    cfg_path = Path(args.config)
    if cfg_path.exists():
        all_cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        config = {**all_cfg.get("default", {}), **all_cfg.get(args.cuenta, {})}

    mt5 = load_mt5(args.simulado)
    bridge = Bridge(mt5, args.cuenta, args.terminal, config, Path(args.diario))
    if not bridge.connect():
        print(f"Aviso: no pude conectar con el MT5 todavía ({mt5.last_error()}). Reintento con cada pedido.")
    else:
        e = bridge.estado()
        print(f"Conectado a {e['empresa']} · cuenta {e['login']} ({e['servidor']}) · balance {e['balance']} {e['moneda']}")
        if not e["algo_trading"]:
            print("Atención: el botón Algo Trading del MT5 está apagado. Sin eso no se pueden mandar órdenes.")

    import uvicorn  # noqa: PLC0415

    uvicorn.run(create_app(bridge, token), host="127.0.0.1", port=args.puerto, log_level="warning")


if __name__ == "__main__":
    main()
