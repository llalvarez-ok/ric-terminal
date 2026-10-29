# RIC Terminal

Terminal personal de mercado al estilo Bloomberg. Tiene dos pestañas:

- **Mercado:** CEDEARs y cripto con datos reales, para analizar.
- **Trading:** forex, metales y cripto en tus cuentas de MetaTrader 5 (Exness y BlackBull), con órdenes reales.

![Vista general](docs/vista.png)

## Qué muestra

**CEDEARs** (se actualiza cada 60 s)
- Precio en pesos, variación del día y gráfico de la rueda.
- **CCL implícito** de cada CEDEAR (precio ARS × ratio ÷ precio en EE.UU.) y su **premio o descuento** contra la mediana de tu lista. Sirve para ver qué CEDEAR está caro o barato en dólares antes de comprar o vender.
- Volumen relativo: el de hoy contra el promedio de 20 ruedas, ajustado por la hora de la rueda.
- Posición en el rango de 52 semanas, precio y variación de la acción en EE.UU. y RSI 14.
- Aviso ⚠ cuando el CCL implícito se aleja más de un 15 % del resto, lo que casi siempre significa que cambió el ratio.

**Cripto** (en vivo, segundo a segundo, vía Binance)
- Precio, variación y rango de 24 h, volumen y equivalente en pesos al dólar cripto.

**Panel de detalle** del papel elegido
- Gráfico de velas con volumen y medias de 20 y 50 (1D, 5D, 1M, 6M, 1A, 5A). En CEDEARs se puede ver BYMA en pesos o la acción en EE.UU. en dólares.
- Medias de 20, 50 y 200, RSI, volatilidad, ATR y máximos y mínimos.
- **Lectura rápida**: frases que resumen el estado del papel (tendencia, volumen, cercanía a máximos, sobrecompra, cuánto se mueve por día). Describe, no recomienda.
- **Alertas de precio**: suenan y aparece un aviso (también como notificación del sistema si le das permiso) cuando el precio llega al valor cargado.

**Barra superior**: hora de Buenos Aires, estado de BYMA, NYSE y cripto, dólar oficial, MEP, CCL, cripto y blue, CCL de tu lista y brecha.

### Teclado
| Tecla | Acción |
|---|---|
| ↑ ↓ | Moverse por la tabla |
| Tab | Pasar de CEDEARs a cripto y viceversa |
| 1 a 6 | Marco del gráfico |
| / | Agregar un CEDEAR |
| A | Cargar una alerta |
| Esc | Salir del campo de texto |

Las columnas se ordenan con un clic en el encabezado. La lista, las alertas y el último papel elegido quedan guardados en el navegador.

## Pestaña Trading (MetaTrader 5)

Se conecta a cada MT5 abierto en tu PC a través de un puente en Python (`bridge/`). Instalación y uso: [`bridge/LEEME.md`](bridge/LEEME.md). Para arrancar todo junto: `iniciar.ps1`.

- **Cuentas:** balance, equity, resultado abierto, margen y nivel de margen de cada cuenta, en vivo. Botones de pausa y de "Cerrar todo".
- **Mercado por cuenta:** bid, ask, spread y variación del día de forex, oro, plata, platino, cobre y cripto, con el nombre que usa cada bróker (por ejemplo `XAUUSDm` en Exness).
- **Gráfico** con los precios del bróker (M5 a W1), las medias de 20 y 50, y las líneas de entrada, SL y TP de tus posiciones y de la orden que estás armando. Un clic en el gráfico fija el SL, el TP o el precio.
- **Boleta de órdenes:**
  - Compra o venta, a mercado, límite o stop.
  - **SL obligatorio**, con atajos a 1, 1,5 o 2 ATR; TP opcional, con atajos a 1:1, 1:2 o 1:3.
  - Tamaño por % de riesgo, por monto de riesgo o por lotes. Muestra antes de enviar los lotes, la pérdida en el SL, la ganancia en el TP, el R:R y el margen.
  - **Confirmar antes de enviar**, activable. Apagado, la orden sale con un clic (ejecución directa).
  - **También en la otra cuenta:** la misma operación en Exness y BlackBull a la vez, con el tamaño calculado para el balance de cada una.
- **Posiciones y pendientes** de las dos cuentas: mover SL o TP, cerrar la mitad, cerrar, cancelar.
- **Diario** de cada orden en `bridge/diario/`, para analizar después.

Las órdenes pendientes (límite y stop) quedan en el servidor del bróker: se ejecutan aunque la PC esté apagada.

## Cómo usarla en tu PC

Necesitás [Node.js](https://nodejs.org) 20 o más nuevo.

En PowerShell, uno por uno:

```powershell
npm install
npm run build
npm start
```

Y abrís http://localhost:3000. Para desarrollo, `npm run dev`. Con la pestaña Trading, usá `iniciar.ps1`, que además levanta los puentes.

## Agregar papeles

- **CEDEAR**: escribí el ticker de BYMA (por ejemplo `NFLX`). Si no está en la tabla de ratios, agregalo con su ratio: `XYZ 4`. Con el mismo comando corregís un ratio que haya cambiado.
- **Cripto**: cualquier par contra USDT que exista en Binance (por ejemplo `AVAX`).

## Fuentes de datos

| Dato | Fuente | Demora |
|---|---|---|
| CEDEARs en BYMA | Yahoo Finance (`AAPL.BA`) | ~20 min |
| Acciones en EE.UU. | Yahoo Finance | casi nula en la rueda |
| Cripto | Binance (`data-api` y `data-stream.binance.vision`) | en vivo |
| Dólares | [DolarApi](https://dolarapi.com) | la de cada cotización |

Todas son gratuitas y no piden cuenta. Limitaciones conocidas:
- Yahoo no tiene el historial de algunos CEDEARs (por ejemplo META y VIST). Para esos, las medias, el RSI y la volatilidad salen de la acción en EE.UU. llevada a pesos, y la terminal lo avisa.
- El estado de las ruedas no contempla feriados.
- Los ratios de `lib/ratios.ts` son del listado de BYMA de septiembre de 2026. Los 18 de la lista por defecto se verificaron con precios reales el 29/10/2026.

## Estructura

```
app/api/cedears   precios de BYMA y EE.UU., CCL implícito e indicadores
app/api/history   velas de Yahoo para el gráfico
app/api/dolar     cotizaciones del dólar
app/api/trade     pasarela hacia los puentes de MT5 (pone el token y bloquea pedidos de otras páginas)
bridge/           puente con MetaTrader 5 en Python, MT5 simulado y sus pruebas
components/trading/  cuentas, boleta de órdenes y posiciones
components/       tablas, gráfico, panel de detalle, alertas
hooks/            sondeo, WebSocket de Binance, alertas, almacenamiento
lib/              indicadores, métricas, ratios, formato y lectura rápida
tests/            pruebas de los cálculos (npm test; las del puente con pytest)
```

## Ideas para seguir

- Bonos y ADRs argentinos (AL30, GD30, GGAL) y su CCL.
- Calendario económico y noticias.
- Alertas por premio de CCL o por volumen.
- Avisos a Telegram cuando la PC no está abierta.

---
Herramienta de uso personal. La pestaña Mercado es descriptiva y no constituye recomendación de inversión. En Trading, cada orden es decisión de quien la envía: forex, metales y cripto por CFD se operan apalancados y se puede perder más rápido de lo que se gana.
