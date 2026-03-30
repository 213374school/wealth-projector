import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { SimulationResult, Scenario } from "../types";
import { formatCurrency } from "../utils/formatting";
import { CHART_MARGIN } from "./Chart";

interface CashFlowChartProps {
  result: SimulationResult;
  scenario: Scenario;
  viewportStart: number;
  viewportEnd: number;
  hoveredIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
  showRealValues?: boolean;
}

interface FlowBar {
  label: string;
  absIdx: number;
  firstAbsIdx: number;
  lastAbsIdx: number;
  inflow: number;
  outflow: number;
}

export function CashFlowChart({
  result,
  scenario,
  viewportStart,
  viewportEnd,
  hoveredIdx,
  onHoverIdx,
  showRealValues = true,
}: CashFlowChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{
    absIdxToBarIdx: Map<number, number>;
    barIdxToAbsIdx: number[];
    marginLeft: number;
    marginTop: number;
    step: number;
    barWidth: number;
    innerWidth: number;
    totalWidth: number;
  } | null>(null);
  const mouseHandlerRef = useRef<{
    onMove: (x: number, y: number) => void;
    onLeave: () => void;
  } | null>(null);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (!svgRef.current) return;
    const container = svgRef.current.parentElement!;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = svgRef.current.parentElement!;
    const totalWidth = container.clientWidth || 800;
    const totalHeight = container.clientHeight || 110;
    const margin = { ...CHART_MARGIN, top: 0, bottom: 4 };
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;
    const viewMonths = viewportEnd - viewportStart + 1;

    svg.attr("width", totalWidth).attr("height", totalHeight);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const months = result.months.slice(viewportStart, viewportEnd + 1);

    const deflate = (nominal: number, absIdx: number): number => {
      if (!scenario.inflationEnabled || scenario.inflationRate === 0 || !showRealValues) return nominal;
      return nominal / Math.pow(1 + scenario.inflationRate, absIdx / 12);
    };

    const pxPerMonth = width / viewMonths;
    const barMode: "year" | "quarter" | "month" =
      pxPerMonth < 7.2 ? "year" : pxPerMonth < 21.5 ? "quarter" : "month";

    const quarterKey = (m: string) => {
      const [yr, mo] = m.split("-");
      return `${yr}-Q${Math.ceil(parseInt(mo) / 3)}`;
    };

    // Build bar data — summing flows across each period
    let barData: FlowBar[];
    let barLabels: string[];

    if (barMode === "year") {
      const years = [...new Set(months.map(m => m.slice(0, 4)))];
      barData = years.map(yr => {
        const yearMonths = months.filter(m => m.startsWith(yr));
        const firstAbsIdx = result.months.indexOf(yearMonths[0]);
        const lastAbsIdx = result.months.indexOf(yearMonths[yearMonths.length - 1]);
        let inflow = 0;
        let outflow = 0;
        for (const m of yearMonths) {
          const ai = result.months.indexOf(m);
          inflow += deflate(result.inflows[ai] ?? 0, ai);
          outflow += deflate(result.outflows[ai] ?? 0, ai);
        }
        return { label: yr, absIdx: lastAbsIdx, firstAbsIdx, lastAbsIdx, inflow, outflow };
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
        const firstAbsIdx = result.months.indexOf(qMonths[0]);
        const lastAbsIdx = result.months.indexOf(qMonths[qMonths.length - 1]);
        let inflow = 0;
        let outflow = 0;
        for (const m of qMonths) {
          const ai = result.months.indexOf(m);
          inflow += deflate(result.inflows[ai] ?? 0, ai);
          outflow += deflate(result.outflows[ai] ?? 0, ai);
        }
        return { label: qk, absIdx: lastAbsIdx, firstAbsIdx, lastAbsIdx, inflow, outflow };
      });
      barLabels = quarterKeys;
    } else {
      barData = months.map((m, vi) => {
        const ai = viewportStart + vi;
        return {
          label: m,
          absIdx: ai,
          firstAbsIdx: ai,
          lastAbsIdx: ai,
          inflow: deflate(result.inflows[ai] ?? 0, ai),
          outflow: deflate(result.outflows[ai] ?? 0, ai),
        };
      });
      barLabels = months;
    }

    // Build absIdx→barIdx mapping for crosshair
    const absIdxToBarIdx = new Map<number, number>();
    const barIdxToAbsIdx: number[] = [];
    barData.forEach((bar, bi) => {
      barIdxToAbsIdx.push(bar.absIdx);
      for (let ai = bar.firstAbsIdx; ai <= bar.lastAbsIdx; ai++) {
        absIdxToBarIdx.set(ai, bi);
      }
    });

    const columnWidth = barLabels.length > 0 ? width / barLabels.length : width;
    const BAR_GAP = Math.min(40, Math.max(1.5, columnWidth * 0.15));
    const xScale = d3.scaleBand<string>()
      .domain(barLabels)
      .range([0, width])
      .paddingOuter(0)
      .paddingInner(BAR_GAP / columnWidth);
    const barWidth = Math.max(1, xScale.bandwidth());
    const barLeft = (i: number) => xScale(barLabels[i]) ?? 0;

    // Y domain: symmetric based on actual max
    const maxVal = Math.max(
      ...barData.map(d => d.inflow),
      ...barData.map(d => d.outflow),
      1
    );
    const yMax = maxVal * 1.1;
    const yMin = -maxVal * 1.1;

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height, 0]);

    const zero = yScale(0);

    // Clip path
    const clipId = "cashflow-clip";
    svg.append("defs").append("clipPath").attr("id", clipId)
      .append("rect").attr("x", 0).attr("y", 0).attr("width", width).attr("height", height);

    // Gridlines (light)
    const gridAxis = d3.axisLeft(yScale)
      .ticks(3)
      .tickSize(-width)
      .tickFormat(() => "");
    g.append("g")
      .attr("class", "grid")
      .call(gridAxis)
      .call(gr => {
        gr.select(".domain").remove();
        gr.selectAll("line")
          .attr("stroke", "currentColor")
          .attr("stroke-opacity", 0.08)
          .attr("stroke-dasharray", "3,3");
      });

    // Zero line
    g.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", zero).attr("y2", zero)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.2)
      .attr("stroke-width", 1);

    // Bars
    const barsGroup = g.append("g").attr("clip-path", `url(#${clipId})`);

    barData.forEach((bar, bi) => {
      const x = barLeft(bi);

      // Inflow bar (up)
      if (bar.inflow > 0) {
        const y = yScale(bar.inflow);
        barsGroup.append("rect")
          .attr("x", x)
          .attr("y", y)
          .attr("width", barWidth)
          .attr("height", Math.max(0, zero - y))
          .attr("fill", "#059669");
      }

      // Outflow bar (down)
      if (bar.outflow > 0) {
        const y = zero;
        const barH = Math.max(0, yScale(-bar.outflow) - zero);
        barsGroup.append("rect")
          .attr("x", x)
          .attr("y", y)
          .attr("width", barWidth)
          .attr("height", barH)
          .attr("fill", "#dc2626");
      }
    });

    // Net line — one horizontal segment per bar at y = inflow − outflow
    const netGroup = g.append("g").attr("clip-path", `url(#${clipId})`);
    barData.forEach((bar, bi) => {
      const x = barLeft(bi);
      const y = yScale(bar.inflow - bar.outflow);
      netGroup.append("line")
        .attr("x1", x)
        .attr("x2", x + barWidth)
        .attr("y1", y)
        .attr("y2", y)
        .attr("stroke", "currentColor")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4,2");
    });

    // Y axis
    const yAxis = d3.axisLeft(yScale)
      .ticks(3)
      .tickFormat(v => formatCurrency(v as number, scenario.currencySymbol, scenario.currencySymbolPosition));
    g.append("g")
      .call(yAxis)
      .call(ax => {
        ax.select(".domain").remove();
        ax.selectAll("line").attr("stroke-opacity", 0.3);
        ax.selectAll("text").attr("font-size", "10px").attr("fill", "currentColor");
      });

    // Store layout for crosshair
    layoutRef.current = {
      absIdxToBarIdx,
      barIdxToAbsIdx,
      marginLeft: margin.left,
      marginTop: margin.top,
      step: columnWidth,
      barWidth,
      innerWidth: width,
      totalWidth,
    };

    const tooltip = d3.select(tooltipRef.current);
    const fmt = (v: number) => formatCurrency(v, scenario.currencySymbol, scenario.currencySymbolPosition);
    const valueLabel = showRealValues && scenario.inflationEnabled && scenario.inflationRate !== 0 ? "Real" : "Nominal";

    // Mouse handlers
    mouseHandlerRef.current = {
      onMove: (x: number, y: number) => {
        const layout = layoutRef.current;
        if (!layout) return;
        const mx = x - layout.marginLeft;
        if (mx < 0 || mx > layout.innerWidth) {
          onHoverIdx(null);
          tooltip.style("display", "none");
          return;
        }
        const barIdx = Math.min(Math.floor(mx / layout.step), barData.length - 1);
        if (barIdx < 0 || barIdx >= barData.length) {
          onHoverIdx(null);
          tooltip.style("display", "none");
          return;
        }
        const bar = barData[barIdx];
        onHoverIdx(bar.absIdx);

        const net = bar.inflow - bar.outflow;
        const netSign = net >= 0 ? "+" : "";
        const html = `
          <div class="font-semibold mb-1">${bar.label} <span class="font-normal opacity-60">(${valueLabel})</span></div>
          <div class="flex items-center gap-1.5">
            <span style="background:#059669" class="inline-block w-2 h-2 rounded-full flex-shrink-0"></span>
            <span>In:</span>
            <span class="font-medium ml-auto pl-3">${fmt(bar.inflow)}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span style="background:#dc2626" class="inline-block w-2 h-2 rounded-full flex-shrink-0"></span>
            <span>Out:</span>
            <span class="font-medium ml-auto pl-3">${fmt(bar.outflow)}</span>
          </div>
          <div class="border-t mt-1 pt-1 font-semibold flex justify-between gap-3">
            <span>Net:</span>
            <span>${netSign}${fmt(net)}</span>
          </div>`;

        tooltip.style("display", "block").html(html);
        const tW = tooltipRef.current?.offsetWidth ?? 160;
        tooltip
          .style("left", `${Math.min(x + 12, layout.totalWidth - tW - 4)}px`)
          .style("right", "auto")
          .style("top", `${Math.max(0, y - 8)}px`);
      },
      onLeave: () => {
        onHoverIdx(null);
        tooltip.style("display", "none");
      },
    };

  }, [result, scenario, viewportStart, viewportEnd, showRealValues, containerSize]);

  // Crosshair overlay (React-managed)
  const layout = layoutRef.current;
  let crosshairX: number | null = null;
  if (layout && hoveredIdx !== null) {
    const barIdx = layout.absIdxToBarIdx.get(hoveredIdx);
    if (barIdx !== undefined) {
      crosshairX = layout.marginLeft + (barIdx + 0.5) * layout.step;
    }
  }

  const totalHeight = containerSize.height || 110;

  return (
    <div
      className="relative w-full h-full"
      onMouseMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouseHandlerRef.current?.onMove(e.clientX - rect.left, e.clientY - rect.top);
      }}
      onMouseLeave={() => mouseHandlerRef.current?.onLeave()}
    >
      <svg ref={svgRef} className="w-full h-full" style={{ pointerEvents: "none" }} />
      {crosshairX !== null && (
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height={totalHeight}
        >
          <line
            x1={crosshairX}
            x2={crosshairX}
            y1={0}
            y2={totalHeight}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={1}
            strokeDasharray="4,3"
          />
        </svg>
      )}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-2 text-xs z-10 min-w-[140px]"
        style={{ display: "none" }}
      />
    </div>
  );
}
