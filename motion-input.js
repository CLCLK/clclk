const gestures = [
  { id: "shake", label: "흔들기", duration: "1초", instruction: "양 주먹으로 쿵쿵" },
  { id: "tickle", label: "간지럽히기", duration: "2초", instruction: "양손 검지 굽혔다 펴기" },
  { id: "noise", label: "소음 내기", duration: "1초", instruction: "입을 크게 벌리기" },
  { id: "wind", label: "바람 쏘기", duration: "1.5초", instruction: "두 손을 펴고 앞으로" },
];

function createMotionInput(onMotion) {
  // 나중에 MediaPipe가 새 동작을 인식하면 emit("shake")처럼 한 번 호출합니다.
  return {
    emit(gestureId) {
      const gesture = gestures.find((item) => item.id === gestureId);
      if (gesture) onMotion(gesture);
    },
  };
}
