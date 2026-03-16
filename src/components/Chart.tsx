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
}

export function Chart({ result, accounts, scenario, visibleAccounts, viewportStart, viewportEnd, hoveredIdx, onHoverIdx, hoveredAnchorId }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{ marginLeft: number; marginTop: number; innerHeight: number; step: number } | null>(null);

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
    layoutRef.current = { marginLeft: margin.left, marginTop: margin.top, innerHeight: height, step: width / Math.max(viewMonths - 1, 1) };

    svg.attr("width", totalWidth).attr("height", totalHeight);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const months = result.months.slice(viewportStart, viewportEnd + 1);
    const visibleAccList = accounts.filter(a => visibleAccounts.has(a.id));

    // Build data array: one entry per month
    const data = months.map((m, i) => {
      const idx = viewportStart + i;
      const entry: Record<string, number | string> = { month: m };
      for (const acc of visibleAccList) {
        const val = result.balances[acc.id]?.[idx];
        entry[acc.id] = val ?? 0;
      }
      return entry;
    });

    // X scale
    const xScale = d3.scalePoint<string>()
      .domain(months)
      .range([0, width]);

    // Compute Y domain
    let yMin = 0;
    let yMax = 0;
    for (const d of data) {
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

    // Add padding
    const range = yMax - yMin || 1;
    yMax += range * 0.05;
    yMin -= range * 0.05;

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height, 0]);

    // Draw gridlines
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
        .attr("stroke-opacity", 0.1));

    // Zero line
    g.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1);

    // Draw stacked areas
    const posStack = d3.stack<Record<string, number | string>>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => {
        const v = (d[key] as number) || 0;
        return v >= 0 ? v : 0;
      })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const negStack = d3.stack<Record<string, number | string>>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => {
        const v = (d[key] as number) || 0;
        return v < 0 ? v : 0;
      })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const posLayers = posStack(data as Record<string, number | string>[]);
    const negLayers = negStack(data as Record<string, number | string>[]);

    const area = d3.area<d3.SeriesPoint<Record<string, number | string>>>()
      .x((_, i) => xScale(months[i]) ?? 0)
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    const colorMap = Object.fromEntries(accounts.map(a => [a.id, a.color]));

    // Draw positive layers
    for (const layer of posLayers) {
      const accId = layer.key;
      g.append("path")
        .datum(layer)
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 0.9)
        .attr("d", area);
    }

    // Draw negative layers
    for (const layer of negLayers) {
      const accId = layer.key;
      g.append("path")
        .datum(layer)
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 0.9)
        .attr("d", area);
    }

    // Net worth line
    const netLine = d3.line<Record<string, number | string>>()
      .x((_, i) => xScale(months[i]) ?? 0)
      .y(d => {
        let total = 0;
        for (const acc of visibleAccList) total += (d[acc.id] as number) || 0;
        return yScale(total);
      })
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "currentColor")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,2")
      .attr("d", netLine);

    // Today marker
    const todayStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();
    if (months.includes(todayStr)) {
      const tx = xScale(todayStr) ?? 0;
      g.append("line")
        .attr("x1", tx).attr("x2", tx)
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "#f59e0b")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,2");
      g.append("text")
        .attr("x", tx + 4)
        .attr("y", 12)
        .attr("font-size", 10)
        .attr("fill", "#f59e0b")
        .text("Today");
    }

    // Anchor lines (non-fixed only)
    for (const anchor of (scenario.anchors ?? []).filter(a => !a.fixed && months.includes(a.date))) {
      const ax = xScale(anchor.date) ?? 0;
      g.append("line")
        .attr("x1", ax).attr("x2", ax)
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "rgba(99,202,183,0.65)")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,2");
    }

    // X axis — adaptive ticks based on zoom level
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let tickValues: string[];
    let tickLabel: (m: string) => string;

    const pxPerMonth = width / Math.max(viewMonths - 1, 1);
    const MIN_PX = 35; // minimum pixels between ticks

    if (pxPerMonth * 1 >= MIN_PX) {
      // Every month
      tickValues = months;
      tickLabel = m => {
        const [yr, mo] = m.split("-");
        const name = MONTH_NAMES[parseInt(mo) - 1];
        return mo === "01" ? `${name} ${yr}` : name;
      };
    } else if (pxPerMonth * 3 >= MIN_PX) {
      // Every quarter
      tickValues = months.filter(m => ["01","04","07","10"].includes(m.slice(5)));
      tickLabel = m => {
        const [yr, mo] = m.split("-");
        if (mo === "01") return yr;
        return `${mo === "04" ? "Q2" : mo === "07" ? "Q3" : "Q4"} ${yr}`;
      };
    } else if (pxPerMonth * 12 >= MIN_PX) {
      // Every year
      tickValues = months.filter(m => m.endsWith("-01"));
      tickLabel = m => m.slice(0, 4);
    } else if (pxPerMonth * 60 >= MIN_PX) {
      // Every 5 years
      tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 5 === 0);
      tickLabel = m => m.slice(0, 4);
    } else if (pxPerMonth * 120 >= MIN_PX) {
      // Every 10 years
      tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 10 === 0);
      tickLabel = m => m.slice(0, 4);
    } else {
      // Every 25 years
      tickValues = months.filter(m => m.endsWith("-01") && parseInt(m) % 25 === 0);
      tickLabel = m => m.slice(0, 4);
    }

    const xAxisTicks = g.append("g")
      .attr("transform", `translate(0,${height})`);

    xAxisTicks.call(
      d3.axisBottom(xScale)
        .tickValues(tickValues)
        .tickFormat(m => tickLabel(m as string))
    );

    // Y axis
    g.append("g").call(
      d3.axisLeft(yScale)
        .tickFormat(d => formatCurrency(d as number, scenario.currencyLocale, scenario.currencySymbol))
    );

    // Tooltip overlay
    const overlay = g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "none")
      .attr("pointer-events", "all");

    const tooltip = d3.select(tooltipRef.current);

    overlay.on("mousemove", (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      const domain = xScale.domain();
      const step = width / (domain.length - 1 || 1);
      const idx = Math.round(mx / step);
      const clampedIdx = Math.max(0, Math.min(idx, domain.length - 1));
      const month = domain[clampedIdx];
      const monthIdx = viewportStart + clampedIdx;

      onHoverIdx(monthIdx);

      let total = 0;
      let html = `<div class="font-semibold mb-1">${month}</div>`;
      for (const acc of visibleAccList) {
        const v = result.balances[acc.id]?.[monthIdx];
        if (v !== null && v !== undefined) {
          total += v;
          html += `<div class="flex items-center gap-1">
            <span style="background:${colorMap[acc.id]}" class="inline-block w-2 h-2 rounded-full"></span>
            <span>${acc.name}:</span>
            <span class="font-medium">${formatCurrency(v, scenario.currencyLocale, scenario.currencySymbol)}</span>
          </div>`;
        }
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

  }, [result, accounts, visibleAccounts, viewportStart, viewportEnd, scenario, onHoverIdx]);

  // visibleMonths is used to trigger re-render when viewport changes
  void visibleMonths;

  const crosshairX = (() => {
    if (hoveredIdx === null || !layoutRef.current) return null;
    const viewIdx = hoveredIdx - viewportStart;
    const viewMonths = viewportEnd - viewportStart + 1;
    if (viewIdx < 0 || viewIdx >= viewMonths) return null;
    return layoutRef.current.marginLeft + viewIdx * layoutRef.current.step;
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
