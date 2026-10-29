# Puente con MetaTrader 5

`ric_bridge.py` conecta RIC Terminal con una cuenta de MT5. Corre en tu PC, uno por cuenta, y la terminal le habla por `127.0.0.1` con un token. Las claves de tus cuentas nunca pasan por la terminal: el puente usa el MT5 que ya tenés abierto y con la sesión iniciada.

## Instalación (una sola vez)

1. **Python 3.12** desde [python.org](https://www.python.org/downloads/windows/). En el instalador, tildá *Add python.exe to PATH*.
2. **Token:** copiá `.env.ejemplo` como `.env.local` (en la raíz del proyecto) y completá `RIC_BRIDGE_TOKEN` con una clave al azar. Para generarla:
   ```powershell
   py -c "import secrets; print(secrets.token_hex(16))"
   ```
3. **Rutas de los MT5:** abrí `iniciar.ps1` y revisá que las rutas de `terminal64.exe` de Exness y BlackBull sean las de tu PC. Si no, clic derecho en el acceso directo de cada MT5 > *Abrir la ubicación del archivo* y copiá la ruta.
4. **Límites (opcional):** copiá `bridge/config.ejemplo.json` como `bridge/config.json` y ajustalos. Se puede poner un valor general en `default` y otro por cuenta.

## Cada vez que vas a operar

1. Abrí los dos MT5 (Exness y BlackBull) e iniciá sesión en la cuenta con la que vas a operar.
2. En cada uno, activá el botón **Algo Trading** de la barra de herramientas (queda en verde). Sin eso, el MT5 rechaza las órdenes que no salen de su propia pantalla.
3. Ejecutá `iniciar.ps1` (clic derecho > *Ejecutar con PowerShell*). Abre una ventana por puente y otra para la terminal, y después el navegador.
4. En la terminal, pestaña **Trading**.

Cada ventana de puente muestra a qué cuenta se conectó (`Conectado a Exness · cuenta 123... · balance ...`). Si dice que Algo Trading está apagado, activalo en ese MT5.

## Qué controla el puente antes de mandar una orden

Estas reglas están en el puente, no en la pantalla, así que valen para cualquier orden, manual o automática:

| Regla | Valor por defecto | Dónde se cambia |
|---|---|---|
| Stop loss obligatorio y del lado correcto | siempre | — |
| Riesgo máximo por operación (pérdida en el SL contra el balance) | 2 % | `max_riesgo_pct` |
| Lotes máximos por orden | 5 | `max_lotes` |
| Órdenes por minuto (frena un bucle que se dispare por error) | 10 | `max_ordenes_por_minuto` |
| Desvío de precio aceptado en órdenes a mercado | 20 puntos | `desvio_puntos` |
| Pausa y "Cerrar todo" | desde la terminal | — |

No hay tope de pérdida diaria, según lo que definiste.

Si el MT5 está en un huso horario raro y las velas aparecen corridas, fijalo con `huso_servidor_horas` (por ejemplo `2` para GMT+2). Si no se pone nada, se calcula solo con la hora de las cotizaciones.

## Diario

Cada orden, rechazo, cierre, cambio de SL o TP y pausa queda en `bridge/diario/<cuenta>/AAAA-MM.jsonl`, con el precio, el balance y el cálculo de riesgo de ese momento. Es la base para analizar después qué funcionó y qué no. No se sube a git.

## Probar sin cuenta

```powershell
$env:RIC_BRIDGE_TOKEN = "el mismo de .env.local"
py bridge\ric_bridge.py --cuenta exness --puerto 8701 --simulado
```

`--simulado` usa un MT5 de mentira con precios al azar, para ver la pantalla y practicar sin tocar plata. Las pruebas automáticas corren igual:

```powershell
py -m pip install pytest httpx fastapi numpy
py -m pytest bridge\tests
```
