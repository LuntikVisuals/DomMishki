import { useEffect, useRef, useState } from "react";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import type { Engine, Hud, NetMsg, Result } from "@/game/createGame";
import { formatTime, loadBoard, pushBoard, type BoardRow } from "@/game/rating";

type Phase = "menu" | "lobby" | "play";
type Role = "survivor" | "bear";

const DISCLAIMER =
  "Фан-трибьют. Мишка в цилиндре вдохновлён Фредди Фазбером. Все права на этого персонажа принадлежат Скотту Коутону (Scott Cawthon). Неофициальная игра, с автором не связана.";

function rid(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 12)}`;
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function HouseGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const p2pRef = useRef<P2PRoom | null>(null);
  const selfId = useRef(rid("p"));
  const nameRef = useRef("Гость");
  const roleRef = useRef<Role>("survivor");
  const remoteRole = useRef<Role | null>(null);
  const startMatchRef = useRef<() => void>(() => {});
  const sentRole = useRef(new Set<string>());

  const [phase, setPhase] = useState<Phase>("menu");
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("Гость");
  const [role, setRole] = useState<Role>("survivor");
  const [room, setRoom] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [wifiOpen, setWifiOpen] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pad, setPad] = useState(false);
  const [digits, setDigits] = useState("");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [copied, setCopied] = useState(false);

  const goalRef = useRef<HTMLParagraphElement>(null);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const stamRef = useRef<HTMLSpanElement>(null);
  const batRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef<HTMLParagraphElement>(null);
  const vigRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    setBoard(loadBoard());
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dead = false;
    let engine: Engine | null = null;
    void import("@/game/createGame").then(({ createGame }) => {
      if (dead || !canvasRef.current) return;
      engine = createGame(canvasRef.current, {
        onHud: (h: Hud) => paintHud(h),
        onResult: (r) => {
          setResult(r);
          setPaused(false);
          setBoard(
            pushBoard({
              name: nameRef.current.trim().slice(0, 16) || "Гость",
              score: r.score,
              rank: r.rank,
              time: r.time,
              escaped: r.escaped,
              at: Date.now(),
            }),
          );
        },
        onNote: setNote,
        onPad: (open) => {
          setPad(open);
          if (open) setDigits("");
        },
        onPause: setPaused,
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
    });
    return () => {
      dead = true;
      engine?.destroy();
      engineRef.current = null;
    };
    // HUD writer closes over refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paintHud(h: Hud) {
    if (goalRef.current) goalRef.current.textContent = h.goal;
    if (promptRef.current) promptRef.current.textContent = h.prompt;
    if (timeRef.current) timeRef.current.textContent = h.time;
    if (stamRef.current) stamRef.current.style.transform = `scaleX(${Math.max(0, h.stamina) / 100})`;
    if (batRef.current) batRef.current.style.transform = `scaleX(${Math.max(0, h.battery) / 100})`;
    if (itemsRef.current) {
      const bits = [
        h.hasKey ? "Ключ" : null,
        h.hasHammer ? "Молоток" : null,
        h.boards < 3 ? `Доски ${h.boards}` : null,
        h.flash ? "Фонарь" : "Темно",
      ].filter(Boolean);
      itemsRef.current.textContent = bits.join(" · ");
    }
    if (vigRef.current) {
      vigRef.current.style.opacity = String(0.25 + h.bearNear * 0.75);
      vigRef.current.style.boxShadow = h.bearNear > 0.45 ? "inset 0 0 80px rgba(140, 40, 24, 0.55)" : "inset 0 0 90px rgba(0,0,0,0.55)";
    }
  }

  function unlock() {
    engineRef.current?.sfx.unlock();
  }

  function startSolo() {
    unlock();
    setResult(null);
    setNote(null);
    setPad(false);
    setPaused(false);
    engineRef.current?.setNet(null);
    engineRef.current?.start({ control: "survivor", aiBear: true });
    setPhase("play");
  }

  function openRoom(code: string) {
    unlock();
    remoteRole.current = null;
    sentRole.current.clear();
    setPeers([]);
    setRoom(code.toUpperCase());
    setPhase("lobby");
    setWifiOpen(false);
  }

  useEffect(() => {
    if (!room) return;
    const p2p = new P2PRoom({
      room,
      selfId: selfId.current,
      name: (nameRef.current || "Гость").slice(0, 24),
      onPeersChanged: (list) => {
        setPeers(list);
        for (const p of list) {
          if (p.connectionState === "connected" && !sentRole.current.has(p.id)) {
            sentRole.current.add(p.id);
            p2p.send({ t: "role", role: roleRef.current, name: nameRef.current });
          }
        }
      },
      onMessage: (from, data) => {
        const msg = data as NetMsg | { t: "role"; role: Role; name: string } | { t: "begin" };
        if (!msg || typeof msg !== "object" || !("t" in msg)) return;
        if (msg.t === "role") {
          remoteRole.current = msg.role;
          if (msg.role === roleRef.current && selfId.current > from) {
            const next: Role = msg.role === "bear" ? "survivor" : "bear";
            roleRef.current = next;
            setRole(next);
            p2p.send({ t: "role", role: next, name: nameRef.current });
          }
          return;
        }
        if (msg.t === "begin") {
          startMatchRef.current();
          return;
        }
        engineRef.current?.applyNet(msg);
      },
    });
    p2pRef.current = p2p;
    engineRef.current?.setNet((msg, reliable) => {
      if (reliable) p2p.send(msg);
      else p2p.broadcast(msg);
    });
    void p2p.join();
    return () => {
      p2p.close();
      if (p2pRef.current === p2p) p2pRef.current = null;
    };
  }, [room]);

  startMatchRef.current = () => {
    unlock();
    setResult(null);
    setNote(null);
    setPad(false);
    setPaused(false);
    const iAmBear = roleRef.current === "bear";
    const friendBear = remoteRole.current === "bear";
    const p2p = p2pRef.current;
    engineRef.current?.setNet((msg, reliable) => {
      if (!p2p) return;
      if (reliable) p2p.send(msg);
      else p2p.broadcast(msg);
    });
    engineRef.current?.start({
      control: iAmBear ? "bear" : "survivor",
      aiBear: !iAmBear && !friendBear,
    });
    setPhase("play");
  };

  function hostBegin() {
    p2pRef.current?.send({ t: "begin" });
    startMatchRef.current();
  }

  function leaveToMenu() {
    engineRef.current?.toMenu();
    setPhase("menu");
    setRoom(null);
    setResult(null);
    setPaused(false);
    setNote(null);
    setPad(false);
  }

  function again() {
    setResult(null);
    if (room && p2pRef.current) hostBegin();
    else startSolo();
  }

  const connected = peers.filter((p) => p.connectionState === "connected");

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg text-fg" style={{ touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        onPointerDown={() => {
          unlock();
          if (phase === "play" && !result && !paused && matchMedia("(pointer: fine)").matches) {
            void canvasRef.current?.requestPointerLock();
          }
        }}
      />
      <div ref={vigRef} className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 90px rgba(0,0,0,0.55)" }} />

      {phase === "play" && !result && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="max-w-xl rounded-lg bg-bg/80 px-4 py-3 backdrop-blur-sm">
              <p className="font-display text-lg leading-tight">Дом Мишки</p>
              <p ref={goalRef} className="mt-1 text-sm leading-snug text-muted" />
            </div>
            <div className="rounded-lg bg-bg/80 px-4 py-3 text-right backdrop-blur-sm">
              <span ref={timeRef} className="font-display text-2xl">
                0:00
              </span>
              <p ref={itemsRef} className="mt-1 text-xs text-muted" />
            </div>
          </div>
          <div className="flex max-w-xs flex-col gap-2">
            <Meter label="Дыхание" barRef={stamRef} />
            <Meter label="Фонарь" barRef={batRef} />
          </div>
          <p ref={promptRef} className="pointer-events-none text-center font-display text-xl" />
        </div>
      )}

      {phase === "play" && !result && (
        <div className="absolute inset-x-0 bottom-0 z-20 p-4 md:hidden">
          <div className="flex items-end justify-between gap-3">
            <Stick
              onChange={(x, y) => engineRef.current?.setStick(x, y)}
            />
            <LookPad onLook={(x, y) => engineRef.current?.addLook(x, y)} />
            <div className="flex flex-col gap-2">
              <TouchBtn label="Бег" onDown={() => engineRef.current?.hold("sprint", true)} onUp={() => engineRef.current?.hold("sprint", false)} />
              <TouchBtn label="Тихо" onDown={() => engineRef.current?.hold("crouch", true)} onUp={() => engineRef.current?.hold("crouch", false)} />
              <TouchBtn label="Взять" onDown={() => engineRef.current?.tap("interact")} />
              <TouchBtn label="Свет" onDown={() => engineRef.current?.tap("flash")} />
            </div>
          </div>
        </div>
      )}

      {phase !== "play" && (
        <div className="absolute inset-0 z-30 flex items-end justify-center overflow-y-auto bg-bg/55 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface/95 p-5 shadow-2xl sm:p-7">
            <p className="text-xs tracking-[0.22em] text-accent uppercase">Ночной побег</p>
            <h1 className="font-display mt-1 text-5xl leading-none sm:text-6xl">Дом Мишки</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Ты заперт в двухэтажном доме. Мишка в цилиндре слышит бег и видит фонарь. Найди ключ или выломай окно.
            </p>

            {phase === "menu" && !wifiOpen && (
              <div className="mt-5 flex flex-col gap-3">
                <label className="text-sm text-muted" htmlFor="player-name">
                  Имя для рейтинга
                  <input
                    id="player-name"
                    value={name}
                    maxLength={16}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-3 text-fg outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={startSolo}
                  className="rounded-xl bg-accent px-4 py-4 text-lg font-semibold text-bg disabled:opacity-50"
                >
                  Start
                  <span className="mt-0.5 block text-sm font-normal">играть одному против мишки</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWifiOpen(true)}
                  className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-fg"
                >
                  По Wi‑Fi — вдвоём
                </button>
                <p className="text-xs leading-relaxed text-muted">
                  A / ← поворот налево, D / → направо, W вперёд, S назад. Мышь — взгляд. Shift — бег, C — красться, E — действие, F — фонарь.
                </p>
              </div>
            )}

            {phase === "menu" && wifiOpen && (
              <div className="mt-5 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <RoleBtn active={role === "survivor"} label="Выживший" hint="ищет выход" onClick={() => setRole("survivor")} />
                  <RoleBtn active={role === "bear"} label="Мишка" hint="ловит гостя" onClick={() => setRole("bear")} />
                </div>
                <button type="button" onClick={() => openRoom(roomCode())} className="rounded-xl bg-accent px-4 py-3 font-semibold text-bg">
                  Создать комнату
                </button>
                <div className="flex gap-2">
                  <input
                    value={joinInput}
                    maxLength={4}
                    placeholder="Код"
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    className="w-28 rounded-lg border border-border bg-bg px-3 py-3 text-center font-display text-xl tracking-[0.2em] text-fg outline-none"
                  />
                  <button
                    type="button"
                    disabled={joinInput.length < 4}
                    onClick={() => openRoom(joinInput)}
                    className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-3 disabled:opacity-40"
                  >
                    Войти по коду
                  </button>
                </div>
                <button type="button" onClick={() => setWifiOpen(false)} className="text-sm text-muted">
                  Назад
                </button>
              </div>
            )}

            {phase === "lobby" && room && (
              <div className="mt-5 flex flex-col gap-3">
                <p className="text-sm text-muted">Код комнаты</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-5xl tracking-[0.18em]">{room}</p>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(room).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      });
                    }}
                  >
                    {copied ? "Скопирован" : "Копировать"}
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-muted">
                  Откройте эту игру на втором телефоне в той же сети Wi‑Fi и введите код. Код только сводит вас, дальше персонажи ходят напрямую между устройствами.
                </p>
                <p className="text-sm">
                  Вы: {role === "bear" ? "Мишка" : "Выживший"}
                  {connected.length > 0 ? ` · друг в сети (${connected.length})` : " · ждём второго"}
                </p>
                <ul className="text-sm text-muted">
                  {peers.map((p) => (
                    <li key={p.id}>
                      {p.name || "Игрок"} — {linkLabel(p)}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={hostBegin} className="rounded-xl bg-accent px-4 py-3 font-semibold text-bg">
                  В игру
                </button>
                <button type="button" onClick={leaveToMenu} className="text-sm text-muted">
                  Отмена
                </button>
              </div>
            )}

            <Board rows={board} />
            <p className="mt-4 text-xs leading-relaxed text-muted">{DISCLAIMER}</p>
          </div>
        </div>
      )}

      {note && (
        <Overlay>
          <p className="font-display text-2xl">Записка</p>
          <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">{note}</p>
          <button type="button" className="mt-5 rounded-xl bg-accent px-4 py-3 font-semibold text-bg" onClick={() => engineRef.current?.closeOverlay()}>
            Спрятать
          </button>
        </Overlay>
      )}

      {pad && (
        <Overlay>
          <p className="font-display text-2xl">Код кладовой</p>
          <p className="mt-2 font-display text-4xl tracking-[0.3em]">{digits.padEnd(3, "·")}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {"123456789".split("").map((n) => (
              <button key={n} type="button" className="rounded-lg bg-surface-2 py-3 text-lg" onClick={() => setDigits((d) => (d + n).slice(0, 3))}>
                {n}
              </button>
            ))}
            <button type="button" className="rounded-lg bg-surface-2 py-3" onClick={() => setDigits("")}>
              Сброс
            </button>
            <button type="button" className="rounded-lg bg-surface-2 py-3 text-lg" onClick={() => setDigits((d) => (d + "0").slice(0, 3))}>
              0
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent py-3 font-semibold text-bg"
              onClick={() => engineRef.current?.enterCode(digits)}
            >
              Ок
            </button>
          </div>
        </Overlay>
      )}

      {paused && !result && (
        <Overlay>
          <p className="font-display text-3xl">Пауза</p>
          <p className="mt-2 text-sm text-muted">A налево, D направо, W вперёд. Мишка слышит бег и свет фонаря в лицо.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="rounded-xl bg-accent px-4 py-3 font-semibold text-bg" onClick={() => engineRef.current?.resume()}>
              Дальше
            </button>
            <button
              type="button"
              className="rounded-xl border border-border px-4 py-3"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                engineRef.current?.sfx.setMuted(next);
              }}
            >
              {muted ? "Звук включить" : "Звук выключить"}
            </button>
            <button type="button" className="rounded-xl border border-border px-4 py-3" onClick={leaveToMenu}>
              В меню
            </button>
          </div>
        </Overlay>
      )}

      {result && (
        <Overlay>
          <p className="text-xs tracking-[0.2em] text-accent uppercase">{result.you === "bear" ? "Ночь мишки" : "Рейтинг ночи"}</p>
          <p className="font-display text-7xl leading-none">{result.rank}</p>
          <p className="font-display mt-1 text-2xl">{result.title}</p>
          <p className="mt-3 text-sm text-muted">
            {formatTime(result.time)} · шум {Math.round(result.noises)} · замечен {result.spots} раз · {result.score} очков
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="rounded-xl bg-accent px-4 py-3 font-semibold text-bg" onClick={again}>
              Ещё раз
            </button>
            <button type="button" className="rounded-xl border border-border px-4 py-3" onClick={leaveToMenu}>
              В меню
            </button>
          </div>
          <Board rows={board} />
          <p className="mt-4 text-xs leading-relaxed text-muted">{DISCLAIMER}</p>
        </Overlay>
      )}
    </div>
  );
}

function linkLabel(p: PeerInfo) {
  if (p.connectionState === "connected") {
    if (p.candidateType === "host") return "напрямую по Wi‑Fi";
    if (p.candidateType) return "напрямую";
    return "в сети";
  }
  if (p.connectionState === "failed") return "не удалось напрямую";
  return "соединение…";
}

function Meter({ label, barRef }: { label: string; barRef: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <div className="rounded-md bg-bg/75 px-3 py-2 backdrop-blur-sm">
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span ref={barRef} className="block h-full origin-left bg-accent" style={{ transform: "scaleX(1)" }} />
      </div>
    </div>
  );
}

function RoleBtn({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-left ${active ? "border-accent bg-surface-2" : "border-border"}`}
    >
      <span className="block font-semibold">{label}</span>
      <span className="text-xs text-muted">{hint}</span>
    </button>
  );
}

