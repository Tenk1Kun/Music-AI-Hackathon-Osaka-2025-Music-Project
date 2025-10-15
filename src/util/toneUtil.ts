// src/util/toneUtil.ts
import * as Tone from "tone";

let disposables: Tone.ToneAudioNode[] = [];
let scheduledIds: number[] = [];

function disposeAll() {
  scheduledIds.forEach(id => Tone.Transport.clear(id));
  scheduledIds = [];
  disposables.forEach(d => d.dispose());
  disposables = [];
}

async function initChain(style: "Japanese" | "Austrian") {
  disposeAll();

  // FX
  const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 });
  const delay  = new Tone.PingPongDelay({ delayTime: "8n", feedback: 0.25, wet: 0.2 });
  reverb.connect(delay);
  delay.toDestination();
  disposables.push(reverb, delay);

  let main: Tone.Sampler | Tone.PolySynth;

  if (style === "Japanese") {
    // Your /public/koto/ WAVs
    // (Tone can pitch-shift from these roots)
    try {
      main = new Tone.Sampler({
        baseUrl: "/koto/",
        urls: {
          "Ab3": "ab3.wav",
          "Ab4": "ab4.wav",
          "B3":  "b3.wav",
          "C3":  "c3.wav",
          "C4":  "c4.wav",
          "C5":  "c5.wav",
          "D4":  "d4.wav",
          "Db3": "db3.wav",
          "Db4": "db4.wav",
          "F3":  "f3.wav",
          "F4":  "f4.wav",
          "G3":  "g3.wav",
          "G4":  "g4.wav",
        },
        onerror: (e) => console.warn("Koto sampler error:", e),
      });
      await Tone.loaded();
    } catch (e) {
      console.warn("Koto samples failed, using PolySynth:", e);
      main = new Tone.PolySynth(Tone.Synth);
    }
  } else {
    // Your /public/piano/ MP3s are A6..G6 only; pitch-shifting a lot can sound thin.
    // To guarantee sound, default to PolySynth for Austrian.
    main = new Tone.PolySynth(Tone.Synth);
  }

  main.connect(reverb);
  disposables.push(main);

  return { main };
}

export async function playEventsAtOnsets(
  events: { note: string; onset: number; velocity: number; x: number; y: number; durSec?: number; graceMidi?: number }[],
  style: "Japanese" | "Austrian",
  opts: { bpm?: number; drawDotAt: (x:number,y:number)=>void }
) {
  const bpm = opts.bpm ?? (style === "Japanese" ? 100 : 90);

  // Reset transport and tempo
  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.seconds = 0;
  Tone.Transport.bpm.value = bpm;

  const { main } = await initChain(style);

  // 2) Add grace-note scheduling inside the Transport.schedule callback
  scheduledIds = events.map(ev =>
    Tone.Transport.schedule((time) => {
      if (main instanceof Tone.Sampler || main instanceof Tone.PolySynth) {
        // main note (use per-event duration if provided)
        (main as any).triggerAttackRelease(ev.note, ev.durSec ?? 0.3, time, ev.velocity);

        // GRACE NOTE (optional) — fires slightly before the main note
        if (style === "Japanese" && ev.graceMidi !== undefined) {
          const graceFreq = Tone.Frequency(ev.graceMidi, "midi");
          const graceTime = Math.max(Tone.now(), time - 0.05); // 50ms before, clamped
          (main as any).triggerAttackRelease(graceFreq, 0.06, graceTime, 0.3);
        }
      }

      // draw the dot exactly when the main note sounds
      opts.drawDotAt(ev.x, ev.y);
    }, ev.onset)
  );

  Tone.Transport.start("+0.05");
}

export function stopMusic() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  disposeAll();
}