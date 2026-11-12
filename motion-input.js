const gestures = [
  { id: "shake", label: "흔들기", duration: "1초", instruction: "양 주먹으로 창문을 쿵쿵 두드리기" },
  { id: "tickle", label: "간지럽히기", duration: "2초", instruction: "양손 검지를 구부렸다 펴며 간질간질" },
  { id: "noise", label: "소음 내기", duration: "1초", instruction: "입을 크게 벌려 “아!” 소리 없이도 OK" },
  { id: "wind", label: "바람 쏘기", duration: "1.5초", instruction: "두 손을 붙여 앞으로 장풍 쏘기" },
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