function Board({ rows }: { rows: BoardRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-xs tracking-[0.18em] text-muted uppercase">Рейтинг на этом телефоне</p>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {rows.map((r, i) => (
          <li key={`${r.at}-${i}`} className="flex justify-between gap-3 border-b border-border/70 py-1">
            <span>
              {r.rank} · {r.name}
            </span>
            <span className="text-muted">
              {r.score} · {formatTime(r.time)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">{children}</div>
    </div>
  );
}

function TouchBtn({ label, onDown, onUp }: { label: string; onDown: () => void; onUp?: () => void }) {
  return (
    <button
      type="button"
      className="pointer-events-auto h-12 min-w-16 rounded-full border border-border bg-bg/80 px-3 text-sm text-fg"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
    >
      {label}
    </button>
  );
}

function Stick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const mag = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(max, mag);
    const x = (dx / mag) * clamped;
    const y = (dy / mag) * clamped;
    setKnob({ x, y });
    onChange(clamp(x / max, -1, 1), clamp(-y / max, -1, 1));
  };
  return (
    <div
      ref={ref}
      className="pointer-events-auto relative h-28 w-28 shrink-0 rounded-full border border-border bg-bg/70"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      }}
      onPointerUp={(e) => {
        setKnob({ x: 0, y: 0 });
        onChange(0, 0);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      <span
        className="absolute top-1/2 left-1/2 h-12 w-12 rounded-full bg-accent"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

function LookPad({ onLook }: { onLook: (x: number, y: number) => void }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="pointer-events-auto h-28 flex-1 rounded-2xl border border-dashed border-border bg-bg/40"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        onLook((e.clientX - last.current.x) * 1.4, (e.clientY - last.current.y) * 1.2);
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        last.current = null;
      }}
    >
      <span className="flex h-full items-center justify-center text-xs text-muted">Взгляд</span>
    </div>
  );
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
