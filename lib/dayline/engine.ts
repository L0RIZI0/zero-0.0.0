import type {
  CalEvent,
  DaylineSnapshot,
  EventCategory,
  EventKind,
  PlacedChip,
  PointerMode,
  TickMark,
  TickUnit,
} from "./types";
import {
  MAX_SPAN_MS,
  MIN_EVENT_MS,
  MIN_SPAN_MS,
  SETTINGS_KEY,
} from "./types";
import { C, applyChrome, colorOf, FONT_DISPLAY, FONT_MONO, FONT_UI, inkOn } from "./theme";
import {
  addUnit,
  clamp,
  DAY,
  expDamp,
  floorTo,
  formatHm,
  formatRange,
  HOUR,
  lerp,
  snapTime,
  startOfDay,
  smoothstep,
  unitApproxMs,
} from "./time";
import {
  BUSY_WEIGHT,
  emptyWeightForSpan,
  hannCum,
  lensAmpForSpan,
  lensDensity,
  nowLensHalfWidth,
  WarpField,
} from "./warp";
import { buildTicks, coilUnit, labelLane, type LabelLane } from "./ticks";
import { loadEvents, saveEvents, seedCalendar } from "./seed";
import { seasonSigned, sunTimes, sunUnit } from "./sun";
import type {
  DaylineCallbacks,
  DaylineData,
  DaylineTheme,
} from "./contract";
import { marksToEvents } from "./marks";
import { drawGlyph } from "./glyphDraw";

export type EngineHost = {
  onChange: (s: DaylineSnapshot) => void;
};

export type EngineOptions = {
  persist?: boolean;
  clock?: "wall" | "data";
  data?: DaylineData;
  theme?: DaylineTheme;
  callbacks?: DaylineCallbacks;
  nowRestFraction?: number;
  dpr?: number;
  source?: "demo" | "sample";
};

type Settings = { warpStrength: number; nowLens: boolean };
type CtxLS = CanvasRenderingContext2D & { letterSpacing: string };
type FadeLabel = {
	id: string;
	x: number;
	text: string;
	lane: LabelLane;
	unit: TickUnit;
	a: number;
};
type Hit = {
	chip: PlacedChip | null;
	handle: "start" | "end" | null;
	minimap: boolean;
};

