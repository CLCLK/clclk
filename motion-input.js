const gestures = [
  { id: "shake", label: "흔들기", icon: "✊", instruction: "권투 자세로 주먹을 쥐고 창문 두드리기" },
  { id: "tickle", label: "간지럽히기", icon: "☝️", instruction: "양손 검지를 구부렸다 펴며 까딱하기" },
  { id: "noise", label: "소음 내기", icon: "📣", instruction: "입을 크게 벌려 소리 지르는 표정 짓기" },
  { id: "wind", label: "바람 불기", icon: "💨", instruction: "입술을 오므려 후 불기" },
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
