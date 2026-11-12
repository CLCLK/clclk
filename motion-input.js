const gestures = [
  { id: "shake", label: "흔들기", icon: "✊" },
  { id: "tickle", label: "간지럽히기", icon: "☝️" },
  { id: "noise", label: "소음 내기", icon: "📣" },
  { id: "wind", label: "바람 불기", icon: "💨" },
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
