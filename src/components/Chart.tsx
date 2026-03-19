import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import type { SimulationResult } from "../types";
import type { Account, Scenario } from "../types";
import { formatCurrency } from "../utils/formatting";

export const CHART_MARGIN = { top: 20, right: 20, bottom: 40, left: 70 };

interface ChartProps {
  result: SimulationResult;
  accounts: Account[];
  scenario: Scenario;
  visibleAccounts: Set<string>;
  viewportStart: number; // index into months array
  viewportEnd: number;
  hoveredIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
  hoveredAnchorId: string | null;
  selectedItemId?: string | null;
  onSelectItem?: (id: string | null, type: "account" | "transfer" | null) => void;
  showRealValues?: boolean;
}

type BarDatum = Record<string, number | string> & { _absIdx: number };

export function Chart({ result, accounts, scenario, visibleAccounts, viewportStart, viewportEnd, hoveredIdx, onHoverIdx, hoveredAnchorId, selectedItemId, onSelectItem, showRealValues = true }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{
    marginLeft: number;
    marginTop: number;
    innerHeight: number;
    step: number;
    absIdxToX: Map<number, number> | null;
  } | null>(null);

  const visibleMonths = useMemo(
    () => result.months.slice(viewportStart, viewportEnd + 1),
    [result.months, viewportStart, viewportEnd]
  );

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = svgRef.current.parentElement!;
    const totalWidth = container.clientWidth || 800;
    const totalHeight = container.clientHeight || 400;
    const margin = CHART_MARGIN;
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;
    const viewMonths = viewportEnd - viewportStart + 1;

    svg.attr("width", totalWidth).attr("height", totalHeight);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const months = result.months.slice(viewportStart, viewportEnd + 1);
    const visibleAccList = accounts.filter(a => visibleAccounts.has(a.id));

    const deflate = (nominal: number | null | undefined, absIdx: number): number => {
      if (nominal === null || nominal === undefined) return 0;
      if (!scenario.inflationEnabled || scenario.inflationRate === 0 || !showRealValues) return nominal;
      return nominal / Math.pow(1 + scenario.inflationRate, absIdx / 12);
    };

    // Decide bar granularity based on pixels per month
    const pxPerMonth = width / viewMonths;
    const barMode: "year" | "quarter" | "month" =
      pxPerMonth < 7.2 ? "year" : pxPerMonth < 21.5 ? "quarter" : "month";

    const quarterKey = (m: string) => {
      const [yr, mo] = m.split("-");
      return `${yr}-Q${Math.ceil(parseInt(mo) / 3)}`;
    };

    // Build bar data (one entry per bar)
    let barData: BarDatum[];
    let barLabels: string[];

    if (barMode === "year") {
      const years = [...new Set(months.map(m => m.slice(0, 4)))];
      barData = years.map(yr => {
        const yearMonths = months.filter(m => m.startsWith(yr));
        const lastMonth = yearMonths[yearMonths.length - 1];
        const absIdx = result.months.indexOf(lastMonth);
        const entry: BarDatum = { month: yr, _absIdx: absIdx };
        for (const acc of visibleAccList) {
          entry[acc.id] = deflate(result.balances[acc.id]?.[absIdx], absIdx);
        }
        return entry;
      });
      barLabels = years;
    } else if (barMode === "quarter") {
      const seen = new Set<string>();
      const quarterKeys: string[] = [];
      for (const m of months) {
        const qk = quarterKey(m);
        if (!seen.has(qk)) { seen.add(qk); quarterKeys.push(qk); }
      }
      barData = quarterKeys.map(qk => {
        const qMonths = months.filter(m => quarterKey(m) === qk);
        const lastMonth = qMonths[qMonths.length - 1];
        const absIdx = result.months.indexOf(lastMonth);
        const entry: BarDatum = { month: qk, _absIdx: absIdx };
        for (const acc of visibleAccList) {
          entry[acc.id] = deflate(result.balances[acc.id]?.[absIdx], absIdx);
        }
        return entry;
      });
      barLabels = quarterKeys;
    } else {
      barData = months.map((m, i) => {
        const absIdx = viewportStart + i;
        const entry: BarDatum = { month: m, _absIdx: absIdx };
        for (const acc of visibleAccList) {
          entry[acc.id] = deflate(result.balances[acc.id]?.[absIdx], absIdx);
        }
        return entry;
      });
      barLabels = months;
    }

    // X scale — scaleBand gives each bar its own column; no edge bars are clipped.
    const columnWidth = barLabels.length > 0 ? width / barLabels.length : width;
    const BAR_GAP = Math.min(8, Math.max(1.5, columnWidth * 0.06));
    const xScale = d3.scaleBand<string>()
      .domain(barLabels)
      .range([0, width])
      .paddingOuter(0)
      .paddingInner(BAR_GAP / columnWidth);
    const barWidth = Math.max(1, xScale.bandwidth());
    const barLeft = (i: number) => xScale(barLabels[i]) ?? 0;
    const barCenter = (i: number) => (xScale(barLabels[i]) ?? 0) + barWidth / 2;

    // Compute Y domain
    let yMin = 0;
    let yMax = 0;
    for (const d of barData) {
      let posSum = 0;
      let negSum = 0;
      for (const acc of visibleAccList) {
        const v = (d[acc.id] as number) || 0;
        if (v >= 0) posSum += v;
        else negSum += v;
      }
      yMax = Math.max(yMax, posSum);
      yMin = Math.min(yMin, negSum);
    }
    const range = yMax - yMin || 1;
    yMax += range * 0.05;
    yMin -= range * 0.05;

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height, 0]);

    // Store layout info for crosshair.
    // Map every viewport month to its bar center so timeline hover highlights the right bar.
    const absIdxToX = new Map<number, number>();
    if (barMode === "year") {
      barData.forEach((d, i) => {
        for (const m of months.filter(m => m.startsWith(barLabels[i]))) {
          absIdxToX.set(result.months.indexOf(m), barCenter(i));
        }
      });
    } else if (barMode === "quarter") {
      barData.forEach((d, i) => {
        for (const m of months.filter(m => quarterKey(m) === barLabels[i])) {
          absIdxToX.set(result.months.indexOf(m), barCenter(i));
        }
      });
    } else {
      barData.forEach((d, i) => absIdxToX.set(d._absIdx, barCenter(i)));
    }
    layoutRef.current = {
      marginLeft: margin.left,
      marginTop: margin.top,
      innerHeight: height,
      step: columnWidth,
      absIdxToX,
    };

    // Gridlines
    g.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(yScale)
          .tickSize(-width)
          .tickFormat(() => "")
      )
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line")
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.06));

    // Zero line
    g.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.2)
      .attr("stroke-width", 1);

    // Clip bars so edge bars don't bleed into the y-axis margin
    const clipId = "chart-clip";
    g.append("clipPath").attr("id", clipId).append("rect").attr("width", width).attr("height", height);
    const barsG = g.append("g").attr("clip-path", `url(#${clipId})`);

    // Stacked bars
    const posStack = d3.stack<BarDatum>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => { const v = (d[key] as number) || 0; return v >= 0 ? v : 0; })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const negStack = d3.stack<BarDatum>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => { const v = (d[key] as number) || 0; return v < 0 ? v : 0; })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const posLayers = posStack(barData);
    const negLayers = negStack(barData);

    const colorMap = Object.fromEntries(accounts.map(a => [a.id, a.color]));

    // Positive bars: y1 > y0, rect top = yScale(y1), height = yScale(y0) - yScale(y1)
    for (const layer of posLayers) {
      const accId = layer.key;
      barsG.selectAll(null)
        .data(layer)
        .join("rect")
        .attr("x", (_, i) => barLeft(i))
        .attr("y", d => yScale(d[1]))
        .attr("width", barWidth)
        .attr("height", d => Math.max(0, yScale(d[0]) - yScale(d[1])))
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 1);
    }

    // Negative bars: y1 < y0, rect top = yScale(y0), height = yScale(y1) - yScale(y0)
    for (const layer of negLayers) {
      const accId = layer.key;
      barsG.selectAll(null)
        .data(layer)
        .join("rect")
        .attr("x", (_, i) => barLeft(i))
        .attr("y", d => yScale(d[0]))
        .attr("width", barWidth)
        .attr("height", d => Math.max(0, yScale(d[1]) - yScale(d[0])))
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 1);
    }

    // Net worth line (connecting bar centers)
    const netLineData = barData.map((d, i) => ({
      x: barCenter(i),
      y: yScale(visibleAccList.reduce((sum, acc) => sum + ((d[acc.id] as number) || 0), 0)),
    }));
    g.append("path")
      .datum(netLineData)
      .attr("fill", "none")
      .attr("stroke", "currentColor")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,2")
      .attr("d", d3.line<{ x: number; y: number }>().x(d => d.x).y(d => d.y));

    // Today marker
    const todayStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();
    const todayLabel = barMode === "year" ? todayStr.slice(0, 4) : barMode === "quarter" ? quarterKey(todayStr) : todayStr;
    const todayBarIdx = barLabels.indexOf(todayLabel);
    if (todayBarIdx >= 0) {
      const tx = barCenter(todayBarIdx);
      g.append("line")
        .attr("x1", tx).attr("x2", tx)
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "#f59e0b")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,2");
      g.append("text")
        .attr("x", tx + 4).attr("y", 12)
        .attr("font-size", 10).attr("fill", "#f59e0b")
        .text("Today");
    }

    // X axis — adaptive ticks
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let tickValues: string[];
    let tickLabel: (m: string) => string;
    const MIN_PX = 35;

    if (barMode === "year") {
      const pxPerBar = columnWidth;
      if (pxPerBar >= MIN_PX) {
        tickValues = barLabels;
      } else if (pxPerBar * 5 >= MIN_PX) {
        tickValues = barLabels.filter(yr => parseInt(yr) % 5 === 0);
      } else if (pxPerBar * 10 >= MIN_PX) {
        tickValues = barLabels.filter(yr => parseInt(yr) % 10 === 0);
      } else {
        tickValues = barLabels.filter(yr => parseInt(yr) % 25 === 0);
      }
      tickLabel = yr => yr;
    } else if (barMode === "quarter") {
      const pxPerBar = columnWidth;
      if (pxPerBar >= MIN_PX) {
        tickValues = barLabels;
      } else if (pxPerBar * 2 >= MIN_PX) {
        tickValues = barLabels.filter(qk => qk.endsWith("Q1") || qk.endsWith("Q3"));
      } else if (pxPerBar * 4 >= MIN_PX) {
        tickValues = barLabels.filter(qk => qk.endsWith("Q1"));
      } else if (pxPerBar * 20 >= MIN_PX) {
        tickValues = barLabels.filter(qk => qk.endsWith("Q1") && parseInt(qk) % 5 === 0);
      } else {
        tickValues = barLabels.filter(qk => qk.endsWith("Q1") && parseInt(qk) % 10 === 0);
      }
      tickLabel = qk => {
        const [yr, q] = qk.split("-");
        return q === "Q1" ? yr : q;
      };
    } else {
      if (pxPerMonth * 1 >= MIN_PX) {
        tickValues = months;
        tickLabel = m => {
          const [yr, mo] = m.split("-");
          const name = MONTH_NAMES[parseInt(mo) - 1];
          return mo === "01" ? `${name} ${yr}` : name;
        };
      } else if (pxPerMonth * 3 >= MIN_PX) {
        tickValues = months.filter(m => ["01","04","07","10"].includes(m.slice(5)));
        tickLabel = m => {
          const [yr, mo] = m.split("-");
          if (mo === "01") return yr;
          return `${mo === "04" ? "Q2" : mo === "07" ? "Q3" : "Q4"} ${yr}`;
        };
      } else if (pxPerMonth * 12 >= MIN_PX) {
        tickValues = months.filter(m => m.endsWith("-01"));
        tickLabel = m => m.slice(0, 4);
      } else if (pxPerMonth * 60 >= MIN_PX) {
        tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 5 === 0);
        tickLabel = m => m.slice(0, 4);
      } else if (pxPerMonth * 120 >= MIN_PX) {
        tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 10 === 0);
        tickLabel = m => m.slice(0, 4);
      } else {
        tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 25 === 0);
        tickLabel = m => m.slice(0, 4);
      }
    }

    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues(tickValues)
          .tickFormat(m => tickLabel(m as string))
      );

    // Y axis
    g.append("g").call(
      d3.axisLeft(yScale)
        .tickFormat(d => formatCurrency(d as number, scenario.currencyLocale, scenario.currencySymbol))
    );

    // Helper: find closest bar index from mouse x position
    const findBarIdx = (mx: number): number => {
      let closest = 0;
      let closestDist = Infinity;
      barLabels.forEach((_, i) => {
        const dist = Math.abs(mx - barCenter(i));
        if (dist < closestDist) { closestDist = dist; closest = i; }
      });
      return closest;
    };

    // Tooltip overlay
    const overlay = g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "none")
      .attr("pointer-events", "all");

    const tooltip = d3.select(tooltipRef.current);

    overlay.on("mousemove", (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      const barIdx = findBarIdx(mx);
      const datum = barData[barIdx];
      const absIdx = datum._absIdx;

      onHoverIdx(absIdx);

      let total = 0;
      let html = `<div class="font-semibold mb-1">${datum.month as string}</div>`;
      for (const acc of visibleAccList) {
        const v = datum[acc.id] as number;
        total += v || 0;
        html += `<div class="flex items-center gap-1">
          <span style="background:${colorMap[acc.id]}" class="inline-block w-2 h-2 rounded-full"></span>
          <span>${acc.name}:</span>
          <span class="font-medium">${formatCurrency(v, scenario.currencyLocale, scenario.currencySymbol)}</span>
        </div>`;
      }
      html += `<div class="border-t mt-1 pt-1 font-semibold">Net: ${formatCurrency(total, scenario.currencyLocale, scenario.currencySymbol)}</div>`;

      const cursorX = mx + margin.left;
      tooltip.style("display", "block").html(html);
      const tW = tooltipRef.current?.offsetWidth ?? 200;
      tooltip
        .style("left", `${Math.min(cursorX + 10, totalWidth - tW - 4)}px`)
        .style("right", "auto")
        .style("top", `${event.offsetY}px`);
    });

    overlay.on("mouseleave", () => {
      onHoverIdx(null);
      tooltip.style("display", "none");
    });

    overlay.on("click", (event: MouseEvent) => {
      if (!onSelectItem) return;
      const [mx, my] = d3.pointer(event);
      const barIdx = findBarIdx(mx);

      for (let li = posLayers.length - 1; li >= 0; li--) {
        const layer = posLayers[li];
        const point = layer[barIdx];
        if (!point) continue;
        const yTop = yScale(point[1]);
        const yBot = yScale(point[0]);
        if (my >= yTop && my <= yBot && point[1] !== point[0]) {
          const newId = layer.key === selectedItemId ? null : layer.key;
          onSelectItem(newId, newId ? "account" : null);
          return;
        }
      }

      for (let li = negLayers.length - 1; li >= 0; li--) {
        const layer = negLayers[li];
        const point = layer[barIdx];
        if (!point) continue;
        // For negative layers: y0 > y1 in value space, so yScale(y0) < yScale(y1) in screen space
        const yTop = yScale(point[0]);
        const yBot = yScale(point[1]);
        if (my >= yTop && my <= yBot && point[1] !== point[0]) {
          const newId = layer.key === selectedItemId ? null : layer.key;
          onSelectItem(newId, newId ? "account" : null);
          return;
        }
      }

      onSelectItem(null, null);
    });

  }, [result, accounts, visibleAccounts, viewportStart, viewportEnd, scenario, onHoverIdx, selectedItemId, onSelectItem, showRealValues]);

  // visibleMonths is used to trigger re-render when viewport changes
  void visibleMonths;

  const crosshairX = (() => {
    if (hoveredIdx === null || hoveredAnchorId !== null || !layoutRef.current) return null;
    const { marginLeft, absIdxToX } = layoutRef.current;
    const cx = absIdxToX?.get(hoveredIdx);
    return cx !== undefined ? marginLeft + cx : null;
  })();

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
      {crosshairX !== null && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line
            x1={crosshairX} x2={crosshairX}
            y1={layoutRef.current!.marginTop} y2={layoutRef.current!.marginTop + layoutRef.current!.innerHeight}
            stroke="currentColor" strokeWidth={1} strokeDasharray="4,2" opacity={0.5}
          />
        </svg>
      )}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-2 text-xs z-10"
        style={{ display: "none" }}
      />
    </div>
  );
}
