"use client";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { type Candle, smaSeries } from "@/lib/indicators";

const ART = -3 * 3600; // el gráfico muestra la hora de Buenos Aires

const COLORS = {
  up: "#3dd68c",
  down: "#ff6b6b",
  text: "#a3b5d1",
  grid: "rgba(39, 74, 128, 0.35)",
  border: "#274a80",
  sma20: "#e2c68c",
  sma50: "#8e7140",
};

export type ChartLine = { price: number; color: string; title: string; dashed?: boolean };

type Props = {
  candles: Candle[];
  showSma: boolean;
  precision?: number;
  lines?: ChartLine[]; // entrada, SL y TP de posiciones y órdenes
  onPriceClick?: (price: number) => void;
};

const t = (s: number) => (s + ART) as UTCTimestamp;

export function PriceChart({ candles, showSma, precision = 2, lines = [], onPriceClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    candles: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
    sma20: ISeriesApi<"Line">;
    sma50: ISeriesApi<"Line">;
  } | null>(null);
  const lastFirst = useRef<number | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const clickRef = useRef(onPriceClick);
  clickRef.current = onPriceClick;

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: COLORS.text,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: {
        locale: "es-AR",
        priceFormatter: (p: number) => p.toLocaleString("es-AR", { minimumFractionDigits: precision, maximumFractionDigits: precision }),
      },
    });
    const format = { type: "price" as const, precision, minMove: 1 / 10 ** precision };
    series.current = {
      candles: c.addSeries(CandlestickSeries, {
        upColor: COLORS.up,
        downColor: COLORS.down,
        wickUpColor: COLORS.up,
        wickDownColor: COLORS.down,
        borderVisible: false,
        priceFormat: format,
      }),
      volume: c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }),
      sma20: c.addSeries(LineSeries, { color: COLORS.sma20, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }),
      sma50: c.addSeries(LineSeries, { color: COLORS.sma50, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }),
    };
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    c.subscribeClick((param) => {
      if (!param.point || !clickRef.current || !series.current) return;
      const price = series.current.candles.coordinateToPrice(param.point.y);
      if (price != null) clickRef.current(Number(price.toFixed(precision)));
    });
    chart.current = c;
    return () => {
      priceLines.current = [];
      c.remove();
      chart.current = null;
      series.current = null;
      lastFirst.current = null;
    };
  }, [precision]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.candles.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    s.volume.setData(
      candles.map((c) => ({
        time: t(c.time),
        value: c.volume,
        color: c.close >= c.open ? "rgba(61, 214, 140, 0.35)" : "rgba(255, 107, 107, 0.35)",
      })),
    );
    const sma = (p: number) => (showSma ? smaSeries(candles, p).map((x) => ({ time: t(x.time), value: x.value })) : []);
    s.sma20.setData(sma(20));
    s.sma50.setData(sma(50));
    // Encuadra solo cuando cambia la serie (otro papel u otro marco), no en cada tick.
    const first = candles[0]?.time ?? null;
    if (first !== lastFirst.current) {
      chart.current?.timeScale().fitContent();
      lastFirst.current = first;
    }
  }, [candles, showSma]);

  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const l of priceLines.current) s.candles.removePriceLine(l);
    priceLines.current = lines.map((l) =>
      s.candles.createPriceLine({
        price: l.price,
        color: l.color,
        title: l.title,
        lineWidth: 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey, precision]);

  return <div ref={el} className="chart" />;
}
