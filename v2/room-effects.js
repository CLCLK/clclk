function createRoomEffects(canvas) {
  const context = canvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  const noiseBolt = new Path2D("M -4 -65 L 39 -53 L 10 -13 L 42 -10 L -30 67 L -13 15 L -48 12 Z");
  const boltMarks = new Path2D("M -57 -40 L -68 -54 M 56 -23 L 73 -31 M 19 53 L 33 62");
  // 창가에서 시작해 냉장고, 이불, 탁상 앞까지 들어오는 번개의 경로입니다.
  const noiseBolts = [
    { fromX: 220, fromY: 280, toX: 400, toY: 620, delay: 0, size: 1.5, tilt: -0.5 },
    { fromX: 480, fromY: 320, toX: 590, toY: 720, delay: .08, size: 1.25, tilt: -.3 },
    { fromX: 700, fromY: 310, toX: 740, toY: 740, delay: .16, size: 1.2, tilt: -.1 },
    { fromX: 1400, fromY: 320, toX: 950, toY: 710, delay: .04, size: 1.6, tilt: .7 },
    { fromX: 1170, fromY: 300, toX: 760, toY: 680, delay: .12, size: 1.3, tilt: .7 },
    { fromX: 1520, fromY: 430, toX: 1220, toY: 810, delay: .23, size: 1.2, tilt: .5 },
  ];
  // 좌표는 방 그림을 기준으로 맞춥니다. 각 바람선은 창에서 이불 쪽으로 이어집니다.
  const windTrails = [
    { path: new Path2D("M 350 300 C 440 440 630 420 520 590 S 410 680 320 660"), span: 450, speed: 1250, delay: 0.0, width: 18, color: "#385cdb" },
    { path: new Path2D("M 620 310 C 600 440 740 420 620 570 S 480 700 390 740"), span: 450, speed: 1250, delay: 0.025, width: 18, color: "#319be4" },
    { path: new Path2D("M 900 330 C 960 490 760 440 720 600 S 520 800 450 820"), span: 450, speed: 1250, delay: 0.05, width: 18, color: "#385cdb" },
    { path: new Path2D("M 1350 350 C 1280 470 1080 460 1010 650 S 810 790 700 850"), span: 450, speed: 1250, delay: 0.075, width: 9, color: "#319be4" },
    { path: new Path2D("M 1500 440 C 1420 520 1200 540 1230 690 S 1190 850 1030 900"), span: 450, speed: 1250, delay: 0.1, width: 9, color: "#385cdb" },
    { path: new Path2D("M 1150 340 C 1100 480 980 430 850 550 S 830 710 700 760"), span: 450, speed: 1250, delay: 0.125, width: 9, color: "#319be4" },
    { path: new Path2D("M 520 280 C 600 400 660 430 570 520 S 450 590 360 620"), span: 450, speed: 1250, delay: 0.15, width: 9, color: "#385cdb" },
    { path: new Path2D("M 1440 370 C 1390 460 1190 430 1100 560 S 920 700 850 730"), span: 450, speed: 1250, delay: 0.175, width: 9, color: "#319be4" },
  ];

  function drawNoise(progress) {
    for (const bolt of noiseBolts) {
      const age = (progress - bolt.delay) / 0.73;
      if (age <= 0 || age >= 1) continue;

      const travel = 1 - (1 - Math.min(1, age / 0.67)) ** 2;
      const lift = Math.max(0, age - 0.52) * 120;
      const x = bolt.fromX + (bolt.toX - bolt.fromX) * travel;
      const y = bolt.fromY + (bolt.toY - bolt.fromY) * travel - lift;
      const scale = bolt.size * (0.43 + 0.57 * travel);
      context.save();
      context.globalAlpha = Math.min(1, age * 7, (1 - age) * 4.5);
      context.translate(x, y);
      context.rotate(bolt.tilt + (age - 0.4) * 0.22);
      context.scale(scale, scale);
      context.lineJoin = "round";
      context.lineCap = "round";
      context.strokeStyle = "#fff6d8";
      context.lineWidth = 18;
      context.stroke(noiseBolt);
      context.fillStyle = "#ffb32e";
      context.fill(noiseBolt);
      context.strokeStyle = "#364586";
      context.lineWidth = 4.5;
      context.stroke(noiseBolt);
      context.stroke(boltMarks);
      context.restore();
    }
  }

  function drawWind(progress) {
    context.save();
    context.globalAlpha = Math.min(1, progress * 8, (1 - progress) * 5);
    context.lineCap = "round";

    for (const trail of windTrails) {
      const start = (progress - trail.delay) * trail.speed - trail.span;
      const width = trail.width * (1 - Math.max(0, progress - 0.52) * 0.85);
      context.setLineDash([trail.span, 2400]);
      context.lineDashOffset = -start;
      context.strokeStyle = "#f1fbff";
      context.lineWidth = width + 4;
      context.stroke(trail.path);
      context.strokeStyle = trail.color;
      context.lineWidth = width;
      context.stroke(trail.path);

      // 짧고 밝은 선을 앞쪽에 겹쳐 바람의 진행 방향을 보여 줍니다.
      context.setLineDash([trail.span * 0.35, 2400]);
      context.lineDashOffset = -(start + trail.span * 0.57);
      context.strokeStyle = "#c0ebff";
      context.lineWidth = Math.max(2, width * 0.36);
      context.stroke(trail.path);
    }

    context.restore();
  }

  function clear() {
    cancelAnimationFrame(frame);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function play(effect, duration) {
    const draw = effect === "wind" ? drawWind : drawNoise;
    if (reducedMotion.matches) {
      draw(effect === "wind" ? 0.66 : 0.43);
      return;
    }

    const startedAt = performance.now();
    function advance(now) {
      const progress = Math.max(0, (now - startedAt) / duration);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (progress >= 1) return;
      draw(progress);
      frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
  }

  return { play, clear };
}
