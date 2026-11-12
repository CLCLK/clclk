function createRoomEffects(canvas) {
  const context = canvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  const impact = new Path2D("M -68 -39 L -39 -20 L -48 -3 L -17 9 M -12 -57 L 11 -35 L 0 -18 L 28 -1 M 36 -45 L 58 -25 L 43 -9 L 72 13");
  const impactLines = new Path2D("M -67 25 L -85 37 M -23 33 L -28 55 M 27 25 L 36 46 M 80 -35 L 98 -45");
  const car = new Path2D("M 0 10 L -2 1 Q -2 -5 8 -7 L 19 -9 L 29 -21 Q 33 -25 47 -24 L 60 -23 L 72 -8 L 83 -5 L 86 10 Z M 14 12 A 7 7 0 1 0 28 12 A 7 7 0 1 0 14 12 M 58 12 A 7 7 0 1 0 72 12 A 7 7 0 1 0 58 12");
  const roadLines = new Path2D("M 97 0 Q 158 -4 254 -2 M 83 -16 Q 144 -21 210 -18 M 99 17 Q 167 12 231 15");

  // 좌표는 방 그림을 기준으로 맞춥니다. 각 바람선은 창에서 이불 쪽으로 이어집니다.
  const windTrails = [
    { path: new Path2D("M 1122 413 C 1084 460 1049 514 941 544 C 844 570 751 551 694 604 C 652 643 715 682 665 725 C 621 765 532 772 478 743 C 436 720 468 690 491 705 C 503 713 500 728 487 730"), span: 246, speed: 1120, delay: 0, width: 9, color: "#3d8dcc" },
    { path: new Path2D("M 1087 426 C 1039 480 981 502 887 519 C 783 537 706 522 658 573 C 625 610 658 632 631 657 C 598 686 538 690 504 669"), span: 193, speed: 1050, delay: 0.04, width: 5.5, color: "#62b1e6" },
    { path: new Path2D("M 1160 436 C 1115 509 1058 556 959 574 C 855 595 792 576 741 628 C 704 669 757 703 720 746 C 673 801 558 813 492 788"), span: 188, speed: 1110, delay: 0.11, width: 6.5, color: "#5ba8dc" },
    { path: new Path2D("M 973 588 C 864 616 822 607 779 642 C 750 667 782 689 802 671 C 812 661 802 650 792 655"), span: 105, speed: 650, delay: 0.25, width: 4.5, color: "#499acf" },
  ];

  function drawNoise(progress) {
    const construction = Math.min(1, progress / 0.65);
    const impactAlpha = Math.sin(Math.PI * construction) * (0.76 + 0.24 * Math.cos(construction * Math.PI * 4));
    context.save();
    context.globalAlpha = impactAlpha;
    context.translate(1405 - 45 * construction, 264 + 17 * construction);
    context.rotate(-0.15);
    const scale = 0.6 + 0.53 * construction;
    context.scale(scale, scale);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#33458c";
    context.lineWidth = 11;
    context.stroke(impact);
    context.strokeStyle = "#ffd17a";
    context.lineWidth = 5;
    context.stroke(impact);
    context.strokeStyle = "#33458c";
    context.lineWidth = 4.5;
    context.stroke(impactLines);
    context.restore();

    const traffic = Math.max(0, (progress - 0.21) / 0.79);
    context.save();
    context.globalAlpha = Math.sin(Math.PI * traffic);
    context.translate(1420 - traffic * 685, 391 + traffic * 24);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#fff5d7";
    context.lineWidth = 11;
    context.stroke(roadLines);
    context.strokeStyle = "#4a5798";
    context.lineWidth = 5;
    context.stroke(roadLines);
    context.fillStyle = "#ffefc5";
    context.fill(car);
    context.stroke(car);
    context.fillStyle = "#e79e52";
    context.fillRect(-1, -3, 11, 5);
    context.restore();
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
