"use client";

import { useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as Tone from "tone";
import { LoaderCircle } from "lucide-react";

import { loadKotoModel } from "@/util/loadModel";
import { preprocessImage } from "@/util/preprocessImage";
import { canny, type EdgePoint } from "@/util/cannyConverter";
import { mapEdgesToEvents } from "@/util/edgeToEvents";
import { playEventsAtOnsets, stopMusic } from "@/util/toneUtil";

declare global {
  interface Window {
    cv: any;
    Module?: any;
  }
}

enum PageState {
  UPLOAD,
  CATEGORIZING,
  EDGE_DETECTION,
}

export default function Home() {
  const [predictedStyle, setPredictedStyle] = useState<"japanese" | "austrian" | null>(null);
  const [predictionText, setPredictionText] = useState<string | null>(null);

  const [cvLoaded, setCvLoaded] = useState(false);
  const [edgeLoading, setEdgeLoading] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [pageState, setPageState] = useState<PageState>(PageState.UPLOAD);

  // If your `canny` returns [x,y] tuples, we'll store that as number[][];
  // If you've upgraded `canny` to return {x,y,mag,theta}, change this type to that.
  const [points, setPoints] = useState<EdgePoint[]>([]);

  const imageRef = useRef<HTMLImageElement>(null);
  const outputImageRef = useRef<HTMLCanvasElement>(null);

  // --- Load OpenCV.js in the browser ---
  useEffect(() => {
    if (window.cv?.Mat) {
      setCvLoaded(true);
      return;
    }

    // Ensure WASM is found in /public
    window.Module = { locateFile: (path: string) => `/${path}` };

    const script = document.createElement("script");
    script.src = "/opencv.js";
    script.async = true;
    script.onload = () => {
      const maybeReady = (window.cv as any)?.ready;
      if (maybeReady && typeof maybeReady.then === "function") {
        maybeReady.then(() => setCvLoaded(true));
      } else if (window.cv) {
        window.cv["onRuntimeInitialized"] = () => setCvLoaded(true);
      }
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- Classify image (Austrian/Japanese) ---
  const handleImagePrediction = async (file: File) => {
    const model = await loadKotoModel();
    const tensor = await preprocessImage(file); // 128×128 normalized (NHWC)

    const prediction = model.predict(tensor) as tf.Tensor;
    const probs = (await prediction.data()) as Float32Array; // [pAustrian, pJapanese]
    const predictedIndex = probs[0] > probs[1] ? 0 : 1;

    const labels = ["Austrian", "Japanese"] as const;
    const style: "japanese" | "austrian" = predictedIndex === 1 ? "japanese" : "austrian";

    setPredictionText(`The Building is ${labels[predictedIndex]} (${(Math.max(...probs) * 100).toFixed(1)}%)`);
    setPredictedStyle(style);

    tensor.dispose();
    prediction.dispose();
  };

  // --- Run Canny and collect edge points (draws into canvas) ---
  const handleEdgeDetection = () => {
    if (!cvLoaded || !imageRef.current) return;
    setEdgeLoading(true);

    const result = canny(window.cv, imageRef, outputImageRef); // typically returns [x,y] tuples in your current code
    setPoints(result as unknown as number[][]);

    setEdgeLoading(false);
    setPageState(PageState.EDGE_DETECTION);
  };

  // --- Map edges → musical events → schedule by absolute onset ---
  const handleMusicPlaying = async () => {
  if (musicPlaying) {
    stopMusic();
    setMusicPlaying(false);
    return;
  }
  if (!predictedStyle) {
    alert("Please upload an image and get a prediction first.");
    return;
  }
  if (!outputImageRef.current || points.length === 0) {
    alert("Please generate edges first.");
    return;
  }

  setMusicLoading(true);
  await Tone.start();

  const canvas = outputImageRef.current!;
  const imgW = canvas.width || 128;
  const imgH = canvas.height || 128;

  // simple “sheet” scan
  const bands     = 48;       // thin rows
  const bandSpan  = 2;      // seconds per band
  const gap       = 0.10;     // pause between bands
  const thinCellX = 6;        // horizontal thinning (pixels)
  const lanes     = 10;

  const isJapanese = predictedStyle === "japanese";
  const scaleRootMidi   = isJapanese ? 57 : 60;
  const scaleIntervals  = isJapanese ? [0,2,5,7,9] : [0,2,4,5,7,9,11];

  // a tiny set of “durations” that repeats (keeps the feel predictable)
  const PATTERNS: string[][] = [
    ["8n","8n","8n","8n"],
    ["8n","16n","16n","8n"],
    ["4n","8n","8n","4n"],
    ["4n","8n","4n"],
  ];
  const toSec = (ds: string[]) => ds.map(d => Tone.Time(d).toSeconds());

  const q16 = Tone.Time("16n").toSeconds();
  const swing = 0.58;    // slight swing
  const q8  = Tone.Time("8n").toSeconds();
  const human = 0.020;   // light humanization

  const quant = (t: number) => {
    let qt = Math.round(t / q16) * q16;
    const idx = Math.round(qt / q8);
    if (idx % 2 === 1) qt += (swing - 0.5) * q8;
    qt += (Math.random() - 0.5) * (human * 2);
    return Math.max(0, qt);
  };

  // capture clean edge frame for single moving dot
  const ctx = canvas.getContext("2d");
  const base = ctx?.getImageData(0,0,canvas.width,canvas.height) || null;
  const drawDotAt = (x:number,y:number) => {
    if (!ctx || !isJapanese) return;
    if (base) ctx.putImageData(base,0,0);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fill();
  };

  const bandH = Math.max(1, Math.floor(imgH / bands));
  let t0 = 0;
  const events: { note:string; onset:number; velocity:number; x:number; y:number; durSec?:number; graceMidi?:number }[] = [];

  for (let b = 0; b < bands; b++) {
    const y0 = b * bandH, y1 = b === bands - 1 ? imgH : (b + 1) * bandH;

    // horizontal thin per band
    const inBand = points.filter(p => p.y >= y0 && p.y < y1);
    const seen = new Set<number>();
    const thinned = inBand.filter(p => {
      const gx = Math.floor(p.x / thinCellX);
      if (seen.has(gx)) return false;
      seen.add(gx);
      return true;
    });

    if (!thinned.length) { t0 += bandSpan + gap; continue; }

    // map to notes (y→scale lanes, x produces a nominal within-band onset we ignore)
    const baseEvents = mapEdgesToEvents(thinned, imgW, imgH, {
      lanes, spanSeconds: bandSpan, scaleRootMidi, scaleIntervals, thinCell: 1, velMin: 0.55, velMax: 0.95,
    }).sort((a,b) => a.x - b.x); // left→right

    // assign a small repeating duration pattern (like your old engine)
    const pattern = toSec(PATTERNS[Math.floor(Math.random()*PATTERNS.length)]);
    let cursor = 0;
    let prevMidi: number | null = null;

    for (let i = 0; i < baseEvents.length; i++) {
      const ev = baseEvents[i];
      const durSec = pattern[i % pattern.length];
      const onset  = t0 + quant(cursor);

      // tiny pitch nudge to avoid same-note repeats
      const midi = Tone.Frequency(ev.note).toMidi();
      const varied = prevMidi !== null && midi === prevMidi ? midi + (Math.random() < 0.5 ? -1 : 1) : midi;
      prevMidi = varied;

      // 15% chance grace note, one semitone below
      const graceMidi = (isJapanese && i > 0 && Math.random() < 0.15) ? varied - 1 : undefined;

      events.push({
        note: Tone.Frequency(varied, "midi").toNote(),
        onset, durSec,
        velocity: ev.velocity, x: ev.x, y: ev.y,
        ...(graceMidi !== undefined ? {graceMidi} : {}),
      });

      cursor += durSec;
      if (cursor >= bandSpan) break; // keep band short and clear
    }

    t0 += bandSpan + gap; // next band
  }

  if (!events.length) {
    setMusicLoading(false);
    alert("No playable events from edges.");
    return;
  }

  await playEventsAtOnsets(events, isJapanese ? "Japanese" : "Austrian", {
    bpm: isJapanese ? 100 : 90,
    drawDotAt,
  });

  setMusicLoading(false);
  setMusicPlaying(true);
};

  return (
    <>
      {/* UPLOAD */}
      <div className={pageState !== PageState.UPLOAD ? "hidden" : "flex flex-col gap-24 justify-center items-center"}>
        <div>
          <h1 className="text-7xl font-bold tracking-widest">See. Listen. Feel.</h1>
          <h2 className="text-4xl">The sound of Japanese and Austrian architecture</h2>
        </div>

        <input
          type="file"
          accept="image/*"
          className="file-selector text-2xl w-full"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setPredictionText("This Building is ...");
            handleImagePrediction(file);

            const reader = new FileReader();
            reader.onload = () => {
              if (imageRef.current) imageRef.current.src = reader.result as string;
              setPageState(PageState.CATEGORIZING);
            };
            reader.readAsDataURL(file);
          }}
        />
      </div>

      {/* CATEGORIZING / EDGE PREP */}
      <div className={pageState !== PageState.CATEGORIZING ? "hidden" : "block"}>
        <img
          ref={imageRef}
          alt="uploaded"
          className="h-auto object-contain mx-auto border rounded shadow max-h-[600px]"
        />
        {predictionText && <p className="text-center text-lg font-semibold text-zinc-800 my-2">{predictionText}</p>}

        <button
          onClick={handleEdgeDetection}
          className="w-full text-2xl py-2 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-semibold cursor-pointer tracking-wide uppercase rounded bg-zinc-800"
          disabled={!cvLoaded || !imageRef.current || edgeLoading}
          title={!cvLoaded ? "Loading OpenCV..." : ""}
        >
          {edgeLoading && <LoaderCircle className="size-4 animate-spin" />}
          Generate Edges
        </button>
      </div>

      {/* EDGE VIEW + MUSIC */}
      <div className={pageState !== PageState.EDGE_DETECTION ? "hidden" : "block"}>
        <canvas
          ref={outputImageRef}
          className="h-auto object-contain mx-auto border rounded shadow max-h-[600px]"
        />
        {predictionText && <p className="text-center text-lg font-semibold text-zinc-800 my-2">{predictionText}</p>}

        <button
          onClick={handleMusicPlaying}
          className="w-full text-2xl py-2 flex items-center justify-center gap-2 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white cursor-pointer font-semibold tracking-wide uppercase rounded bg-zinc-800"
          disabled={musicLoading}
        >
          {musicLoading && <LoaderCircle className="size-4 animate-spin" />}
          {musicPlaying ? "Stop" : "Play"} Music
        </button>
      </div>
    </>
  );
}