function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { warpStrength: .9, nowLens: true };
		const p = JSON.parse(raw);
		return {
			warpStrength: clamp(p.warpStrength ?? .9, 0, 1),
			nowLens: p.nowLens !== false
		};
	} catch {
		return { warpStrength: .9, nowLens: true };
	}
}
function saveSettings(s: Settings) {
	try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
const LANE_ORDER: LabelLane[] = ["time", "day", "month", "year"];
const LANE_ROW = 17;
export class DaylineEngine {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	host: EngineHost;
	raf = 0;
	running = false;
	dpr = 1;
	width = 0;
	height = 0;
	events: CalEvent[] = [];
	selectedId: string | null = null;
	hoverId: string | null = null;
	hoverHandle: "start" | "end" | null = null;
	cursorT: number | null = null;
	warpStrength: number;
	nowLensOn: boolean;
	reducedMotion = false;
	warp = new WarpField();
	displayedEmpty = .2;
	displayedLensAmp = 0;
	now = Date.now();
	centerT = this.now;
	spanMs = 5 * DAY;
	targetCenter = this.now;
	targetSpan = 5 * DAY;
	lagCenter = this.now;
	lagSpan = 5 * DAY;
	mapDirty = true;
	liveA = 0;
	liveDen = 1;
	lagA = 0;
	lagDen = 1;
	lagClose = true;
	lensNow = 0;
	lensHalf = 1;
	lensAmp = 0;
	mapFocusX = 0;
	mapSigma2 = 1;
	textW = new Map<string, number>();
	centerVel = 0;
	logSpanVel = 0;
	zoomCoast = 0;
	springing = false;
	coastPx = 0;
	slidePx = 0;
	slideZoomLog = 0;
	wheelX = 0;
	/** Drag follow-through: keep grabT under a coasting x, same mapping as live pan. */
	flickT: number | null = null;
	flickX = 0;
	flickV = 0;
	focusX = 0;
	gestureAt = 0;
	mode: PointerMode = "none";
	ptrs = new Map<number, { id: number; x: number; y: number }>();
	grabT = 0;
	grabX = 0;
	lastX = 0;
	lastT = 0;
	cursorX = 0;
	cursorY = 0;
	dragOrigin: CalEvent[] = [];
	dragId: string | null = null;
	pinchDist0 = 0;
	pinchSpan0 = 1;
	pinchT = 0;
	pinchX = 0;
	moved = false;
	lastClickAt = 0;
	lastClickX = 0;
	emptyDown = false;
	velBuf: { t: number; x: number }[] = [];
	dragSign = 0;
	placed: PlacedChip[] = [];
	chipPose = new Map<string, { y: number; h: number; a: number; ghost: PlacedChip }>();
	ticks: TickMark[] = [];
	snapGuide: number | null = null;
	undo: string[] = [];
	redo: string[] = [];
	lastEmitKey = "";
	lastTs = 0;
	dirtyWarp = true;
	ro: ResizeObserver | null = null;
	needsResize = true;
	hostBox: { w: number; h: number } | null = null;
	lanesInited = false;
	chipsInited = false;
	labelAnchor = 80;
	laneY: Record<LabelLane, number> = {
		time: 80,
		day: 64,
		month: 48,
		year: 32
	};
	laneA: Record<LabelLane, number> = {
		time: 0,
		day: 0,
		month: 0,
		year: 0
	};
	labelFade = new Map<string, FadeLabel>();
	sunPts: { x: number; y: number }[] = [];
	sunHover = false;
	sunHoverA = 0;
	hoverSun: { rise: number; set: number; px: number; py: number } | null = null;
	persistEvents = true;
	clockMode: "wall" | "data" = "wall";
	nowRestFraction = 0.5;
	callbacks: DaylineCallbacks = {};
	bootData: DaylineData | null = null;
	source: "demo" | "sample" = "demo";
	lastIntent: string | null = null;
	constructor(canvas: HTMLCanvasElement, host: EngineHost, opts: EngineOptions = {}) {
		this.canvas = canvas;
		const ctx = canvas.getContext("2d", { alpha: false });
		if (!ctx) throw new Error("Canvas 2D unavailable");
		this.ctx = ctx;
		this.host = host;
		const settings = loadSettings();
		this.warpStrength = settings.warpStrength;
		this.nowLensOn = settings.nowLens;
		this.reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
		this.persistEvents = opts.persist !== false && !opts.data;
		this.clockMode = opts.clock ?? "wall";
		this.nowRestFraction = opts.nowRestFraction ?? (opts.data ? 1 / 3 : 0.5);
		this.callbacks = opts.callbacks ?? {};
		this.bootData = opts.data ?? null;
		this.source = opts.source ?? (opts.data ? "sample" : "demo");
		if (opts.theme) this.applyTheme(opts.theme);
		this.now = opts.data?.now ?? Date.now();
		this.events = [];
		this.centerT = this.now;
		this.targetCenter = this.now;
		this.lagCenter = this.now;
		this.spanMs = 5.5 * DAY;
		this.targetSpan = this.spanMs;
		this.lagSpan = this.spanMs;
		this.displayedEmpty = emptyWeightForSpan(this.spanMs, this.warpStrength);
		this.displayedLensAmp = this.nowLensOn ? lensAmpForSpan(this.spanMs) : 0;
		this.focusX = 0;
		this.gestureAt = performance.now();
		this.bind();
		this.resize();
		this.rebuildWarp();
		this.running = true;
		this.lastTs = performance.now();
		if (this.width >= 16 && this.height >= 16) {
			this.collectTicks();
			this.stepLabelLanes(1);
			this.stepLabelFade(1);
			this.draw();
		}
		this.raf = requestAnimationFrame(this.frame);
		queueMicrotask(() => this.hydrate());
	}
	destroy() {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.unbind();
		this.ro?.disconnect();
	}
	snapshot(): DaylineSnapshot {
		const selected = this.events.find((e: CalEvent) => e.id === this.selectedId) ?? null;
		return {
			spanMs: this.spanMs,
			centerT: this.centerT,
			hoverId: this.hoverId,
			selectedId: this.selectedId,
			cursorT: this.cursorT,
			warp: this.warpStrength,
			nowLens: this.nowLensOn,
			now: this.now,
			eventCount: this.events.length,
			selected,
			source: this.source,
			lastIntent: this.lastIntent
		};
	}
	setWarpStrength(v: number) {
		this.warpStrength = clamp(v, 0, 1);
		saveSettings({
			warpStrength: this.warpStrength,
			nowLens: this.nowLensOn
		});
		this.dirtyWarp = true;
		this.emit();
	}
	setNowLens(on: boolean) {
		this.nowLensOn = on;
		saveSettings({
			warpStrength: this.warpStrength,
			nowLens: this.nowLensOn
		});
		this.emit();
	}
	goToNow() {
		const restX = this.width * this.nowRestFraction;
		this.noteGesture(restX);
		const span = clamp(this.spanMs, 8 * HOUR, 8 * DAY);
		const center = this.now - (this.nowRestFraction - 0.5) * span;
		this.springTo(center, span);
	}
	jumpSpan(spanMs: number) {
		this.noteGesture(this.width / 2);
		this.springTo(this.centerT, clamp(spanMs, MIN_SPAN_MS, MAX_SPAN_MS));
	}
	jumpLife() {
		const { min, max } = this.bounds();
		this.noteGesture(this.width / 2);
		this.springTo((min + max) / 2, clamp(max - min, MIN_SPAN_MS, MAX_SPAN_MS));
	}
	panPixels(dx: number) {
		this.springing = false;
		this.coastPx = 0;
		this.slidePx = 0;
		this.slideZoomLog = 0;
		this.flickT = null;
		this.flickV = 0;
		this.panBy(dx);
	}
	resetDemo() {
		this.pushUndo();
		if (this.bootData) {
			this.loadData(this.bootData);
			this.springTo(this.now - (this.nowRestFraction - 0.5) * 5.5 * DAY, 5.5 * DAY);
			this.emit();
			return;
		}
		this.now = Date.now();
		this.events = seedCalendar(this.now);
		this.persist();
		this.selectedId = null;
		this.dirtyWarp = true;
		this.springTo(this.now, 5.5 * DAY);
		this.emit();
	}
	undoLast() {
		const prev = this.undo.pop();
		if (!prev) return;
		this.redo.push(JSON.stringify(this.events));
		this.events = JSON.parse(prev);
		this.persist();
		this.dirtyWarp = true;
		this.emit();
	}
	redoLast() {
		const next = this.redo.pop();
		if (!next) return;
		this.undo.push(JSON.stringify(this.events));
		this.events = JSON.parse(next);
		this.persist();
		this.dirtyWarp = true;
		this.emit();
	}
	updateSelected(patch: Partial<CalEvent>) {
		if (!this.selectedId) return;
		this.pushUndo();
		this.events = this.events.map((e: CalEvent) => e.id === this.selectedId ? {
			...e,
			...patch
		} : e);
		this.persist();
		this.dirtyWarp = true;
		this.emit();
	}
	deleteSelected() {
		if (!this.selectedId) return;
		const id = this.selectedId;
		this.pushUndo();
		const drop = new Set([id]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const e of this.events) if (e.parentId && drop.has(e.parentId) && !drop.has(e.id)) {
				drop.add(e.id);
				grew = true;
			}
		}
		this.events = this.events.filter((e) => !drop.has(e.id));
		this.selectedId = null;
		this.persist();
		this.dirtyWarp = true;
		this.emit();
	}
	bind() {
		const el = this.canvas;
		el.addEventListener("pointerdown", this.onDown);
		el.addEventListener("pointermove", this.onMove);
		el.addEventListener("pointerup", this.onUp);
		el.addEventListener("pointercancel", this.onUp);
		el.addEventListener("pointerleave", this.onLeave);
		el.addEventListener("wheel", this.onWheel, { passive: false });
		el.addEventListener("contextmenu", this.onMenu);
		window.addEventListener("keydown", this.onKey);
		this.ro = new ResizeObserver(() => {
			this.needsResize = true;
		});
		this.ro.observe(el);
		if (el.parentElement) this.ro.observe(el.parentElement);
		window.addEventListener("resize", this.onWinResize);
	}
	unbind() {
		const el = this.canvas;
		el.removeEventListener("pointerdown", this.onDown);
		el.removeEventListener("pointermove", this.onMove);
		el.removeEventListener("pointerup", this.onUp);
		el.removeEventListener("pointercancel", this.onUp);
		el.removeEventListener("pointerleave", this.onLeave);
		el.removeEventListener("wheel", this.onWheel);
		el.removeEventListener("contextmenu", this.onMenu);
		window.removeEventListener("keydown", this.onKey);
		window.removeEventListener("resize", this.onWinResize);
	}
	onWinResize = () => {
		this.needsResize = true;
	};
	hydrate() {
		if (!this.running) return;
		if (this.bootData) {
			this.loadData(this.bootData);
			return;
		}
		this.events = loadEvents(this.now);
		this.dirtyWarp = true;
		this.rebuildWarp();
		this.placed = this.layout();
		this.collectTicks();
		this.stepLabelLanes(1);
		this.stepLabelFade(1);
		if (this.width >= 16 && this.height >= 16) this.draw();
		this.emit();
	}
	persist() {
		if (this.persistEvents) saveEvents(this.events);
	}
	loadData(data: DaylineData) {
		const keepView = this.events.length > 0;
		this.bootData = data;
		if (this.clockMode === "data") this.now = data.now;
		else this.now = Date.now();
		this.events = marksToEvents(data);
		for (const e of this.events) if (e.openEnded) e.end = this.now;
		this.dirtyWarp = true;
		this.rebuildWarp();
		this.placed = this.layout();
		this.collectTicks();
		if (!keepView && this.width >= 16) {
			const restX = this.width * this.nowRestFraction;
			this.setAnchor(this.now, restX);
			this.targetCenter = this.centerT;
			this.lagCenter = this.centerT;
			this.focusX = restX;
		}
		this.stepLabelLanes(1);
		this.stepLabelFade(1);
		if (this.width >= 16 && this.height >= 16) this.draw();
		this.emit();
	}
	setContractTheme(theme: DaylineTheme) {
		this.applyTheme(theme);
	}
	applyTheme(theme: DaylineTheme) {
		applyChrome(theme);
	}
	resizeTo(width: number, height: number) {
		this.hostBox = { w: Math.max(1, width), h: Math.max(1, height) };
		this.needsResize = true;
		this.resize();
	}
	setCallbacks(cb: DaylineCallbacks) {
		this.callbacks = cb;
	}
	setRails(rails: { planned?: boolean; recorded?: boolean; access?: boolean }) {
		if (!this.bootData) return;
		this.loadData({
			...this.bootData,
			rails: {
				...this.bootData.rails,
				...rails
			}
		});
	}
	accentOf(e: CalEvent): string {
		return e.color || e.mark?.glyph.accent || colorOf(e.title, e.category);
	}
	noteIntent(msg: string) {
		this.lastIntent = msg;
		this.emit();
	}
	resize() {
		const parent = this.canvas.parentElement ?? this.canvas;
		const r = this.canvas.getBoundingClientRect();
		const pr = parent.getBoundingClientRect();
		let w: number;
		let h: number;
		if (this.hostBox && this.hostBox.w >= 8 && this.hostBox.h >= 8) {
			w = Math.floor(this.hostBox.w);
			h = Math.floor(this.hostBox.h);
		} else {
			w = Math.floor(Math.max(r.width, pr.width));
			h = Math.floor(Math.max(r.height, pr.height));
			if (w < 16 || h < 16) {
				w = Math.max(w, Math.floor(window.innerWidth) || 1024);
				h = Math.max(h, Math.max(240, Math.floor((window.innerHeight || 720) * .45)));
				this.needsResize = true;
			}
		}
		const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
		if (w === this.width && h === this.height && dpr === this.dpr && this.canvas.width === Math.floor(w * dpr)) {
			this.needsResize = w >= 16 && h >= 16 ? false : true;
			return;
		}
		this.dpr = dpr;
		this.width = w;
		this.height = h;
		this.canvas.width = Math.floor(w * dpr);
		this.canvas.height = Math.floor(h * dpr);
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (w >= 16 && h >= 16) this.needsResize = false;
		if (this.focusX === 0) this.focusX = w / 2;
	}
	frame = (ts: number) => {
		if (!this.running) return;
		this.raf = requestAnimationFrame(this.frame);
		const dt = clamp((ts - this.lastTs) / 1e3, .001, .05);
		this.lastTs = ts;
		if (this.clockMode !== "data") this.now = Date.now();
		if (this.clockMode !== "data") {
			for (const e of this.events) if (e.openEnded) e.end = this.now;
		}
		try {
			if (this.needsResize) this.resize();
			this.step(dt);
			if (this.width >= 16 && this.height >= 16) this.draw();
			this.emit();
		} catch (err) {
			console.error(err);
		}
	};
	step(dt: number) {
		const targetEmpty = emptyWeightForSpan(this.spanMs, this.warpStrength);
		const kEmpty = this.reducedMotion ? 40 : 3.4;
		this.displayedEmpty += (targetEmpty - this.displayedEmpty) * expDamp(kEmpty, dt);
		if (Math.abs(targetEmpty - this.displayedEmpty) > .002) this.dirtyWarp = true;
		const lensTarget = this.nowLensOn ? lensAmpForSpan(this.spanMs) : 0;
		const kLens = this.reducedMotion ? 28 : 4.4;
		this.displayedLensAmp += (lensTarget - this.displayedLensAmp) * expDamp(kLens, dt);
		const sunTarget = this.sunHover ? 1 : 0;
		const kSun = this.reducedMotion ? 36 : 3.15;
		this.sunHoverA += (sunTarget - this.sunHoverA) * expDamp(kSun, dt);
		if (!this.sunHover && this.sunHoverA < .012) {
			this.sunHoverA = 0;
			this.hoverSun = null;
		}
		if (this.springing) {
			const k = this.reducedMotion ? 240 : 78;
			const d = this.reducedMotion ? 32 : 15.5;
			const accC = -k * (this.centerT - this.targetCenter) - d * this.centerVel;
			this.centerVel += accC * dt;
			this.centerT += this.centerVel * dt;
			const log = Math.log(this.spanMs);
			const logT = Math.log(this.targetSpan);
			const accS = -k * (log - logT) - d * this.logSpanVel;
			this.logSpanVel += accS * dt;
			this.spanMs = clamp(Math.exp(log + this.logSpanVel * dt), MIN_SPAN_MS, MAX_SPAN_MS);
			if (Math.abs(this.centerT - this.targetCenter) < 8 && Math.abs(this.spanMs - this.targetSpan) / this.targetSpan < .002 && Math.abs(this.centerVel) < 20 && Math.abs(this.logSpanVel) < .01) {
				this.centerVel = 0;
				this.logSpanVel = 0;
				this.springing = false;
			}
			this.dirtyWarp = true;
		} else if (this.mode === "none") {
			if (Math.abs(this.slidePx) > 0.08) {
				const a = 1 - Math.exp(-(this.reducedMotion ? 28 : 8.4) * dt);
				const take = this.slidePx * a;
				this.panBy(take);
				this.slidePx -= take;
				if (Math.abs(this.slidePx) < 0.08) this.slidePx = 0;
			}
			if (Math.abs(this.slideZoomLog) > 1e-5) {
				const a = 1 - Math.exp(-(this.reducedMotion ? 28 : 8.4) * dt);
				const take = this.slideZoomLog * a;
				this.zoomAt(this.wheelX, Math.exp(take), false);
				this.slideZoomLog -= take;
				if (Math.abs(this.slideZoomLog) < 1e-5) this.slideZoomLog = 0;
			}
			if (this.flickT != null && Math.abs(this.flickV) > 14) {
				this.flickX += this.flickV * dt;
				this.setAnchor(this.flickT, this.flickX);
				this.flickV *= Math.exp(-2.55 * dt);
				if (Math.abs(this.flickV) <= 14) {
					this.flickT = null;
					this.flickV = 0;
				}
			} else if (Math.abs(this.coastPx) > 12) {
				this.panBy(this.coastPx * dt);
				this.coastPx *= Math.exp(-2.55 * dt);
				if (Math.abs(this.coastPx) <= 12) this.coastPx = 0;
			}
			if (Math.abs(this.zoomCoast) > .0012) {
				const factor = Math.exp(this.zoomCoast * (1 - Math.exp(-4.6 * dt)));
				this.zoomAt(this.focusX, factor, false);
				this.zoomCoast *= Math.exp(-4.6 * dt);
				if (Math.abs(this.zoomCoast) <= .0012) this.zoomCoast = 0;
			}
		}
		const sliding = Math.abs(this.slidePx) > 0.08 || Math.abs(this.slideZoomLog) > 1e-5;
		const active = this.mode === "pan" || this.mode === "pinch" || this.springing || this.flickT != null || Math.abs(this.coastPx) > 12 || Math.abs(this.zoomCoast) > .0012 || sliding;
		const kLag = this.reducedMotion ? 40 : active ? 4.4 : 9.2;
		this.lagCenter += (this.centerT - this.lagCenter) * expDamp(kLag, dt);
		const logLag = Math.log(Math.max(this.lagSpan, MIN_SPAN_MS));
		const logNow = Math.log(this.spanMs);
		this.lagSpan = Math.exp(logLag + (logNow - logLag) * expDamp(kLag, dt));
		this.clampView();
		this.rebuildWarp();
		this.mapDirty = true;
		this.placed = this.layout();
		this.stepChipPose(dt);
		this.collectTicks();
		this.stepLabelLanes(dt);
		this.stepLabelFade(dt);
	}
	panBy(dx: number) {
		if (this.width < 8) return;
		const mid = this.xToTime(this.width / 2);
		this.setAnchor(mid, this.width / 2 - dx);
	}
	collectTicks() {
		if (this.width < 16) {
			this.ticks = [];
			return;
		}
		this.ctx.font = `500 11px ${FONT_DISPLAY}`;
		this.ctx.letterSpacing = "0.16em";
		const measure = (s: string) => {
			let w = this.textW.get(s);
			if (w == null) {
				w = this.ctx.measureText(s).width;
				this.textW.set(s, w);
			}
			return w;
		};
		this.ticks = buildTicks(this.tLeft(), this.tRight(), this.spanMs, (t) => this.timeToX(t), this.width, measure);
	}
	stepLabelLanes(dt: number) {
		let chipTop = this.lineY() - 34;
		for (const p of this.placed) {
			if (p.clustered || p.event.kind === "milestone") continue;
			if (p.x1 < -20 || p.x0 > this.width + 20) continue;
			chipTop = Math.min(chipTop, p.y);
		}
		const targetAnchor = Math.max(28, chipTop - 8);
		const kA = this.reducedMotion ? 48 : 9.5;
		this.labelAnchor += (targetAnchor - this.labelAnchor) * expDamp(kA, dt);
		const present = {
			time: false,
			day: false,
			month: false,
			year: false
		};
		for (const tk of this.ticks) if (tk.label) present[labelLane(tk.unit)] = true;
		let row = 0;
		const kY = this.reducedMotion ? 48 : 11;
		const kO = this.reducedMotion ? 48 : 10;
		for (const lane of LANE_ORDER) {
			const on = present[lane];
			const targetA = on ? 1 : 0;
			const targetY = this.labelAnchor - 4 - row * LANE_ROW;
			if (!this.lanesInited || this.reducedMotion) {
				this.laneA[lane] = targetA;
				this.laneY[lane] = targetY;
			} else {
				this.laneA[lane] += (targetA - this.laneA[lane]) * expDamp(kO, dt);
				this.laneY[lane] += (targetY - this.laneY[lane]) * expDamp(kY, dt);
			}
			if (on || this.laneA[lane] > .12) row += 1;
		}
		this.lanesInited = true;
	}
	stepChipPose(dt: number) {
		const k = this.reducedMotion ? 48 : 10.5;
		const kA = this.reducedMotion ? 48 : 9.2;
		const seen = new Set<string>();
		const ly = this.lineY();
		const snap = !this.chipsInited || this.reducedMotion;
		for (const p of this.placed) {
			if (p.clustered) continue;
			seen.add(p.event.id);
			const prev = this.chipPose.get(p.event.id);
			if (!prev || snap) {
				this.chipPose.set(p.event.id, {
					y: snap ? p.y : ly,
					h: p.h,
					a: snap ? 1 : 0,
					ghost: p,
				});
				if (snap) continue;
			}
			const cur = this.chipPose.get(p.event.id)!;
			const y = cur.y + (p.y - cur.y) * expDamp(k, dt);
			const h = cur.h + (p.h - cur.h) * expDamp(k, dt);
			const a = cur.a + (1 - cur.a) * expDamp(kA, dt);
			this.chipPose.set(p.event.id, { y, h, a, ghost: p });
			p.y = y;
			p.h = h;
		}
		for (const [id, pose] of [...this.chipPose.entries()]) {
			if (seen.has(id)) continue;
			const a = pose.a + (0 - pose.a) * expDamp(kA, dt);
			if (a < 0.03) {
				this.chipPose.delete(id);
				continue;
			}
			const g = pose.ghost;
			g.x0 = this.timeToX(g.event.start);
			g.x1 = this.timeToX(g.event.end);
			this.chipPose.set(id, { ...pose, a, ghost: g });
		}
		this.chipsInited = true;
	}
	stepLabelFade(dt: number) {
		const k = this.reducedMotion ? 48 : 12;
		const seen = new Set();
		for (const tk of this.ticks) {
			if (!tk.label) continue;
			const id = `${tk.unit}:${tk.t}`;
			seen.add(id);
			const a0 = this.labelFade.get(id)?.a ?? 0;
			const a = this.reducedMotion ? 1 : a0 + (1 - a0) * expDamp(k, dt);
			this.labelFade.set(id, {
				id,
				x: tk.x,
				text: tk.label,
				lane: labelLane(tk.unit),
				unit: tk.unit,
				a
			});
		}
		for (const [id, lab] of this.labelFade) {
			if (seen.has(id)) continue;
			const a = this.reducedMotion ? 0 : lab.a * Math.exp(-k * dt);
			if (a < .03) this.labelFade.delete(id);
			else this.labelFade.set(id, {
				...lab,
				a
			});
		}
	}
	springTo(center: number, span: number) {
		this.targetCenter = center;
		this.targetSpan = clamp(span, MIN_SPAN_MS, MAX_SPAN_MS);
		this.springing = true;
		this.coastPx = 0;
		this.slidePx = 0;
		this.slideZoomLog = 0;
		this.flickT = null;
		this.flickV = 0;
		if (this.reducedMotion) {
			this.centerT = this.targetCenter;
			this.spanMs = this.targetSpan;
			this.springing = false;
			this.dirtyWarp = true;
		}
	}
	bounds() {
		let min = this.now - 730 * DAY;
		let max = this.now + 730 * DAY;
		for (const e of this.events) {
			if (e.start < min) min = e.start;
			if (e.end > max) max = e.end;
		}
		return {
			min: min - 120 * DAY,
			max: max + 180 * DAY
		};
	}
	clampView() {
		const { min, max } = this.bounds();
		const pad = this.spanMs * .45;
		this.centerT = clamp(this.centerT, min - pad, max + pad);
		this.spanMs = clamp(this.spanMs, MIN_SPAN_MS, MAX_SPAN_MS);
	}
	tLeft() {
		return this.centerT - this.spanMs / 2;
	}
	tRight() {
		return this.centerT + this.spanMs / 2;
	}
	lens() {
		return {
			now: this.lensNow,
			halfWidth: this.lensHalf,
			amp: this.lensAmp,
		};
	}
	prepareMap() {
		this.lensNow = this.now;
		this.lensHalf = nowLensHalfWidth(this.spanMs);
		this.lensAmp = this.displayedLensAmp;
		const tL = this.centerT - this.spanMs / 2;
		const tR = this.centerT + this.spanMs / 2;
		this.liveA = this.W(tL);
		this.liveDen = this.W(tR) - this.liveA;
		if (Math.abs(this.liveDen) < 1e-9) this.liveDen = 1;
		this.lagClose =
			this.reducedMotion ||
			this.width < 8 ||
			(Math.abs(this.centerT - this.lagCenter) < this.spanMs * 1e-5 &&
				Math.abs(this.spanMs - this.lagSpan) < this.spanMs * 1e-5);
		if (!this.lagClose) {
			const lL = this.lagCenter - this.lagSpan / 2;
			const lR = this.lagCenter + this.lagSpan / 2;
			this.lagA = this.W(lL);
			this.lagDen = this.W(lR) - this.lagA;
			if (Math.abs(this.lagDen) < 1e-9) this.lagDen = 1;
		}
		this.mapFocusX = this.focusX;
		const sigma = Math.max(72, this.width * 0.18);
		this.mapSigma2 = 2 * sigma * sigma;
		this.mapDirty = false;
	}
	W(t: number) {
		const w = this.warp.at(t);
		if (this.lensAmp <= 0) return w;
		return w + this.lensAmp * this.lensHalf * hannCum((t - this.lensNow) / this.lensHalf);
	}
	dens(t: number) {
		return this.warp.densityAt(t) + lensDensity(t, this.lens());
	}
	mapX(t: number, center: number, span: number) {
		const tL = center - span / 2;
		const tR = center + span / 2;
		const a = this.W(tL);
		const den = this.W(tR) - a;
		if (Math.abs(den) < 1e-9) return this.width / 2;
		return ((this.W(t) - a) / den) * this.width;
	}
	timeToX(t: number) {
		if (this.mapDirty) this.prepareMap();
		const live = ((this.W(t) - this.liveA) / this.liveDen) * this.width;
		if (this.lagClose) return live;
		const lag = ((this.W(t) - this.lagA) / this.lagDen) * this.width;
		const d = live - this.mapFocusX;
		const mix = Math.exp(-(d * d) / this.mapSigma2);
		return lag + (live - lag) * mix;
	}
	xToTime(x: number) {
		if (this.mapDirty) this.prepareMap();
		const target = this.liveA + (x / Math.max(this.width, 1)) * this.liveDen;
		let lo = this.centerT - this.spanMs;
		let hi = this.centerT + this.spanMs;
		for (let i = 0; i < 18; i++) {
			const mid = (lo + hi) / 2;
			if (this.W(mid) < target) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	}
	setAnchor(t: number, x: number) {
		if (this.mapDirty) this.prepareMap();
		const span = this.spanMs;
		const wt = this.W(t);
		const width = this.width;
		let lo = t - span * 4;
		let hi = t + span * 4;
		for (let i = 0; i < 18; i++) {
			const mid = (lo + hi) / 2;
			const a = this.W(mid - span / 2);
			const den = this.W(mid + span / 2) - a;
			const mx = Math.abs(den) < 1e-9 ? width / 2 : ((wt - a) / den) * width;
			if (mx > x) lo = mid;
			else hi = mid;
		}
		const c = (lo + hi) / 2;
		this.centerT = Number.isFinite(c) ? c : this.centerT;
		this.mapDirty = true;
	}
	zoomAt(x: number, factor: number, coast = true) {
		const t = this.xToTime(x);
		this.spanMs = clamp(this.spanMs * factor, MIN_SPAN_MS, MAX_SPAN_MS);
		this.targetSpan = this.spanMs;
		this.springing = false;
		this.dirtyWarp = true;
		this.rebuildWarp();
		this.setAnchor(t, x);
		if (coast) {
			this.noteGesture(x);
			this.zoomCoast += Math.log(factor) * .78;
		}
	}
	noteGesture(x: number) {
		this.focusX = x;
		this.gestureAt = performance.now();
	}
	rebuildWarp() {
		const span = Math.max(this.spanMs, 1);
		const viewL = this.centerT - span * .5;
		const viewR = this.centerT + span * .5;
		const margin = span * .55;
		const spanRatio = (this.warp.t1 - this.warp.t0) / span;
		const emptyOk = Math.abs(this.warp.emptyWeight - this.displayedEmpty) < .003;
		const covered = this.warp.n > 8 && viewL - margin >= this.warp.t0 && viewR + margin <= this.warp.t1 && spanRatio >= 2.4 && spanRatio <= 10 && emptyOk;
		if (!this.dirtyWarp && covered) return;
		const pad = span * 3.4;
		const quant = Math.max(span / 3, HOUR);
		const a = Math.floor((this.centerT - pad) / quant) * quant;
		const b = a + Math.max(pad * 2, span * 6);
		if (!this.dirtyWarp && this.warp.n > 8 && Math.abs(this.warp.t0 - a) < quant * .02 && Math.abs(this.warp.t1 - b) < quant * .02 && emptyOk) return;
		this.warp.emptyWeight = this.displayedEmpty;
		this.warp.busyWeight = BUSY_WEIGHT;
		this.warp.configure(a, b, 2304);
		this.warp.rebuild(this.events.filter((e: CalEvent) => {
			if (e.kind === "event" || e.kind === "milestone") return true;
			if (e.kind !== "band") return false;
			const d = e.end - e.start;
			return d >= 72e6 && d < 13824e5;
		}));
		this.dirtyWarp = false;
		if (this.mode === "pan") this.setAnchor(this.grabT, this.cursorX);
		else if (this.mode === "pinch") this.setAnchor(this.pinchT, this.pinchX);
		else if (this.flickT != null) this.setAnchor(this.flickT, this.flickX);
	}
	lineY() {
		return Math.round(this.height * .62);
	}
	layout() {
		const tL = this.tLeft();
		const tR = this.tRight();
		const pad = this.spanMs * .06;
		const vis = this.events.filter((e: CalEvent) => e.end >= tL - pad && e.start <= tR + pad);
		const byId = new Map(this.events.map((e) => [e.id, e]));
		const depthOf = (e: CalEvent) => {
			let d = 0;
			let cur = e;
			let g = 0;
			while (cur.parentId && g++ < 6) {
				const p = byId.get(cur.parentId);
				if (!p) break;
				cur = p;
				d += 1;
			}
			return d;
		};
		const ly = this.lineY();
		const out: PlacedChip[] = [];
		const events = vis.filter((e: CalEvent) => e.kind === "event");
		const bands = vis.filter((e: CalEvent) => e.kind === "band");
		const stones = vis.filter((e: CalEvent) => e.kind === "milestone");
		for (const e of bands) {
			const x0 = this.timeToX(e.start);
			const x1 = this.timeToX(e.end);
			const depth = depthOf(e);
			const h = 13 + depth * 3;
			out.push({
				event: e,
				x0,
				x1,
				y: ly - h / 2,
				h,
				lane: 0,
				depth,
				clustered: false,
				clusterCount: 1
			});
		}
		const fine: CalEvent[] = [];
		const clusterBuckets = new Map();
		for (const e of events) {
			const x0 = this.timeToX(e.start);
			const x1 = this.timeToX(e.end);
			if (x1 - x0 < 5.5) {
				const b = Math.round((x0 + x1) * .5 / 9);
				const arr = clusterBuckets.get(b) ?? [];
				arr.push(e);
				clusterBuckets.set(b, arr);
			} else fine.push(e);
		}
		for (const [, group] of clusterBuckets) {
			if (group.length === 1 && this.timeToX(group[0].end) - this.timeToX(group[0].start) > 3) {
				fine.push(group[0]);
				continue;
			}
			const mid = group.reduce((s: number, e: CalEvent) => s + (e.start + e.end) / 2, 0) / group.length;
			const x = this.timeToX(mid);
			out.push({
				event: group[0],
				x0: x - 2,
				x1: x + 2,
				y: ly - 16,
				h: 16,
				lane: 0,
				depth: 0,
				clustered: true,
				clusterCount: group.length
			});
		}
		fine.sort((a, b) => a.start - b.start || b.end - a.end);
		const spanOf = (e: CalEvent) => {
			let s = e.start;
			let en = e.end;
			for (const c of fine) {
				if (c.parentId === e.id) {
					s = Math.min(s, c.start);
					en = Math.max(en, c.end);
				}
			}
			return { start: s, end: en };
		};
		const lanes: { start: number; end: number }[][] = [];
		const parentVisible = (e: CalEvent) => !!(e.parentId && vis.some((p) => p.id === e.parentId));
		for (const e of fine) {
			const depth = depthOf(e);
			let lane = 0;
			if (!parentVisible(e)) {
				const span = spanOf(e);
				while (true) {
					const row = lanes[lane] ?? (lanes[lane] = []);
					if (!row.some((r) => r.start < span.end && span.start < r.end)) {
						row.push(span);
						break;
					}
					lane += 1;
					if (lane > 7) break;
				}
			}
			const x0 = this.timeToX(e.start);
			const x1 = this.timeToX(e.end);
			const h = e.mark?.kind === "space" ? 26 : 22;
			const recorded = e.track === "recorded";
			const access = e.track === "access";
			const y = access ? ly + 4 : recorded ? ly + 16 + lane * 26 : ly - 28 - lane * 26;
			out.push({
				event: e,
				x0,
				x1,
				y: access ? ly + 4 : y,
				h: access ? 8 : h,
				lane,
				depth,
				clustered: false,
				clusterCount: 1
			});
		}
		const chips = out.filter((p) => p.event.kind === "event" && !p.clustered && !parentVisible(p.event));
		chips.sort((a, b) => a.x0 - b.x0 || a.event.start - b.event.start);
		for (let i = 0; i < chips.length; i++) {
			const p = chips[i];
			let guard = 0;
			while (guard++ < 8) {
				if (!chips.slice(0, i).some((o) => p.x0 < o.x1 - 6 && o.x0 < p.x1 - 6 && Math.abs(o.y - p.y) < p.h - 2)) break;
				p.lane += 1;
				if (p.event.track === "recorded") p.y = ly + 16 + p.lane * 26;
				else p.y = ly - 28 - p.lane * 26;
			}
		}
		for (const e of stones) {
			const x = this.timeToX(e.start);
			out.push({
				event: e,
				x0: x - 5,
				x1: x + 5,
				y: ly - 5,
				h: 10,
				lane: 0,
				depth: 0,
				clustered: false,
				clusterCount: 1
			});
		}
		for (const p of out) {
			if (!p.event.parentId || p.clustered) continue;
			const parent = out.find((o) => o.event.id === p.event.parentId && !o.clustered);
			if (!parent) continue;
			p.y = parent.y + 4;
			p.h = Math.max(16, parent.h - 8);
			p.lane = parent.lane;
		}
		return out;
	}
	hitTest(x: number, y: number): Hit {
		if (y > this.height - 44) return {
			chip: null,
			handle: null,
			minimap: true
		};
		if (this.selectedId) {
			const sel = this.placed.find((p: PlacedChip) => p.event.id === this.selectedId && !p.clustered);
			if (sel && sel.x1 - sel.x0 > 28) {
				if (x >= sel.x0 - 3 && x <= sel.x0 + 9 && y >= sel.y - 4 && y <= sel.y + sel.h + 4) return {
					chip: sel,
					handle: "start",
					minimap: false
				};
				if (x >= sel.x1 - 9 && x <= sel.x1 + 3 && y >= sel.y - 4 && y <= sel.y + sel.h + 4) return {
					chip: sel,
					handle: "end",
					minimap: false
				};
			}
		}
		for (let i = this.placed.length - 1; i >= 0; i--) {
			const p = this.placed[i];
			if (p.clustered) continue;
			if (p.event.kind === "milestone") {
				const cx = (p.x0 + p.x1) / 2;
				if (Math.hypot(x - cx, y - this.lineY()) < 9) return {
					chip: p,
					handle: null,
					minimap: false
				};
				continue;
			}
			if (x >= p.x0 - 1 && x <= p.x1 + 1 && y >= p.y - 2 && y <= p.y + p.h + 2) return {
				chip: p,
				handle: null,
				minimap: false
			};
		}
		return {
			chip: null,
			handle: null,
			minimap: false
		};
	}
	descendants(id: string): CalEvent[] {
		const out: CalEvent[] = [];
		const walk = (pid: string) => {
			for (const e of this.events) if (e.parentId === pid) {
				out.push(e);
				walk(e.id);
			}
		};
		walk(id);
		return out;
	}
	pushUndo() {
		this.undo.push(JSON.stringify(this.events));
		if (this.undo.length > 40) this.undo.shift();
		this.redo.length = 0;
	}
	applyDelta(id: string, delta: number) {
		const ids = new Set([id, ...this.descendants(id).map((e: CalEvent) => e.id)]);
		this.events = this.events.map((e: CalEvent) => ids.has(e.id) ? {
			...e,
			start: e.start + delta,
			end: e.end + delta
		} : e);
	}
	pushVel(x: number) {
		const t = performance.now();
		this.velBuf.push({
			t,
			x
		});
		while (this.velBuf.length > 0 && t - this.velBuf[0].t > 100) this.velBuf.shift();
	}
	releaseVel() {
		const now = performance.now();
		const samples = this.velBuf.filter((s) => now - s.t > 28 && now - s.t < 120);
		if (samples.length < 2) return 0;
		const a = samples[0];
		const b = samples[samples.length - 1];
		const dt = (b.t - a.t) / 1e3;
		if (dt < .016) return 0;
		return (b.x - a.x) / dt;
	}
	stablePanX() {
		const now = performance.now();
		const samples = this.velBuf.filter((s) => now - s.t > 20);
		if (!samples.length) return null;
		return samples[samples.length - 1].x;
	}
	localXY(e: PointerEvent | WheelEvent | MouseEvent) {
		const r = this.canvas.getBoundingClientRect();
		return {
			x: e.clientX - r.left,
			y: e.clientY - r.top
		};
	}
	onDown = (e: PointerEvent) => {
		if (e.button !== 0 && e.pointerType === "mouse") return;
		try { this.canvas.setPointerCapture(e.pointerId); } catch {}
		const { x, y } = this.localXY(e);
		this.cursorX = x;
		this.cursorY = y;
		this.ptrs.set(e.pointerId, {
			id: e.pointerId,
			x,
			y
		});
		this.moved = false;
		this.emptyDown = false;
		this.coastPx = 0;
		this.slidePx = 0;
		this.slideZoomLog = 0;
		this.flickT = null;
		this.flickV = 0;
		this.zoomCoast = 0;
		this.springing = false;
		this.velBuf = [];
		this.noteGesture(x);
		if (this.ptrs.size === 2) {
			const [a, b] = [...this.ptrs.values()];
			this.mode = "pinch";
			this.pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			this.pinchSpan0 = this.spanMs;
			this.pinchX = (a.x + b.x) / 2;
			this.pinchT = this.xToTime(this.pinchX);
			return;
		}
		const hit = this.hitTest(x, y);
		if (hit.minimap) {
			this.jumpMinimap(x);
			this.mode = "pan";
			this.grabT = this.xToTime(x);
			this.grabX = x;
			this.lastX = x;
			this.lastT = performance.now();
			this.dragSign = 0;
			this.pushVel(x);
			return;
		}
		if (hit.handle && hit.chip && !hit.chip.event.point) {
			this.pushUndo();
			this.mode = hit.handle === "start" ? "resize-start" : "resize-end";
			this.dragId = hit.chip.event.id;
			this.dragOrigin = this.events.map((ev) => ({ ...ev }));
			this.selectedId = hit.chip.event.id;
			return;
		}
		if (hit.chip && !hit.chip.clustered && !hit.chip.event.locked) {
			this.mode = "drag-event";
			this.dragId = hit.chip.event.id;
			this.grabT = this.xToTime(x) - hit.chip.event.start;
			this.dragOrigin = this.events.map((ev) => ({ ...ev }));
			this.selectedId = hit.chip.event.id;
			this.lastX = x;
			this.lastT = performance.now();
			this.emit();
			return;
		}
		if (hit.chip) {
			this.selectedId = hit.chip.event.id;
			this.mode = "pan";
			this.grabT = this.xToTime(x);
			this.grabX = x;
			this.lastX = x;
			this.lastT = performance.now();
			this.emit();
			return;
		}
		const now = performance.now();
		if (now - this.lastClickAt < 320 && Math.abs(x - this.lastClickX) < 8) {
			this.createAt(x);
			this.lastClickAt = 0;
			return;
		}
		this.lastClickAt = now;
		this.lastClickX = x;
		this.selectedId = null;
		this.emptyDown = true;
		this.mode = "pan";
		this.grabT = this.xToTime(x);
		this.grabX = x;
		this.lastX = x;
		this.lastT = performance.now();
		this.dragSign = 0;
		this.pushVel(x);
		this.emit();
	};
	onMove = (e: PointerEvent) => {
		const { x, y } = this.localXY(e);
		this.cursorX = x;
		this.cursorY = y;
		if (this.ptrs.get(e.pointerId)) this.ptrs.set(e.pointerId, {
			id: e.pointerId,
			x,
			y
		});
		if (this.mode === "pinch" && this.ptrs.size >= 2) {
			this.sunHover = false;
			const [a, b] = [...this.ptrs.values()];
			const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			const mid = (a.x + b.x) / 2;
			this.spanMs = clamp(this.pinchSpan0 * Math.pow(this.pinchDist0 / dist, 2.25), MIN_SPAN_MS, MAX_SPAN_MS);
			this.targetSpan = this.spanMs;
			this.pinchX = mid;
			this.dirtyWarp = true;
			this.rebuildWarp();
			this.setAnchor(this.pinchT, mid);
			this.noteGesture(mid);
			return;
		}
		if (this.mode === "pan") {
			if (e.buttons === 0) return;
			this.sunHover = false;
			if (Math.abs(x - this.grabX) > 3) this.moved = true;
			this.setAnchor(this.grabT, x);
			this.noteGesture(x);
			this.pushVel(x);
			const dx = x - this.grabX;
			if (Math.abs(dx) > 8) this.dragSign = Math.sign(dx);
			this.lastX = x;
			this.lastT = performance.now();
			this.canvas.style.cursor = "grabbing";
			return;
		}
		if (this.mode === "drag-event" && this.dragId) {
			if (Math.abs(x - this.lastX) > 2 && !this.moved) {
				this.undo.push(JSON.stringify(this.dragOrigin));
				if (this.undo.length > 40) this.undo.shift();
				this.redo.length = 0;
				this.moved = true;
			}
			if (Math.abs(x - this.lastX) > 2) this.moved = true;
			const origin = this.dragOrigin.find((ev: CalEvent) => ev.id === this.dragId);
			if (!origin) return;
			const delta = this.softSnap(this.xToTime(x) - this.grabT) - origin.start;
			const ids = new Set([this.dragId, ...this.descendants(this.dragId).map((c: CalEvent) => c.id)]);
			this.events = this.dragOrigin.map((ev: CalEvent) => ids.has(ev.id) ? {
				...ev,
				start: ev.start + delta,
				end: ev.end + delta
			} : ev);
			this.dirtyWarp = true;
			this.lastX = x;
			this.canvas.style.cursor = "grabbing";
			return;
		}
		if ((this.mode === "resize-start" || this.mode === "resize-end") && this.dragId) {
			if (!this.dragOrigin.find((ev: CalEvent) => ev.id === this.dragId)) return;
			// ZERO PATCH (v0.2.351): mirror the drag-event branch — mark `moved` + push undo on the first
			// real movement. Without this, `this.moved` stayed false through a resize, so onUp's
			// `if (this.moved)` gate skipped commitSnap/persist/emitRetime entirely: the edge visually moved
			// but the new time was never emitted to Zero, so the chip snapped back on the next update().
			// REPORT UPSTREAM to Grok — this belongs in the engine, and a fresh re-vendor will drop it.
			if (Math.abs(x - this.lastX) > 2 && !this.moved) {
				this.undo.push(JSON.stringify(this.dragOrigin));
				if (this.undo.length > 40) this.undo.shift();
				this.redo.length = 0;
				this.moved = true;
			}
			const t = this.softSnap(this.xToTime(x));
			this.events = this.dragOrigin.map((ev: CalEvent) => {
				if (ev.id !== this.dragId) return ev;
				if (this.mode === "resize-start") return {
					...ev,
					start: Math.min(t, ev.end - MIN_EVENT_MS)
				};
				return {
					...ev,
					end: Math.max(t, ev.start + MIN_EVENT_MS)
				};
			});
			this.dirtyWarp = true;
			this.lastX = x;
			this.canvas.style.cursor = "ew-resize";
			return;
		}
		this.cursorT = this.xToTime(x);
		const hit = this.hitTest(x, y);
		this.hoverId = hit.chip?.event.id ?? null;
		this.hoverHandle = hit.handle;
		this.sunHover = false;
		if (!hit.chip && !hit.minimap && !hit.handle) {
			const sun = this.hitSun(x, y);
			if (sun) {
				this.sunHover = true;
				this.hoverSun = sun;
			}
		}
		this.canvas.style.cursor = hit.minimap ? "pointer" : hit.handle ? "ew-resize" : hit.chip ? "grab" : this.sunHover || this.sunHoverA > .2 ? "pointer" : "grab";
	};
	onUp = (e: PointerEvent) => {
		const { x, y } = this.localXY(e);
		this.cursorX = x;
		this.cursorY = y;
		this.ptrs.delete(e.pointerId);
		if (this.mode === "pinch") {
			if (this.ptrs.size < 2) this.mode = "none";
			return;
		}
		if (this.mode === "pan") {
			const stableX = this.stablePanX();
			const releaseX = stableX ?? x;
			if (!this.moved && this.emptyDown && this.source !== "demo") {
				this.callbacks.onEmptyClick?.(this.xToTime(x));
				this.noteIntent("empty-click");
			} else if (this.moved && stableX != null) this.setAnchor(this.grabT, stableX);
			if (this.moved && !this.reducedMotion) {
				let v = this.releaseVel();
				if (this.dragSign !== 0 && Math.sign(v) !== 0 && Math.sign(v) !== this.dragSign) v = 0;
				if (Math.abs(v) < 160) v = 0;
				this.flickT = this.grabT;
				this.flickX = releaseX;
				this.flickV = clamp(v, -9e3, 9e3);
				this.coastPx = 0;
			} else {
				this.flickT = null;
				this.flickV = 0;
				this.coastPx = 0;
			}
		}
		if ((this.mode === "drag-event" || this.mode === "resize-start" || this.mode === "resize-end") && this.dragId) {
			if (this.moved) {
				this.commitSnap(this.dragId);
				this.persist();
				this.emitRetime(this.dragId);
			} else if (this.mode === "drag-event" && this.dragOrigin.length) {
				this.events = this.dragOrigin;
				const ev = this.events.find((e) => e.id === this.dragId);
				if (ev?.mark) {
					this.callbacks.onActivate?.(ev.mark.entityId, ev.mark);
					this.noteIntent(`activate ${ev.title}`);
				}
			}
		}
		this.mode = "none";
		this.dragId = null;
		this.snapGuide = null;
		this.velBuf = [];
		this.emit();
	};
	onLeave = () => {
		if (this.mode === "none") {
			this.hoverId = null;
			this.cursorT = null;
			this.sunHover = false;
			this.canvas.style.cursor = "grab";
		}
	};
	onWheel = (e: WheelEvent) => {
		e.preventDefault();
		this.springing = false;
		this.sunHover = false;
		const { x, y } = this.localXY(e);
		this.cursorX = x;
		this.cursorY = y;
		this.wheelX = x;
		this.noteGesture(x);
		const notches = wheelNotches(e);
		if (e.ctrlKey || e.metaKey) {
			let log: number;
			if (notches != null) log = notches * Math.log(1.055);
			else {
				const pixel = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
				log = e.deltaY * pixel * .009;
			}
			log = clamp(log, -Math.log(1.1), Math.log(1.1));
			this.slideZoomLog += log;
			this.flickT = null;
			this.flickV = 0;
			this.zoomCoast = 0;
			return;
		}
		const pixel = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
		const dxPx = e.deltaX * pixel;
		const dyPx = e.deltaY * pixel;
		let raw: number;
		if (e.shiftKey) raw = dyPx;
		else if (Math.abs(dxPx) > Math.abs(dyPx) * .45) raw = dxPx;
		else raw = dxPx + dyPx;
		let dx: number;
		if (notches != null) {
			const n = Math.sign(raw) * Math.abs(notches);
			dx = n * Math.max(18, this.width * .016);
		} else {
			dx = raw * 2.35;
		}
		const cap = this.width * .05;
		this.slidePx += clamp(dx, -cap, cap);
		this.flickT = null;
		this.flickV = 0;
		this.coastPx = 0;
		this.lastT = performance.now();
	};
	onMenu = (e: MouseEvent) => {
		e.preventDefault();
		const { x, y } = this.localXY(e);
		const hit = this.hitTest(x, y);
		const ev = hit.chip?.event;
		if (ev?.mark?.track === "planned" && ev.mark.occRef !== undefined) {
			this.callbacks.onOccurrenceMenu?.(ev.mark.entityId, ev.mark.occRef, e.clientX, e.clientY);
			this.noteIntent(`occurrence-menu ${ev.title}`);
			return;
		}
		if (ev?.mark?.track === "recorded" && ev.mark.sessionAnchorId != null) {
			this.callbacks.onSessionMenu?.(ev.mark.entityId, ev.mark.sessionAnchorId, e.clientX, e.clientY);
			this.noteIntent(`session-menu ${ev.title}`);
			return;
		}
		this.callbacks.onBandMenu?.(e.clientX, e.clientY);
		this.noteIntent("band-menu");
	};
	onKey = (e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
			e.preventDefault();
			if (e.shiftKey) this.redoLast();
			else this.undoLast();
			return;
		}
		if (e.key === "Home" || e.key.toLowerCase() === "n") {
			e.preventDefault();
			this.goToNow();
		} else if (e.key === "+" || e.key === "=") this.zoomAt(this.width / 2, .62);
		else if (e.key === "-" || e.key === "_") this.zoomAt(this.width / 2, 1.61);
		else if (e.key === "ArrowLeft") this.setAnchor(this.xToTime(this.width / 2), this.width / 2 + this.width * .08);
		else if (e.key === "ArrowRight") this.setAnchor(this.xToTime(this.width / 2), this.width / 2 - this.width * .08);
		else if (e.key === "Delete" || e.key === "Backspace") this.deleteSelected();
		else if (e.key === "Escape") {
			this.selectedId = null;
			this.emit();
		}
	};
	snap(t: number) {
		let best = snapTime(t, this.spanMs);
		let bestPx = 8;
		for (const ev of this.events) {
			if (ev.id === this.dragId) continue;
			for (const edge of [ev.start, ev.end]) {
				const px = Math.abs(this.mapX(edge, this.centerT, this.spanMs) - this.mapX(t, this.centerT, this.spanMs));
				if (px < bestPx) {
					bestPx = px;
					best = edge;
				}
			}
		}
		return best;
	}
	softSnap(t: number) {
		const s = this.snap(t);
		const px = Math.abs(this.mapX(s, this.centerT, this.spanMs) - this.mapX(t, this.centerT, this.spanMs));
		this.snapGuide = px < 8 ? s : null;
		return t;
	}
	commitSnap(id: string) {
		const ev = this.events.find((e: CalEvent) => e.id === id);
		if (!ev || ev.point) return;
		if (this.mode === "resize-start" || this.mode === "resize-end") {
			const start = snapTime(ev.start, this.spanMs);
			const end = snapTime(ev.end, this.spanMs);
			this.events = this.events.map((e: CalEvent) => e.id === id ? {
				...e,
				start,
				end: Math.max(end, start + MIN_EVENT_MS)
			} : e);
			return;
		}
		const delta = snapTime(ev.start, this.spanMs) - ev.start;
		if (Math.abs(delta) < 1) return;
		this.applyDelta(id, delta);
	}
	createAt(x: number) {
		const t = this.snap(this.xToTime(x));
		if (this.source !== "demo") {
			this.callbacks.onEmptyClick?.(t);
			this.noteIntent(`empty-click ${formatRange(t, t + HOUR)}`);
			return;
		}
		const start = t;
		const event = {
			id: `new_${Date.now().toString(36)}`,
			title: "New block",
			start,
			end: start + HOUR,
			kind: "event" as EventKind,
			category: "focus" as EventCategory
		};
		this.pushUndo();
		this.events = [...this.events, event];
		this.selectedId = event.id;
		this.persist();
		this.dirtyWarp = true;
		this.emit();
	}
	emitRetime(id: string) {
		const ev = this.events.find((e) => e.id === id);
		if (!ev?.mark) return;
		const start = ev.start;
		const end = ev.end;
		if (ev.mark.track === "recorded" && ev.mark.sessionAnchorId != null) {
			this.callbacks.onSessionRetime?.(ev.mark.entityId, ev.mark.sessionAnchorId, start, end);
			this.noteIntent(`session-retime ${ev.title}`);
			return;
		}
		if (ev.mark.occRef !== undefined) {
			this.callbacks.onOccurrenceRetime?.(ev.mark.entityId, ev.mark.occRef, start, end);
			this.noteIntent(`occurrence-retime ${ev.title}`);
		}
	}
	jumpMinimap(x: number) {
		const { min, max } = this.bounds();
		const t = min + x / Math.max(this.width, 1) * (max - min);
		this.noteGesture(x);
		this.springTo(t, this.spanMs);
	}
	emit() {
		const s = this.snapshot();
		const minute = Math.floor(s.now / 6e4);
		const spanBucket = Math.round(Math.log2(s.spanMs) * 24);
		const key = `${s.selectedId}|${s.warp}|${Number(s.nowLens)}|${s.eventCount}|${minute}|${spanBucket}|${s.selected?.title ?? ""}|${s.selected?.start ?? 0}|${s.selected?.end ?? 0}|${s.lastIntent ?? ""}`;
		if (key === this.lastEmitKey) return;
		this.lastEmitKey = key;
		this.host.onChange(s);
	}
	draw() {
		const { ctx, width, height } = this;
		ctx.fillStyle = C.bg;
		ctx.fillRect(0, 0, width, height);
		const ly = this.lineY();
		const nowX = this.timeToX(this.now);
		this.drawNowWash(nowX, ly);
		this.drawMinimap();
		this.drawSun(ly);
		this.drawCoil(ly);
		this.drawLine(ly);
		this.drawTicks(ly);
		this.drawBands(ly);
		this.drawChips();
		this.drawMilestones(ly);
		this.drawNowHead(nowX, ly);
		if (this.snapGuide != null) this.drawSnap(this.snapGuide, ly);
		this.drawHoverTip();
	}
	drawNowWash(nowX: number, ly: number) {
		if (this.displayedLensAmp <= .02 || nowX < -40 || nowX > this.width + 40) return;
		const target = Math.max(lensAmpForSpan(this.spanMs), .01);
		const a = clamp(this.displayedLensAmp / target, 0, 1);
		const hw = 90 + Math.min(220, this.width * .08);
		const g = this.ctx.createLinearGradient(nowX - hw, 0, nowX + hw, 0);
		g.addColorStop(0, "rgba(244,244,246,0)");
		g.addColorStop(.5, `rgba(244,244,246,${(.05 * a).toFixed(3)})`);
		g.addColorStop(1, "rgba(244,244,246,0)");
		this.ctx.fillStyle = g;
		this.ctx.fillRect(nowX - hw, 0, hw * 2, ly + 40);
	}
	hitSun(x: number, y: number): { rise: number; set: number; px: number; py: number } | null {
		const pts = this.sunPts;
		if (pts.length < 2) return null;
		const hovered = this.sunHover || this.sunHoverA > .18;
		const thresh = hovered ? 7 : 4.2;
		let best = thresh;
		let bx = x;
		let by = y;
		for (let i = 1; i < pts.length; i++) {
			const ax = pts[i - 1].x;
			const ay = pts[i - 1].y;
			const cx = pts[i].x;
			const cy = pts[i].y;
			const dx = cx - ax;
			const dy = cy - ay;
			const l2 = dx * dx + dy * dy || 1;
			const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
			const px = ax + t * dx;
			const py = ay + t * dy;
			const d = Math.hypot(x - px, y - py);
			if (d < best) {
				best = d;
				bx = px;
				by = py;
			}
		}
		if (best >= thresh) return null;
		const times = sunTimes(this.xToTime(bx));
		return { rise: times.rise, set: times.set, px: bx, py: by };
	}
	drawSun(ly: number) {
		const { ctx, width, spanMs } = this;
		const ampDay = 78;
		const ampSeason = 40;
		const pxPerDay = width / (spanMs / DAY);
		const kDaily = clamp((pxPerDay - 4) / 12, 0, 1);
		const u = smoothstep(this.sunHoverA);
		const strokeA = lerp(.38, 1, u);
		const dayFillA = lerp(.045, .11, u);
		const nightFillA = lerp(.03, .08, u);
		const cx = width * 0.5;
		const sigma = Math.max(90, width * 0.32);
		const envAt = (x: number) => 0.62 + 0.38 * Math.exp(-0.5 * ((x - cx) / sigma) * ((x - cx) / sigma));
		ctx.save();
		ctx.lineWidth = lerp(1.3, 1.75, u);
		ctx.strokeStyle = C.travel;
		ctx.globalAlpha = strokeA;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		const extra =
			Math.abs(this.centerT - this.lagCenter) +
			0.55 * Math.abs(this.spanMs - this.lagSpan) +
			spanMs * 0.08;
		const half = Math.max(spanMs, this.lagSpan) * 0.5;
		const tL = Math.min(this.centerT, this.lagCenter) - half - extra;
		const tR = Math.max(this.centerT, this.lagCenter) + half + extra;
		type P = { t: number; x: number };
		let raw: P[] = [];
		const n0 = Math.min(160, Math.max(48, Math.floor(width / 8)));
		for (let i = 0; i <= n0; i++) {
			const t = tL + (tR - tL) * (i / n0);
			raw.push({ t, x: this.timeToX(t) });
		}
		if (kDaily > 0.2) {
			const d0 = startOfDay(tL - DAY);
			const d1 = startOfDay(tR) + DAY;
			const dMax = d0 + 60 * DAY;
			for (let d = d0; d <= d1 && d <= dMax; d += DAY) {
				const { rise, set } = sunTimes(d);
				raw.push({ t: rise, x: this.timeToX(rise) });
				raw.push({ t: (rise + set) / 2, x: this.timeToX((rise + set) / 2) });
				raw.push({ t: set, x: this.timeToX(set) });
			}
			raw.sort((a, b) => a.t - b.t);
		}
		const MAX_DX = 3;
		const MAX_N = 420;
		for (let pass = 0; pass < 7; pass++) {
			if (raw.length >= MAX_N) break;
			let grew = false;
			const next: P[] = [raw[0]];
			for (let i = 0; i < raw.length - 1; i++) {
				const a = raw[i];
				const b = raw[i + 1];
				if (
					next.length < MAX_N &&
					Math.abs(b.x - a.x) > MAX_DX &&
					Math.abs(b.t - a.t) > 45_000
				) {
					const t = (a.t + b.t) * 0.5;
					next.push({ t, x: this.timeToX(t) });
					grew = true;
				}
				next.push(b);
			}
			raw = next;
			if (!grew) break;
		}
		const ys: { x: number; y: number }[] = [];
		let lastX = -1e9;
		for (const p of raw) {
			if (Math.abs(p.x - lastX) < 0.35) continue;
			lastX = p.x;
			const h = kDaily * sunUnit(p.t) + (1 - kDaily) * seasonSigned(p.t);
			const amp = kDaily * ampDay + (1 - kDaily) * ampSeason;
			ys.push({ x: p.x, y: ly - amp * envAt(p.x) * h });
		}
		this.sunPts = ys;
		ctx.beginPath();
		if (ys.length) {
			ctx.moveTo(ys[0].x, ys[0].y);
			for (let i = 1; i < ys.length; i++) ctx.lineTo(ys[i].x, ys[i].y);
		}
		ctx.stroke();
		if (ys.length > 1) {
			ctx.beginPath();
			ctx.moveTo(ys[0].x, ly);
			for (const p of ys) ctx.lineTo(p.x, Math.min(p.y, ly));
			ctx.lineTo(ys[ys.length - 1].x, ly);
			ctx.closePath();
			ctx.fillStyle = `rgba(154,139,124,${dayFillA})`;
			ctx.globalAlpha = 1;
			ctx.fill();
			ctx.beginPath();
			ctx.moveTo(ys[0].x, ly);
			for (const p of ys) ctx.lineTo(p.x, Math.max(p.y, ly));
			ctx.lineTo(ys[ys.length - 1].x, ly);
			ctx.closePath();
			ctx.fillStyle = `rgba(90,96,110,${nightFillA})`;
			ctx.fill();
		}
		ctx.restore();
	}
	drawCoil(ly: number) {
		const { ctx, width, spanMs } = this;
		const { unit, step } = coilUnit(spanMs);
		const approx = unitApproxMs(unit, step);
		const t0 = this.tLeft() - spanMs * .04;
		const t1 = this.tRight() + spanMs * .04;
		ctx.lineWidth = 1;
		let t = floorTo(t0, unit, step);
		let guard = 0;
		let prevX = this.timeToX(t);
		while (t <= t1 && guard++ < 6e3) {
			const next = addUnit(t, unit, step);
			const x = this.timeToX(t);
			const local = Math.abs(this.timeToX(next) - x);
			if (x >= -2 && x <= width + 2 && local >= 2.2) {
				const packed = clamp(1 - local / Math.max(8, approx / spanMs * width * 1.6), 0, 1);
				const h = 4 + packed * 9;
				ctx.globalAlpha = .12 + packed * .5;
				ctx.strokeStyle = C.tick;
				ctx.beginPath();
				ctx.moveTo(x + .5, ly - h);
				ctx.lineTo(x + .5, ly + 2);
				ctx.stroke();
			} else if (x >= -2 && x <= width + 2 && local < 2.2) {
				ctx.globalAlpha = .22;
				ctx.strokeStyle = C.tick;
				ctx.beginPath();
				ctx.moveTo(prevX, ly + .5);
				ctx.lineTo(x, ly + .5);
				ctx.stroke();
			}
			prevX = x;
			t = next;
		}
		ctx.globalAlpha = 1;
	}
	drawLine(ly: number) {
		const { ctx, width } = this;
		ctx.strokeStyle = C.line;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, ly + .5);
		ctx.lineTo(width, ly + .5);
		ctx.stroke();
	}
	drawTicks(ly: number) {
		const { ctx } = this;
		ctx.textAlign = "center";
		ctx.textBaseline = "alphabetic";
		ctx.letterSpacing = "0.16em";
		for (const tk of this.ticks) {
			if (tk.drawTick === false) continue;
			const h = tk.boundary ? 16 : tk.major ? 11 : 6;
			ctx.strokeStyle = tk.boundary ? C.tickMajor : tk.major ? C.tickMajor : C.tick;
			ctx.globalAlpha = tk.boundary ? .95 : tk.major ? .85 : .38;
			ctx.lineWidth = tk.boundary ? 1.15 : 1;
			ctx.beginPath();
			ctx.moveTo(tk.x + .5, ly - h);
			ctx.lineTo(tk.x + .5, ly + (tk.boundary ? 7 : tk.major ? 5 : 3));
			ctx.stroke();
		}
		for (const lab of this.labelFade.values()) {
			const a = lab.a * this.laneA[lab.lane];
			if (a < .04) continue;
			ctx.globalAlpha = a;
			ctx.fillStyle = lab.lane === "time" ? C.subtle : C.muted;
			ctx.font = lab.lane === "time" ? `500 10px ${FONT_DISPLAY}` : `500 11px ${FONT_DISPLAY}`;
			ctx.fillText(lab.text, lab.x, this.laneY[lab.lane]);
		}
		ctx.globalAlpha = 1;
		ctx.letterSpacing = "0px";
	}
	drawBands(_ly: number) {
		const { ctx } = this;
		for (const p of this.placed) {
			if (p.event.kind !== "band") continue;
			const x = Math.min(p.x0, p.x1);
			const w = Math.abs(p.x1 - p.x0);
			if (w < 1 || p.x1 < -20 || p.x0 > this.width + 20) continue;
			const col = colorOf(p.event.title, p.event.category);
			const long = w > this.width * .85;
			ctx.save();
			roundRect(ctx, x, p.y, w, p.h, 4);
			ctx.fillStyle = col;
			ctx.globalAlpha = long ? .07 : p.event.id === this.selectedId ? .38 : .2;
			ctx.fill();
			if (!long) {
				ctx.globalAlpha = p.event.id === this.hoverId ? .7 : .45;
				ctx.strokeStyle = col;
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
			if (w > 64 && !long) {
				ctx.font = `500 11px ${FONT_UI}`;
				ctx.fillStyle = C.fg;
				ctx.textAlign = "left";
				ctx.textBaseline = "middle";
				ctx.save();
				ctx.beginPath();
				ctx.rect(x + 4, p.y, w - 8, p.h);
				ctx.clip();
				ctx.globalAlpha = .85;
				ctx.fillText(p.event.title, x + 8, p.y + p.h / 2);
				ctx.restore();
			}
			ctx.restore();
		}
	}
	drawMarkChip(p: PlacedChip) {
		const { ctx } = this;
		const e = p.event;
		const mark = e.mark;
		if (!mark) return;
		const x = Math.min(p.x0, p.x1);
		const w = Math.max(2, Math.abs(p.x1 - p.x0));
		if (p.x1 < -40 || p.x0 > this.width + 40) return;
		const col = this.accentOf(e);
		const sel = e.id === this.selectedId;
		const hov = e.id === this.hoverId;
		const ghost = (e.cancelled ? 0.38 : e.auto ? 0.55 : 1) * this.chipAlpha(e.id);
		ctx.save();
		ctx.globalAlpha = ghost * (sel ? 1 : hov ? 0.92 : 0.88);
		const fadeL = e.unknownStart ? Math.min(28, w * 0.35) : 0;
		const fadeR = e.openEnded || e.unknownEnd ? Math.min(36, w * 0.45) : 0;
		roundRect(ctx, x, p.y, w, p.h, 6);
		if (fadeL || fadeR) {
			const g = ctx.createLinearGradient(x, 0, x + w, 0);
			g.addColorStop(0, fadeL ? "rgba(0,0,0,0)" : col);
			if (fadeL) g.addColorStop(Math.min(0.45, fadeL / Math.max(w, 1)), col);
			if (fadeR) g.addColorStop(Math.max(0.55, 1 - fadeR / Math.max(w, 1)), col);
			g.addColorStop(1, fadeR ? "rgba(0,0,0,0)" : col);
			ctx.fillStyle = g;
			ctx.globalAlpha = ghost * (sel ? 0.32 : 0.22);
			ctx.fill();
		} else {
			ctx.fillStyle = col;
			ctx.globalAlpha = ghost * (sel ? 0.32 : hov ? 0.26 : 0.2);
			ctx.fill();
		}
		ctx.globalAlpha = ghost * (sel ? 0.95 : 0.7);
		ctx.strokeStyle = col;
		ctx.lineWidth = sel ? 1.6 : 1;
		roundRect(ctx, x, p.y, w, p.h, 6);
		ctx.stroke();
		const gSize = Math.min(16, p.h - 4);
		const gx = x + 4 + gSize / 2;
		const gy = p.y + p.h / 2;
		ctx.globalAlpha = ghost;
		drawGlyph(ctx, {
			kind: mark.glyph.kind,
			accent: col,
			bg: C.bg,
			size: gSize,
			cx: gx,
			cy: gy,
			ongoing: !!(e.ongoing || mark.glyph.ongoing),
			flip180: !!mark.glyph.flip180,
			done: !!mark.glyph.done,
			cancelled: !!(e.cancelled || mark.glyph.cancelled),
			filled: !!mark.glyph.done,
			scheduled: mark.track === "planned" && !e.ongoing && e.start > this.now && !mark.glyph.done,
			timeMs: performance.now(),
			reducedMotion: this.reducedMotion,
		});
		if (w > 40) {
			ctx.font = `500 12px ${FONT_UI}`;
			ctx.fillStyle = C.fg;
			ctx.textAlign = "left";
			ctx.textBaseline = "middle";
			ctx.globalAlpha = ghost * 0.92;
			ctx.save();
			ctx.beginPath();
			ctx.rect(x + gSize + 8, p.y, Math.max(0, w - gSize - 14), p.h);
			ctx.clip();
			ctx.fillText(e.title, x + gSize + 10, p.y + p.h / 2 + 0.5);
			ctx.restore();
		}
		if (sel && w > 28 && !e.point) {
			ctx.globalAlpha = ghost;
			ctx.fillStyle = C.handle;
			roundRect(ctx, x + 1, p.y + 5, 4, p.h - 10, 1);
			ctx.fill();
			roundRect(ctx, x + w - 5, p.y + 5, 4, p.h - 10, 1);
			ctx.fill();
		}
		ctx.restore();
	}
	chipAlpha(id: string): number {
		return this.chipPose.get(id)?.a ?? 1;
	}
	drawChips() {
		const { ctx } = this;
		const live = new Set<string>();
		for (const p of this.placed) {
			if (p.event.kind !== "event" && !p.clustered) continue;
			live.add(p.event.id);
			if (p.clustered) {
				this.drawCluster(p);
				continue;
			}
			if (p.event.mark) {
				this.drawMarkChip(p);
				continue;
			}
			const x = Math.min(p.x0, p.x1);
			const w = Math.max(2, Math.abs(p.x1 - p.x0));
			if (p.x1 < -30 || p.x0 > this.width + 30) continue;
			const col = colorOf(p.event.title, p.event.category);
			const sel = p.event.id === this.selectedId;
			const hov = p.event.id === this.hoverId;
			const fade = this.chipAlpha(p.event.id);
			ctx.save();
			roundRect(ctx, x, p.y, w, p.h, 5);
			ctx.fillStyle = col;
			ctx.globalAlpha = fade * (sel ? .98 : hov ? .92 : .86);
			ctx.fill();
			if (sel) {
				ctx.strokeStyle = C.selection;
				ctx.lineWidth = 1.5;
				ctx.globalAlpha = 1;
				ctx.stroke();
			}
			if (w > 36) {
				ctx.font = `500 12px ${FONT_UI}`;
				ctx.fillStyle = inkOn(col);
				ctx.textAlign = "left";
				ctx.textBaseline = "middle";
				ctx.globalAlpha = .92;
				ctx.save();
				ctx.beginPath();
				ctx.rect(x + 6, p.y, w - 12, p.h);
				ctx.clip();
				ctx.fillText(p.event.title, x + 9, p.y + p.h / 2 + .5);
				ctx.restore();
			}
			if (sel && w > 28) {
				ctx.globalAlpha = 1;
				ctx.fillStyle = inkOn(col);
				roundRect(ctx, x + 1, p.y + 5, 4, p.h - 10, 1);
				ctx.fill();
				roundRect(ctx, x + w - 5, p.y + 5, 4, p.h - 10, 1);
				ctx.fill();
			}
			ctx.restore();
		}
		for (const [id, pose] of this.chipPose) {
			if (live.has(id) || pose.a < 0.03) continue;
			const g = pose.ghost;
			g.y = pose.y;
			g.h = pose.h;
			if (g.event.mark) this.drawMarkChip(g);
			else if (g.clustered) this.drawCluster(g);
		}
	}
	drawCluster(p: PlacedChip) {
		const { ctx } = this;
		const x = (p.x0 + p.x1) / 2;
		const ly = this.lineY();
		ctx.save();
		ctx.fillStyle = colorOf(p.event.title, p.event.category);
		ctx.globalAlpha = .9 * this.chipAlpha(p.event.id);
		ctx.beginPath();
		ctx.arc(x, ly, 2.4, 0, Math.PI * 2);
		ctx.fill();
		if (p.clusterCount > 1 && this.spanMs < 3456e7) {
			ctx.font = `500 9px ${FONT_MONO}`;
			ctx.fillStyle = C.muted;
			ctx.textAlign = "center";
			ctx.textBaseline = "bottom";
			ctx.globalAlpha = .7;
			ctx.fillText(String(p.clusterCount), x, ly - 8);
		}
		ctx.restore();
	}
	drawMilestones(ly: number) {
		const { ctx } = this;
		const live = new Set<string>();
		const drawOne = (p: PlacedChip) => {
			const x = (p.x0 + p.x1) / 2;
			if (x < -20 || x > this.width + 20) return;
			const sel = p.event.id === this.selectedId;
			const fade = this.chipAlpha(p.event.id);
			ctx.save();
			if (p.event.mark) {
				const col = this.accentOf(p.event);
				const ghost = (p.event.cancelled ? 0.4 : 1) * fade;
				ctx.globalAlpha = ghost;
				drawGlyph(ctx, {
					kind: p.event.mark.glyph.kind,
					accent: col,
					bg: C.bg,
					size: 18,
					cx: x,
					cy: ly,
					ongoing: !!(p.event.ongoing || p.event.mark.glyph.ongoing),
					flip180: !!p.event.mark.glyph.flip180,
					done: !!p.event.mark.glyph.done,
					cancelled: !!(p.event.cancelled || p.event.mark.glyph.cancelled),
					filled: !!p.event.mark.glyph.done,
					scheduled: p.event.start > this.now,
					timeMs: performance.now(),
					reducedMotion: this.reducedMotion,
				});
				if (sel) {
					ctx.strokeStyle = C.selection;
					ctx.globalAlpha = fade;
					ctx.beginPath();
					ctx.arc(x, ly, 12, 0, Math.PI * 2);
					ctx.stroke();
				}
			} else {
			ctx.translate(x, ly);
			ctx.rotate(Math.PI / 4);
			ctx.fillStyle = colorOf(p.event.title, p.event.category);
			ctx.globalAlpha = fade;
			ctx.fillRect(-4, -4, 8, 8);
			if (sel) {
				ctx.strokeStyle = C.selection;
				ctx.strokeRect(-4, -4, 8, 8);
			}
			}
			ctx.restore();
			if (p.event.mark || Math.abs(this.timeToX(p.event.start + 3456e6) - x) > 70) {
				ctx.font = `500 11px ${FONT_DISPLAY}`;
				ctx.fillStyle = C.muted;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.globalAlpha = 0.85 * fade;
				ctx.fillText(p.event.title, x, ly + 12);
			}
		};
		for (const p of this.placed) {
			if (p.event.kind !== "milestone") continue;
			live.add(p.event.id);
			drawOne(p);
		}
		for (const [id, pose] of this.chipPose) {
			if (live.has(id) || pose.ghost.event.kind !== "milestone") continue;
			pose.ghost.y = pose.y;
			drawOne(pose.ghost);
		}
	}
	drawNowHead(nowX: number, ly: number) {
		if (nowX < -10 || nowX > this.width + 10) return;
		const { ctx } = this;
		ctx.save();
		ctx.strokeStyle = C.now;
		ctx.globalAlpha = .55;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(nowX + .5, 8);
		ctx.lineTo(nowX + .5, ly + 28);
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillStyle = C.now;
		ctx.beginPath();
		ctx.moveTo(nowX, ly - 7);
		ctx.lineTo(nowX - 5.5, ly - 16);
		ctx.lineTo(nowX + 5.5, ly - 16);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
	drawSnap(t: number, ly: number) {
		const x = this.timeToX(t);
		const { ctx } = this;
		ctx.save();
		ctx.strokeStyle = C.snap;
		ctx.setLineDash([3, 4]);
		ctx.beginPath();
		ctx.moveTo(x + .5, ly - 130);
		ctx.lineTo(x + .5, ly + 36);
		ctx.stroke();
		ctx.restore();
	}
	drawMinimap() {
		const { ctx, width, height } = this;
		const y = height - 28;
		const h = 14;
		const { min, max } = this.bounds();
		const span = max - min || 1;
		ctx.fillStyle = C.bgElevated;
		roundRect(ctx, 8, y, width - 16, h, 3);
		ctx.fill();
		ctx.save();
		ctx.beginPath();
		roundRect(ctx, 8, y, width - 16, h, 3);
		ctx.clip();
		for (const e of this.events) {
			const x0 = 8 + (e.start - min) / span * (width - 16);
			const x1 = 8 + (e.end - min) / span * (width - 16);
			ctx.fillStyle = this.accentOf(e);
			ctx.globalAlpha = e.kind === "band" ? .28 : .55;
			ctx.fillRect(x0, y + 2, Math.max(1, x1 - x0), 10);
		}
		ctx.globalAlpha = 1;
		const vx0 = 8 + (this.tLeft() - min) / span * (width - 16);
		const vx1 = 8 + (this.tRight() - min) / span * (width - 16);
		ctx.strokeStyle = C.selection;
		ctx.globalAlpha = .7;
		ctx.lineWidth = 1;
		ctx.strokeRect(Math.min(vx0, vx1), y + .5, Math.max(8, Math.abs(vx1 - vx0)), 13);
		const nx = 8 + (this.now - min) / span * (width - 16);
		ctx.globalAlpha = .9;
		ctx.fillStyle = C.now;
		ctx.fillRect(nx - .5, y, 1, h);
		ctx.restore();
	}
	drawHoverTip() {
		if (this.sunHoverA > .012 && this.hoverSun) this.drawSunCursor(this.hoverSun.px, this.hoverSun.py);
		if (this.mode === "none" && this.sunHover && this.hoverSun && !this.hoverId) {
			this.drawSunTip();
			return;
		}
		const editing = this.mode === "drag-event" || this.mode === "resize-start" || this.mode === "resize-end";
		const id = editing ? this.dragId : this.mode === "none" ? this.hoverId : null;
		if (!id) return;
		const ev = this.events.find((e: CalEvent) => e.id === id);
		if (!ev) return;
		const clustered = !editing ? this.placed.find((c: PlacedChip) => c.event.id === id)?.clustered ?? false : false;
		const clusterCount = this.placed.find((c: PlacedChip) => c.event.id === id)?.clusterCount ?? 1;
		const { ctx } = this;
		const title = clustered ? `${clusterCount} events` : ev.title;
		const sub = clustered ? "" : formatRange(ev.start, ev.end);
		const durMs = Math.max(0, ev.end - ev.start);
		const mins = Math.round(durMs / 6e4);
		const dur = editing && !clustered ? mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : "";
		ctx.font = `500 12px ${FONT_UI}`;
		const w1 = ctx.measureText(title).width;
		ctx.font = `400 11px ${FONT_MONO}`;
		const w2 = sub ? ctx.measureText(sub).width : 0;
		const w3 = dur ? ctx.measureText(dur).width : 0;
		const mark = clustered ? undefined : ev.mark;
		const gSize = 16;
		const gPad = mark ? gSize + 14 : 10;
		const w = Math.max(w1, w2, w3) + gPad + 10;
		const h = dur ? 54 : sub ? 40 : 28;
		let x = this.cursorX + 14;
		let y = this.cursorY + 16;
		if (x + w > this.width - 8) x = this.cursorX - w - 12;
		if (y + h > this.height - 8) y = this.cursorY - h - 14;
		x = clamp(x, 8, this.width - w - 8);
		y = clamp(y, 8, this.height - h - 8);
		ctx.save();
		ctx.fillStyle = C.bgElevated;
		roundRect(ctx, x, y, w, h, 6);
		ctx.fill();
		ctx.strokeStyle = C.line;
		ctx.stroke();
		if (mark) {
			drawGlyph(ctx, {
				kind: mark.glyph.kind,
				accent: this.accentOf(ev),
				bg: C.bgElevated,
				size: gSize,
				cx: x + 8 + gSize / 2,
				cy: y + (sub || dur ? 14 : h / 2),
				ongoing: !!(ev.ongoing || mark.glyph.ongoing),
				flip180: !!mark.glyph.flip180,
				done: !!mark.glyph.done,
				cancelled: !!(ev.cancelled || mark.glyph.cancelled),
				filled: !!mark.glyph.done,
				scheduled: mark.track === "planned" && !ev.ongoing && ev.start > this.now && !mark.glyph.done,
				timeMs: this.lastTs,
				reducedMotion: this.reducedMotion,
			});
		}
		ctx.fillStyle = C.fg;
		ctx.font = `500 12px ${FONT_UI}`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillText(title, x + gPad, y + 6);
		if (sub) {
			ctx.fillStyle = C.muted;
			ctx.font = `400 11px ${FONT_MONO}`;
			ctx.fillText(sub, x + gPad, y + 22);
		}
		if (dur) {
			ctx.fillStyle = C.subtle;
			ctx.font = `400 11px ${FONT_MONO}`;
			ctx.fillText(dur, x + gPad, y + 36);
		}
		ctx.restore();
	}
	drawSunTip() {
		const sun = this.hoverSun;
		if (!sun) return;
		const { ctx } = this;
		const rise = formatHm(sun.rise);
		const set = formatHm(sun.set);
		ctx.font = `400 11px ${FONT_MONO}`;
		const tw = Math.max(ctx.measureText(rise).width, ctx.measureText(set).width);
		const icon = 12;
		const gap = 6;
		const row = 16;
		const w = icon + gap + tw + 20;
		const h = row * 2 + 12;
		let x = this.cursorX + 14;
		let y = this.cursorY + 16;
		if (x + w > this.width - 8) x = this.cursorX - w - 12;
		if (y + h > this.height - 8) y = this.cursorY - h - 14;
		x = clamp(x, 8, this.width - w - 8);
		y = clamp(y, 8, this.height - h - 8);
		ctx.save();
		ctx.fillStyle = C.bgElevated;
		roundRect(ctx, x, y, w, h, 6);
		ctx.fill();
		ctx.strokeStyle = C.line;
		ctx.stroke();
		ctx.fillStyle = C.muted;
		ctx.font = `400 11px ${FONT_MONO}`;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		const y1 = y + 6 + row / 2;
		const y2 = y + 6 + row + row / 2;
		drawHorizonSun(ctx, x + 8, y1, icon, "rise", C.muted);
		ctx.fillText(rise, x + 8 + icon + gap, y1);
		drawHorizonSun(ctx, x + 8, y2, icon, "set", C.muted);
		ctx.fillText(set, x + 8 + icon + gap, y2);
		ctx.restore();
	}
	drawSunCursor(cx: number, cy: number) {
		const { ctx } = this;
		const a = smoothstep(this.sunHoverA);
		const r = lerp(9, 13, a);
		const rot = ((this.lastTs % 6000) / 6000) * Math.PI * 2;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(rot);
		ctx.globalAlpha = a;
		ctx.fillStyle = C.travel;
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		for (let i = 0; i < 8; i++) {
			const ang = (i * Math.PI) / 4;
			const c = Math.cos(ang);
			const s = Math.sin(ang);
			const p = Math.cos(ang + Math.PI / 2);
			const q = Math.sin(ang + Math.PI / 2);
			ctx.moveTo(c * r, s * r);
			ctx.lineTo(c * r * 0.5 + p * r * 0.15, s * r * 0.5 + q * r * 0.15);
			ctx.lineTo(c * r * 0.5 - p * r * 0.15, s * r * 0.5 - q * r * 0.15);
			ctx.closePath();
		}
		ctx.fill();
		ctx.restore();
	}
};
/** Mouse-wheel notches, or null for pixel/trackpad streams. */
function wheelNotches(e: WheelEvent): number | null {
	if (e.deltaMode === 1) {
		const v = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		return Math.sign(v) * Math.max(1, Math.min(2, Math.round(Math.abs(v)) || 1));
	}
	if (e.deltaMode === 2) return Math.sign(e.deltaY || 1);
	const v = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 ? e.deltaX : e.deltaY;
	const abs = Math.abs(v);
	if (abs < 36) return null;
	const ortho = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 ? Math.abs(e.deltaY) : Math.abs(e.deltaX);
	const near = (step: number) => Math.abs(abs - Math.round(abs / step) * step) < 1.5;
	const discrete = ortho < 0.6 && (near(40) || near(100) || near(120) || (abs % 1 === 0 && abs >= 40));
	if (!discrete) return null;
	return Math.sign(v) * Math.max(1, Math.min(2, Math.round(abs / 100) || 1));
}
function drawHorizonSun(
	ctx: CanvasRenderingContext2D,
	x: number,
	cy: number,
	s: number,
	kind: "rise" | "set",
	color: string,
) {
	const cx = x + s * 0.5;
	const hz = cy + (kind === "rise" ? s * 0.12 : s * 0.08);
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.15;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(x + 0.5, hz);
	ctx.lineTo(x + s - 0.5, hz);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(cx, hz, s * 0.28, Math.PI, 0, false);
	ctx.stroke();
	if (kind === "rise") {
		for (const a of [-2.5, -Math.PI / 2, -0.64]) {
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(a) * s * 0.38, hz + Math.sin(a) * s * 0.38);
			ctx.lineTo(cx + Math.cos(a) * s * 0.52, hz + Math.sin(a) * s * 0.52);
			ctx.stroke();
		}
	} else {
		ctx.beginPath();
		ctx.moveTo(cx - 2.2, hz + s * 0.34);
		ctx.lineTo(cx, hz + s * 0.5);
		ctx.lineTo(cx + 2.2, hz + s * 0.34);
		ctx.stroke();
	}
	ctx.restore();
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}
